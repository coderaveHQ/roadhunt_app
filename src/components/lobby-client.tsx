"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { leaveGame, startGame } from "@/lib/game-actions";
import type { Locale } from "@/i18n/routing";
import type { GameStateDto } from "@/lib/game/types";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

const MAX_PLAYERS = 8;
const POLL_INTERVAL_MS = 2_000;
const GAME_STATUSES = new Set(["waiting", "playing", "revealing", "finished"]);

type ErrorKey =
  | "backendUnavailable"
  | "invalidGame"
  | "notAuthenticated"
  | "requestFailed";

type PendingAction = "copy" | "leave" | "start" | null;

type LobbyClientProps = {
  gameId: string;
  initialCode: string;
  locale: Locale;
};

function isGameState(value: unknown): value is GameStateDto {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.status === "string" &&
    GAME_STATUSES.has(candidate.status) &&
    typeof candidate.viewerIsHost === "boolean" &&
    Array.isArray(candidate.players) &&
    candidate.city !== null &&
    typeof candidate.city === "object"
  );
}

function actionErrorKey(error: string): ErrorKey {
  if (error === "backend_unavailable") return "backendUnavailable";
  if (error === "not_authenticated") return "notAuthenticated";
  if (error === "invalid_input") return "invalidGame";
  return "requestFailed";
}

function responseErrorKey(status: number): ErrorKey {
  if (status === 401) return "notAuthenticated";
  if (status === 400 || status === 404) return "invalidGame";
  if (status === 503) return "backendUnavailable";
  return "requestFailed";
}

