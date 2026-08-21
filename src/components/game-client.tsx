"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createPlayerMarkerColorMap,
  PLAYER_MARKER_COLORS,
  RoadMap,
  type PlayerMarkerColor,
  type RevealMarker,
} from "@/components/road-map";
import { LanguageSwitch } from "@/components/language-switch";
import { createRematch, submitGuess, synchronizeGame } from "@/lib/game-actions";
import {
  calculateRoundScore,
  createDemoRounds,
  findCity,
  pointToStreetDistanceMeters,
  saveLocalBestScore,
  type BoundingBox,
  type CitySlug,
  type Difficulty,
  type GameStateDto,
  type Position,
  type StreetGeometry,
} from "@/lib/game";
import type { Locale } from "@/i18n/routing";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

type DemoConfig = {
  citySlug: CitySlug;
  difficulty: Difficulty;
  nickname: string;
  mode: "solo";
};

type DemoRoundResult = {
  roundNumber: number;
  position: Position | null;
  distanceMeters: number | null;
  points: number;
};

type LoadState = "loading" | "ready" | "error";

function readDemoConfig(gameId: string): DemoConfig | null {
  try {
    const raw = window.sessionStorage.getItem(`roadhunt:game:${gameId}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<DemoConfig>;
    const city = typeof value.citySlug === "string" ? findCity(value.citySlug) : null;
    const difficulties: Difficulty[] = ["easy", "medium", "hard", "insane"];
    if (
      !city ||
      !value.difficulty ||
      !difficulties.includes(value.difficulty) ||
      typeof value.nickname !== "string"
    ) {
      return null;
    }
    return {
      citySlug: city.slug,
      difficulty: value.difficulty,
      nickname: value.nickname.slice(0, 20),
      mode: "solo",
    };
  } catch {
    return null;
  }
}

function formatDistance(distance: number | null, locale: Locale) {
  if (distance === null) return "—";
  if (distance >= 1_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(distance / 1_000)} km`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(distance)} m`;
}

function scoreFormatter(locale: Locale) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
}

function LiveGame({ gameId }: { gameId: string }) {
  const t = useTranslations("Game");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [state, setState] = useState<GameStateDto | null>(null);
  const [selection, setSelection] = useState<{ roundId: string; position: Position } | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [onlinePlayerIds, setOnlinePlayerIds] = useState<ReadonlySet<string>>(new Set());
  const loadingRef = useRef(false);
  const syncKeyRef = useRef<string | null>(null);

  const loadStateFromServer = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/state`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("state request failed");
      const next = (await response.json()) as GameStateDto;
      setServerOffset(Date.parse(next.serverNow) - Date.now());
      setState(next);
      setLoadState("ready");
    } catch {
      setLoadState((current) => (current === "ready" ? current : "error"));
      setMessage(t("connectionError"));
    } finally {
      loadingRef.current = false;
    }
  }, [gameId, t]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadStateFromServer(), 0);
    const poll = window.setInterval(() => void loadStateFromServer(), 2_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(poll);
    };
  }, [loadStateFromServer]);

  useEffect(() => {
    const client = getBrowserSupabaseClient();
    const viewerPlayerId = state?.viewerPlayerId;
    if (!client || !viewerPlayerId) return;
    let cancelled = false;
    let channel: ReturnType<typeof client.channel> | null = null;

    void client.auth
      .getSession()
      .then(async ({ data }) => {
        if (!data.session || cancelled) return;
        await client.realtime.setAuth(data.session.access_token);
        if (cancelled) return;
        channel = client
          .channel(`game:${gameId}`, { config: { private: true } })
          .on("broadcast", { event: "state_changed" }, () => void loadStateFromServer())
          .on("presence", { event: "sync" }, () => {
            if (!channel) return;
            const ids = new Set<string>();
            for (const presences of Object.values(channel.presenceState())) {
              for (const presence of presences) {
                const playerId = (presence as { playerId?: unknown }).playerId;
                if (typeof playerId === "string") ids.add(playerId);
              }
            }
            setOnlinePlayerIds(ids);
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED" && channel) {
              void channel.track({ playerId: viewerPlayerId, onlineAt: new Date().toISOString() });
            }
          });
      })
      .catch(() => {
        // Polling remains the canonical fallback when Realtime is unavailable.
      });

    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [gameId, loadStateFromServer, state?.viewerPlayerId]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const round = state?.currentRound ?? null;
  const selectedPosition = selection && selection.roundId === round?.id ? selection.position : null;
  const viewer = state?.players.find((player) => player.id === state.viewerPlayerId);
  const secondsRemaining =
    round && (state?.status === "playing" || state?.status === "revealing")
      ? Math.max(0, Math.ceil((Date.parse(
          state.status === "revealing" ? round.revealEndsAt ?? round.endsAt : round.endsAt,
        ) - (clock + serverOffset)) / 1_000))
      : 0;

  useEffect(() => {
    if (!state || !round || secondsRemaining > 0) return;
    const key = `${state.status}:${round.id}`;
    if (syncKeyRef.current === key) return;
    syncKeyRef.current = key;
    void synchronizeGame(gameId).then(() => loadStateFromServer());
  }, [gameId, loadStateFromServer, round, secondsRemaining, state]);

  useEffect(() => {
    if (state?.status === "waiting") {
      router.replace(`/${locale}/lobby/${state.lobbyCode ?? "------"}?game=${state.id}`);
    }
  }, [locale, router, state]);

  async function confirmGuess() {
    if (!selectedPosition || !round || state?.status !== "playing" || submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await submitGuess({
        gameId,
        roundId: round.id,
        lng: selectedPosition[0],
        lat: selectedPosition[1],
      });
      if (!result.ok) setMessage(t("submitError"));
      await loadStateFromServer();
    } catch {
      setMessage(t("submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadState === "loading") return <GameLoading label={t("loading")} />;
  if (loadState === "error" || !state) {
    return <GameError title={t("errorTitle")} text={t("errorText")} home={t("backHome")} />;
  }
  if (state.status === "waiting") {
    return <GameLoading label={t("loading")} />;
  }
  if (state.status === "finished") {
    return (
      <GameResults
        cityName={state.city.name[locale]}
        citySlug={state.city.slug}
        difficulty={state.difficulty}
        gameId={gameId}
        saveBest={state.mode === "solo"}
        players={state.players.map((player) => ({
          id: player.id,
          nickname: player.nickname,
          score: player.score,
          rank: player.rank ?? 1,
          isViewer: player.id === state.viewerPlayerId,
        }))}
      />
    );
  }

  const revealing = state.status === "revealing";
  const revealedRound = revealing ? state.currentRound : null;
  const playerMarkerColors = createPlayerMarkerColorMap(
    state.players.map((player) => player.id),
  );
  const viewerMarkerColor =
    playerMarkerColors.get(state.viewerPlayerId) ?? PLAYER_MARKER_COLORS[0];
  const ownReveal = revealedRound?.guesses.find(
    (guess) => guess.playerId === state.viewerPlayerId,
  );
  const revealMarkers: RevealMarker[] =
    revealedRound?.guesses.map((guess) => ({
      id: guess.playerId,
      position: guess.position,
      nickname: state.players.find((player) => player.id === guess.playerId)?.nickname ?? "?",
      color: playerMarkerColors.get(guess.playerId) ?? PLAYER_MARKER_COLORS[0],
      isCurrentPlayer: guess.playerId === state.viewerPlayerId,
    })) ?? [];
  const roundPoints = ownReveal?.points ?? 0;
  const progress = revealing
    ? secondsRemaining / state.revealDurationSeconds
    : secondsRemaining / state.roundDurationSeconds;

  return (
    <GameBoard
      cityName={state.city.name[locale]}
      difficulty={state.difficulty}
      roundNumber={state.roundNumber}
      totalRounds={state.totalRounds}
      streetName={state.currentRound.targetStreetName}
      bounds={state.city.bounds}
      secondsRemaining={secondsRemaining}
      timerProgress={progress}
      selectedPosition={selectedPosition}
      viewerNickname={viewer?.nickname ?? "?"}
      viewerMarkerColor={viewerMarkerColor}
      setSelectedPosition={(position) => {
        if (round) setSelection({ roundId: round.id, position });
      }}
      disabled={revealing || Boolean(viewer?.hasSubmitted)}
      targetGeometry={revealedRound?.targetGeometry ?? null}
      revealMarkers={revealMarkers}
      roundResults={
        revealedRound?.guesses.map((guess) => ({
          playerId: guess.playerId,
          nickname: state.players.find((player) => player.id === guess.playerId)?.nickname ?? "?",
          points: guess.points,
          distanceMeters: guess.distanceMeters,
        })) ?? []
      }
      revealing={revealing}
      score={viewer?.score ?? 0}
      roundPoints={roundPoints}
      distanceMeters={ownReveal?.distanceMeters ?? null}
      submitted={Boolean(viewer?.hasSubmitted)}
      players={state.players.map((player) => ({
        ...player,
        isConnected: onlinePlayerIds.size > 0
          ? onlinePlayerIds.has(player.id)
          : player.isConnected,
      }))}
      message={message}
      submitting={submitting}
      onConfirm={() => void confirmGuess()}
      roundKey={state.currentRound.id}
      modeLabel={state.mode === "lobby" ? t("live") : t("online")}
    />
  );
}

function DemoGame({ gameId }: { gameId: string }) {
  const t = useTranslations("Game");
  const locale = useLocale() as Locale;
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [roundIndex, setRoundIndex] = useState(0);
  const [phase, setPhase] = useState<"playing" | "revealing" | "finished">("playing");
  const [roundStartedAt, setRoundStartedAt] = useState(() => Date.now());
  const [revealEndsAt, setRevealEndsAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [results, setResults] = useState<DemoRoundResult[]>([]);
  const finishedRoundRef = useRef<string | null>(null);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      const stored = readDemoConfig(gameId);
      setConfig(stored);
      setLoadState(stored ? "ready" : "error");
      setRoundStartedAt(Date.now());
    }, 0);
    return () => window.clearTimeout(initial);
  }, [gameId]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  const rounds = useMemo(
    () => (config ? createDemoRounds(config.citySlug, config.difficulty) : []),
    [config],
  );
  const currentRound = rounds[roundIndex];
  const secondsRemaining =
    phase === "playing"
      ? Math.max(0, Math.ceil((roundStartedAt + 60_000 - clock) / 1_000))
      : phase === "revealing"
        ? Math.max(0, Math.ceil((revealEndsAt - clock) / 1_000))
        : 0;

  const finishRound = useCallback(
    (position: Position | null) => {
      if (!currentRound || phase !== "playing" || finishedRoundRef.current === currentRound.id) return;
      finishedRoundRef.current = currentRound.id;
      const exactRemaining = Math.max(0, (roundStartedAt + 60_000 - Date.now()) / 1_000);
      const acceptedPosition = exactRemaining > 0 ? position : null;
      const distance = acceptedPosition
        ? pointToStreetDistanceMeters(acceptedPosition, currentRound.targetGeometry)
        : null;
      const points = calculateRoundScore({
        distanceMeters: distance,
        remainingSeconds: exactRemaining,
      });
      setResults((current) => [
        ...current,
        {
          roundNumber: currentRound.number,
          position: acceptedPosition,
          distanceMeters: distance,
          points,
        },
      ]);
      if (!acceptedPosition) setSelectedPosition(null);
      setRevealEndsAt(Date.now() + 5_000);
      setClock(Date.now());
      setPhase("revealing");
    },
    [currentRound, phase, roundStartedAt],
  );

  useEffect(() => {
    if (phase !== "playing" || !currentRound) return;
    const timeout = window.setTimeout(
      () => finishRound(null),
      Math.max(0, roundStartedAt + 60_000 - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [currentRound, finishRound, phase, roundStartedAt]);

  useEffect(() => {
    if (phase !== "revealing") return;
    const timeout = window.setTimeout(() => {
      if (roundIndex >= 9) {
        setPhase("finished");
        return;
      }
      setRoundIndex((current) => current + 1);
      setSelectedPosition(null);
      setRoundStartedAt(Date.now());
      setClock(Date.now());
      setPhase("playing");
      finishedRoundRef.current = null;
    }, Math.max(0, revealEndsAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [phase, revealEndsAt, roundIndex]);

  const totalScore = results.reduce((sum, result) => sum + result.points, 0);

  if (loadState === "loading") return <GameLoading label={t("loading")} />;
  if (loadState === "error" || !config || !currentRound) {
    return <GameError title={t("errorTitle")} text={t("demoMissing")} home={t("backHome")} />;
  }
  const city = findCity(config.citySlug);
  if (!city) return null;
  if (phase === "finished") {
    return (
      <GameResults
        cityName={city.name[locale]}
        citySlug={city.slug}
        difficulty={config.difficulty}
        gameId={gameId}
        demoConfig={config}
        saveBest
        players={[{ id: "demo-player", nickname: config.nickname, score: totalScore, rank: 1, isViewer: true }]}
      />
    );
  }

  const currentResult = results.find((result) => result.roundNumber === currentRound.number);
  const revealing = phase === "revealing";
  const demoMarkerColor = createPlayerMarkerColorMap(["demo-player"]).get("demo-player")
    ?? PLAYER_MARKER_COLORS[0];
  const revealMarkers: RevealMarker[] = currentResult?.position
    ? [{
        id: "demo-player",
        position: currentResult.position,
        nickname: config.nickname,
        color: demoMarkerColor,
        isCurrentPlayer: true,
      }]
    : [];

  return (
    <GameBoard
      cityName={city.name[locale]}
      difficulty={config.difficulty}
      roundNumber={currentRound.number}
      totalRounds={10}
      streetName={currentRound.targetStreetName}
      bounds={city.bounds}
      secondsRemaining={secondsRemaining}
      timerProgress={secondsRemaining / (revealing ? 5 : 60)}
      selectedPosition={selectedPosition}
      viewerNickname={config.nickname}
      viewerMarkerColor={demoMarkerColor}
      setSelectedPosition={setSelectedPosition}
      disabled={revealing}
      targetGeometry={revealing ? currentRound.targetGeometry : null}
      revealMarkers={revealMarkers}
      roundResults={currentResult ? [{
        playerId: "demo-player",
        nickname: config.nickname,
        points: currentResult.points,
        distanceMeters: currentResult.distanceMeters,
      }] : []}
      revealing={revealing}
      score={totalScore}
      roundPoints={currentResult?.points ?? 0}
      distanceMeters={currentResult?.distanceMeters ?? null}
      submitted={revealing && Boolean(currentResult?.position)}
      players={[]}
      message={null}
      submitting={false}
      onConfirm={() => finishRound(selectedPosition)}
      roundKey={currentRound.id}
      modeLabel={t("demo")}
    />
  );
}

type BoardProps = {
  cityName: string;
  difficulty: Difficulty;
  roundNumber: number;
  totalRounds: number;
  streetName: string;
  bounds: BoundingBox;
  secondsRemaining: number;
  timerProgress: number;
  selectedPosition: Position | null;
  viewerNickname: string;
  viewerMarkerColor: PlayerMarkerColor;
  setSelectedPosition: (position: Position) => void;
  disabled: boolean;
  targetGeometry: StreetGeometry | null;
  revealMarkers: readonly RevealMarker[];
  roundResults: readonly {
    playerId: string;
    nickname: string;
    points: number;
    distanceMeters: number | null;
  }[];
  revealing: boolean;
  score: number;
  roundPoints: number;
  distanceMeters: number | null;
  submitted: boolean;
  players: GameStateDto["players"];
  message: string | null;
  submitting: boolean;
  onConfirm: () => void;
  roundKey: string;
  modeLabel: string;
};

function GameBoard(props: BoardProps) {
  const t = useTranslations("Game");
  const nav = useTranslations("Nav");
  const locale = useLocale() as Locale;
  const scores = scoreFormatter(locale);
  const timerStyle = {
    "--timer-progress": `${Math.max(0, Math.min(1, props.timerProgress)) * 360}deg`,
  } as CSSProperties;
  const sortedPlayers = [...props.players].sort(
    (left, right) => right.score - left.score || left.nickname.localeCompare(right.nickname),
  );

  return (
    <main className="game-page">
      <header className="game-hud shell">
        <a className="game-wordmark" href={`/${locale}`} aria-label="Roadhunt home">
          ROAD<span>HUNT</span>
        </a>
        <div className="game-location">
          <span>{props.modeLabel}</span>
          <strong>{props.cityName}</strong>
          <small>{t(props.difficulty)}</small>
        </div>
        <div className="game-round-label">
          <span>{t("round")}</span>
          <strong>{props.roundNumber}<small>/{props.totalRounds}</small></strong>
        </div>
        <div className="game-total-score">
          <span>{t("total")}</span>
          <strong>{scores.format(props.score)}</strong>
          <small>/ 10.000</small>
        </div>
        <LanguageSwitch label={nav("language")} />
      </header>

      <section className="game-stage">
        <div className="game-map-wrap">
          <RoadMap
            bounds={props.bounds}
            selectedPosition={props.revealing ? null : props.selectedPosition}
            selectionNickname={props.viewerNickname}
            selectionColor={props.viewerMarkerColor}
            onSelect={props.setSelectedPosition}
            disabled={props.disabled}
            targetGeometry={props.targetGeometry}
            revealMarkers={props.revealMarkers}
            revealing={props.revealing}
            roundKey={props.roundKey}
            mapLabel={t("mapLabel")}
            keyboardHint={t("keyboardHint")}
            selectionLabel={t("yourGuess")}
            unavailableLabel={t("mapUnavailable")}
          />
          <div className="map-corner-note" aria-hidden="true">{t("mapMode")}</div>
          {props.revealing ? (
            <div className="reveal-banner">
              <span>{t("targetStreet")}</span>
              <strong>{props.streetName}</strong>
            </div>
          ) : null}
        </div>

        <aside className={`game-panel ${props.revealing ? "is-revealing" : ""}`}>
          <div className="game-timer" style={timerStyle} aria-label={t("secondsLeft", { count: props.secondsRemaining })}>
            <div><strong>{props.secondsRemaining}</strong><span>{props.revealing ? t("nextRound") : t("seconds")}</span></div>
          </div>

          {props.revealing ? (
            <div className="round-reveal-card" aria-live="polite">
              <span className="panel-kicker">{t("result")}</span>
              <h1>{props.roundPoints > 0 ? `+${scores.format(props.roundPoints)}` : "0"}</h1>
              <p>{t("points")}</p>
              <dl>
                <div><dt>{t("distance")}</dt><dd>{formatDistance(props.distanceMeters, locale)}</dd></div>
                <div><dt>{t("street")}</dt><dd>{props.streetName}</dd></div>
              </dl>
              <ol className="round-player-results">
                {props.roundResults.map((result) => (
                  <li key={result.playerId}>
                    <span>{result.nickname}</span>
                    <small>{formatDistance(result.distanceMeters, locale)}</small>
                    <strong>+{scores.format(result.points)}</strong>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="street-task">
              <span className="panel-kicker">{t("findStreet")}</span>
              <h1>{props.streetName}</h1>
              <p>{props.submitted ? t("waitingForPlayers") : t("placeHint")}</p>
            </div>
          )}

          {!props.revealing ? (
            <button
              className="confirm-guess"
              type="button"
              disabled={!props.selectedPosition || props.disabled || props.submitting}
              onClick={props.onConfirm}
            >
              <span>
                {props.submitted
                  ? t("submitted")
                  : props.submitting
                    ? t("submitting")
                    : props.selectedPosition
                      ? t("confirm")
                      : t("selectFirst")}
              </span>
              <b aria-hidden="true">✓</b>
            </button>
          ) : null}

          {props.message ? <p className="game-message" role="status">{props.message}</p> : null}

          {sortedPlayers.length > 1 ? (
            <div className="mini-scoreboard">
              <span className="panel-kicker">{t("scoreboard")}</span>
              <ol>
                {sortedPlayers.map((player, index) => (
                  <li key={player.id}>
                    <b>{index + 1}</b>
                    <span>{player.nickname}</span>
                    <strong>{scores.format(player.score)}</strong>
                    <i className={player.hasSubmitted ? "done" : ""} aria-label={player.hasSubmitted ? t("submitted") : t("searching")} />
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

type ResultPlayer = {
  id: string;
  nickname: string;
  score: number;
  rank: number;
  isViewer: boolean;
};

function GameResults({
  cityName,
  citySlug,
  difficulty,
  gameId,
  players,
  demoConfig,
  saveBest = false,
}: {
  cityName: string;
  citySlug?: string;
  difficulty: Difficulty;
  gameId: string;
  players: readonly ResultPlayer[];
  demoConfig?: DemoConfig;
  saveBest?: boolean;
}) {
  const t = useTranslations("Game");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const scores = scoreFormatter(locale);
  const sorted = [...players].sort((left, right) => left.rank - right.rank);
  const viewer = sorted.find((player) => player.isViewer) ?? sorted[0];
  const viewerScore = viewer?.score;
  const [rematchPending, setRematchPending] = useState(false);
  const [rematchError, setRematchError] = useState(false);

  useEffect(() => {
    if (saveBest && citySlug && viewerScore !== undefined) {
      saveLocalBestScore(citySlug, difficulty, viewerScore);
    }
  }, [citySlug, difficulty, saveBest, viewerScore]);

  async function rematch() {
    if (demoConfig) {
      const nextId = `demo-${crypto.randomUUID()}`;
      window.sessionStorage.setItem(`roadhunt:game:${nextId}`, JSON.stringify(demoConfig));
      router.replace(`/${locale}/game/${nextId}`);
      return;
    }

    if (rematchPending) return;
    setRematchPending(true);
    setRematchError(false);
    try {
      const result = await createRematch(gameId);
      if (!result.ok) {
        setRematchError(true);
        return;
      }

      const nextId = result.data.id;
      const nextCode = result.data.lobbyCode;
      const nextStatus = result.data.status;
      if (typeof nextId !== "string" || nextId.length === 0) {
        setRematchError(true);
        return;
      }

      if (nextStatus === "waiting" && typeof nextCode === "string" && nextCode.length > 0) {
        router.replace(
          `/${locale}/lobby/${encodeURIComponent(nextCode)}?game=${encodeURIComponent(nextId)}`,
        );
      } else {
        router.replace(`/${locale}/game/${encodeURIComponent(nextId)}`);
      }
    } catch {
      setRematchError(true);
    } finally {
      setRematchPending(false);
    }
  }

  return (
    <main className="results-page">
      <a className="game-wordmark results-logo" href={`/${locale}`} aria-label="Roadhunt home">
        ROAD<span>HUNT</span>
      </a>
      <section className="results-card">
        <span className="results-kicker">{t("huntComplete")}</span>
        <h1>{t("finalTitle")}</h1>
        <p>{cityName} · {t(difficulty)} · 10 {t("streets")}</p>

        {sorted.length > 1 ? (
          <div className="podium" aria-label={t("podium")}>
            {sorted.slice(0, 3).map((player) => (
              <article className={`podium-place place-${player.rank}`} key={player.id}>
                <span>{player.rank}</span>
                <strong>{player.nickname}</strong>
                <b>{scores.format(player.score)}</b>
              </article>
            ))}
          </div>
        ) : (
          <div className="solo-result-score">
            <span>{t("yourScore")}</span>
            <strong>{scores.format(viewer?.score ?? 0)}</strong>
            <small>/ 10.000</small>
          </div>
        )}

        {sorted.length > 1 ? (
          <ol className="final-ranking">
            {sorted.map((player) => (
              <li className={player.isViewer ? "is-viewer" : ""} key={player.id}>
                <b>{player.rank}</b><span>{player.nickname}</span><strong>{scores.format(player.score)}</strong>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="results-actions">
          <button
            className="submit-hunt"
            type="button"
            disabled={rematchPending}
            onClick={() => void rematch()}
          >
            <span>{rematchPending ? t("rematchStarting") : t("rematch")}</span><b>↻</b>
          </button>
          <a className="results-home" href={`/${locale}`}>{t("backHome")}</a>
        </div>
        {rematchError ? <p className="game-message" role="alert">{t("rematchError")}</p> : null}
      </section>
    </main>
  );
}

function GameLoading({ label }: { label: string }) {
  return <main className="game-system-screen"><div className="road-loader" /><p>{label}</p></main>;
}

function GameError({ title, text, home }: { title: string; text: string; home: string }) {
  const locale = useLocale();
  return (
    <main className="game-system-screen">
      <span className="error-sign">!</span><h1>{title}</h1><p>{text}</p>
      <a className="cta-button" href={`/${locale}`}>{home}<b>→</b></a>
    </main>
  );
}

export function GameClient({ gameId }: { gameId: string }) {
  return gameId.startsWith("demo-")
    ? <DemoGame gameId={gameId} key={gameId} />
    : <LiveGame gameId={gameId} key={gameId} />;
}