function actionGameId(data: Record<string, unknown>, fallback: string) {
  const value = data.id ?? data.gameId ?? data.game_id;
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function playerInitials(nickname: string) {
  return Array.from(nickname.trim()).slice(0, 2).join("").toUpperCase();
}

function canonicalCanStart(state: GameStateDto) {
  const value = (state as unknown as { canStart?: unknown }).canStart;
  return value === undefined ? state.players.length >= 2 : value === true;
}

function localizedCityName(state: GameStateDto, locale: Locale) {
  const city = state.city as unknown as {
    name?: Partial<Record<Locale, string>>;
    names?: Partial<Record<Locale, string>>;
    slug?: string;
  };
  return city.name?.[locale] ?? city.names?.[locale] ?? city.slug ?? "";
}

export function LobbyClient({ gameId, initialCode, locale }: LobbyClientProps) {
  const t = useTranslations("Lobby");
  const router = useRouter();
  const [state, setState] = useState<GameStateDto | null>(null);
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [copySucceeded, setCopySucceeded] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [onlinePlayerIds, setOnlinePlayerIds] = useState<ReadonlySet<string>>(new Set());

  const lobbyCode = (state?.lobbyCode ?? initialCode).toUpperCase();
  const playerCount = state?.players.length ?? 0;
  const canStart = Boolean(
    state?.status === "waiting" &&
      state.viewerIsHost &&
      playerCount >= 2 &&
      playerCount <= MAX_PLAYERS &&
      canonicalCanStart(state),
  );

  const gameStatus = state?.status;
  const gamePath = `/${locale}/game/${encodeURIComponent(state?.id ?? gameId)}`;

  useEffect(() => {
    if (gameStatus && gameStatus !== "waiting") {
      router.replace(gamePath);
    }
  }, [gamePath, gameStatus, router]);

  useEffect(() => {
    const controller = new AbortController();
    let requestInFlight = false;

    async function loadState() {
      if (requestInFlight) return;
      requestInFlight = true;

      try {
        const response = await fetch(
          `/api/games/${encodeURIComponent(gameId)}/state`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          setErrorKey(responseErrorKey(response.status));
          return;
        }

        const payload: unknown = await response.json();
        if (!isGameState(payload) || payload.id !== gameId) {
          setErrorKey("invalidGame");
          return;
        }

        setState(payload);
        setErrorKey(null);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setErrorKey("requestFailed");
        }
      } finally {
        requestInFlight = false;
        setIsLoading(false);
      }
    }

    void loadState();
    const poll = window.setInterval(() => void loadState(), POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
  }, [gameId, refreshVersion]);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    const viewerPlayerId = state?.viewerPlayerId;
    if (!supabase || !viewerPlayerId) return;
    const client = supabase;

    let cancelled = false;
    let channel: ReturnType<typeof client.channel> | null = null;

    async function subscribe() {
      const { data } = await client.auth.getSession();
      if (!data.session || cancelled) return;

      await client.realtime.setAuth(data.session.access_token);
      if (cancelled) return;

      channel = client
        .channel(`game:${gameId}`, { config: { private: true } })
        .on("broadcast", { event: "state_changed" }, () => {
          setRefreshVersion((version) => version + 1);
        })
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
    }

    void subscribe().catch(() => {
      // Polling remains the canonical fallback when Realtime is unavailable.
    });

    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [gameId, state?.viewerPlayerId]);

  async function copyLobbyLink() {
    setPendingAction("copy");
    setCopySucceeded(false);

    try {
      const path = `/${locale}/play?mode=join&code=${encodeURIComponent(lobbyCode)}`;
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopySucceeded(true);
    } catch {
      setErrorKey("requestFailed");
    } finally {
      setPendingAction(null);
    }
  }

  async function beginGame() {
    if (!canStart || pendingAction) return;
    setPendingAction("start");
    setErrorKey(null);

    try {
      const result = await startGame(gameId);
      if (!result.ok) {
        setErrorKey(actionErrorKey(result.error));
        return;
      }

      const startedGameId = actionGameId(result.data, gameId);
      router.replace(`/${locale}/game/${encodeURIComponent(startedGameId)}`);
    } catch {
      setErrorKey("requestFailed");
    } finally {
      setPendingAction(null);
    }
  }

  async function leaveLobby() {
    if (pendingAction) return;
    const returnMode = state?.viewerIsHost ? "lobby" : "join";
    setPendingAction("leave");
    setErrorKey(null);

    try {
      const result = await leaveGame(gameId);
      if (!result.ok) {
        setErrorKey(actionErrorKey(result.error));
        return;
      }

      router.replace(`/${locale}/play?mode=${returnMode}`);
    } catch {
      setErrorKey("requestFailed");
    } finally {
      setPendingAction(null);
    }
  }

  if (isLoading && !state) {
    return (
      <section className="lobby-shell shell" aria-live="polite">
        <div className="lobby-card lobby-card-loading">
          <span className="lobby-eyebrow">{t("eyebrow")}</span>
          <h1 className="lobby-title">{t("title")}</h1>
          <p className="lobby-loading">{t("loading")}</p>
        </div>
      </section>
    );
  }

  if (!state) {
    return (
      <section className="lobby-shell shell">
        <div className="lobby-card lobby-card-error">
          <span className="lobby-eyebrow">{t("eyebrow")}</span>
          <h1 className="lobby-title">{t("title")}</h1>
          <p className="lobby-error" role="alert">
            {t(errorKey ?? "requestFailed")}
          </p>
          <button
            className="lobby-retry"
            type="button"
            onClick={() => {
              setIsLoading(true);
              setRefreshVersion((version) => version + 1);
            }}
          >
            {t("retry")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="lobby-shell shell" aria-labelledby="lobby-title">
      <div className="lobby-card">
        <div className="lobby-heading">
          <div className="lobby-heading-copy">
            <span className="lobby-eyebrow">{t("eyebrow")}</span>
            <h1 className="lobby-title" id="lobby-title">{t("title")}</h1>
            <p className="lobby-subtitle">
              {localizedCityName(state, locale)} · {state.difficulty.toUpperCase()}
            </p>
          </div>

          <div className="lobby-code-block">
            <span className="lobby-code-label">{t("codeLabel")}</span>
            <strong className="lobby-code">{lobbyCode}</strong>
            <button
              className="lobby-copy"
              type="button"
              disabled={pendingAction !== null}
              onClick={copyLobbyLink}
            >
              {pendingAction === "copy"
                ? t("copying")
                : copySucceeded
                  ? t("copied")
                  : t("copyLink")}
            </button>
          </div>
        </div>

        <div className="lobby-player-heading">
          <h2 className="lobby-player-title">{t("players")}</h2>
          <span className="lobby-player-count">
            {t("playerCount", { count: playerCount, max: MAX_PLAYERS })}
          </span>
        </div>

        <div className="lobby-slots" aria-hidden="true">
          {Array.from({ length: MAX_PLAYERS }, (_, index) => (
            <i
              className={index < playerCount ? "lobby-slot lobby-slot-filled" : "lobby-slot"}
              key={index}
            />
          ))}
        </div>

        <ul className="lobby-player-list">
          {state.players.map((player) => (
            <li className="lobby-player" key={player.id}>
              <span className="lobby-avatar" aria-hidden="true">
                {playerInitials(player.nickname)}
              </span>
              <span className="lobby-player-name">
                <strong>{player.nickname}</strong>
                <small>
                  <i className={onlinePlayerIds.size === 0 || onlinePlayerIds.has(player.id) ? "online" : ""} />
                  {onlinePlayerIds.size === 0 || onlinePlayerIds.has(player.id) ? t("online") : t("offline")}
                </small>
              </span>
              <span className="lobby-badges">
                {player.id === state.viewerPlayerId ? (
                  <small className="lobby-badge lobby-badge-you">{t("you")}</small>
                ) : null}
                {player.isHost ? (
                  <small className="lobby-badge lobby-badge-host">{t("host")}</small>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        <p className="lobby-status" aria-live="polite">
          {playerCount < 2
            ? t("waitingForPlayers")
            : state.viewerIsHost
              ? t("readyToStart")
              : t("waitingForHost")}
        </p>

        {errorKey ? (
          <p className="lobby-error" role="alert">{t(errorKey)}</p>
        ) : null}

        <div className="lobby-actions">
          {state.viewerIsHost ? (
            <button
              className="lobby-start"
              type="button"
              disabled={!canStart || pendingAction !== null}
              onClick={beginGame}
            >
              <span>{pendingAction === "start" ? t("starting") : t("startGame")}</span>
              <b aria-hidden="true">→</b>
            </button>
          ) : null}
          <button
            className="lobby-leave"
            type="button"
            disabled={pendingAction !== null}
            onClick={leaveLobby}
          >
            {pendingAction === "leave" ? t("leaving") : t("leaveLobby")}
          </button>
        </div>
      </div>
    </section>
  );
}
