"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { createGame, joinGame } from "@/lib/game-actions";
import { CITIES } from "@/lib/game/catalog";
import { validateNickname } from "@/lib/game/normalization";
import {
  CATALOG_SEARCH_LIMIT,
  CATALOG_SEARCH_QUERY_MAX_LENGTH,
  citySearchDisambiguators,
  isDifficultyAvailable,
  launchCityOptions,
  parseCitySearchResponse,
  playableDifficulty,
  type CityCatalogOption,
} from "@/lib/game/setup-catalog";
import type { Locale } from "@/i18n/routing";

type Mode = "solo" | "lobby" | "join";
type Difficulty = "easy" | "medium" | "hard" | "insane";

const difficulties: Difficulty[] = ["easy", "medium", "hard", "insane"];
const citySearchDebounceMs = 250;

type CitySearchPhase = "idle" | "debouncing" | "loading" | "success" | "error";

interface CitySearchState {
  readonly phase: CitySearchPhase;
  readonly cities: readonly CityCatalogOption[];
}

export function GameSetup({
  initialCities,
  initialMode,
  initialCode = "",
}: {
  initialCities: readonly CityCatalogOption[];
  initialMode: Mode;
  initialCode?: string;
}) {
  const t = useTranslations("Play");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const launchCities = useMemo(
    () => launchCityOptions(initialCities, locale),
    [initialCities, locale],
  );
  const defaultCity = launchCities.find((city) => city.slug === "duesseldorf") ?? launchCities[0]!;
  const [mode, setMode] = useState<Mode>(initialMode);
  const [nickname, setNickname] = useState("Roadrunner");
  const [selectedCity, setSelectedCity] = useState<CityCatalogOption>(defaultCity);
  const [difficulty, setDifficulty] = useState<Difficulty>(() =>
    playableDifficulty(defaultCity, "medium") ?? "medium",
  );
  const [citySearch, setCitySearch] = useState("");
  const [citySearchState, setCitySearchState] = useState<CitySearchState>({
    phase: "idle",
    cities: [],
  });
  const latestCitySearch = useRef("");
  const citySearchRequest = useRef(0);
  const citySearchAbortController = useRef<AbortController | null>(null);
  const [code, setCode] = useState(initialCode);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const initial = window.setTimeout(() => {
      const stored = window.localStorage.getItem("roadhunt:nickname");
      if (stored) setNickname(stored);
    }, 0);
    return () => window.clearTimeout(initial);
  }, []);

  useEffect(() => {
    const query = citySearch.trim();
    const requestId = ++citySearchRequest.current;
    citySearchAbortController.current?.abort();

    if (mode === "join" || !query) return;

    const controller = new AbortController();
    citySearchAbortController.current = controller;
    const timeout = window.setTimeout(async () => {
      if (controller.signal.aborted || requestId !== citySearchRequest.current) return;
      setCitySearchState({ phase: "loading", cities: [] });

      try {
        const parameters = new URLSearchParams({
          locale,
          q: query,
          limit: String(CATALOG_SEARCH_LIMIT),
        });
        const response = await fetch(`/api/catalog/cities?${parameters}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("catalog_search_failed");

        const cities = parseCitySearchResponse(await response.json());
        if (cities === null) throw new Error("catalog_search_invalid_response");
        if (
          controller.signal.aborted
          || requestId !== citySearchRequest.current
          || latestCitySearch.current.trim() !== query
        ) return;
        setCitySearchState({ phase: "success", cities });
      } catch (error) {
        if (
          controller.signal.aborted
          || requestId !== citySearchRequest.current
          || (error instanceof DOMException && error.name === "AbortError")
        ) return;
        setCitySearchState({
          phase: "error",
          cities: launchCities,
        });
      }
    }, citySearchDebounceMs);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [citySearch, launchCities, locale, mode]);

  const citySlug = selectedCity.slug;
  const searchActive = citySearch.trim().length > 0;
  const visibleCities = searchActive ? citySearchState.cities : launchCities;
  const searchDisambiguators = useMemo(
    () => citySearchState.phase === "success"
      ? citySearchDisambiguators(visibleCities, locale)
      : new Map<string, string | null>(),
    [citySearchState.phase, locale, visibleCities],
  );
  const searchBusy = citySearchState.phase === "debouncing"
    || citySearchState.phase === "loading";
  const selectedCityHasPlayableDifficulty = difficulties.some((candidate) =>
    isDifficultyAvailable(selectedCity, candidate),
  );

  function selectCity(city: CityCatalogOption) {
    setSelectedCity(city);
    setDifficulty((current) => playableDifficulty(city, current) ?? current);
    setMessage(null);
  }

  function updateCitySearch(value: string) {
    latestCitySearch.current = value;
    citySearchAbortController.current?.abort();
    citySearchRequest.current += 1;
    setCitySearch(value);
    setCitySearchState({
      phase: value.trim() ? "debouncing" : "idle",
      cities: [],
    });
  }

  function navigateToGame(gameId: string) {
    router.push(`/${locale}/game/${gameId}`);
  }

  function startDemo() {
    const gameId = `demo-${crypto.randomUUID()}`;
    window.sessionStorage.setItem(
      `roadhunt:game:${gameId}`,
      JSON.stringify({ citySlug, difficulty, nickname, mode: "solo" }),
    );
    setMessage(t("backendUnavailable"));
    window.setTimeout(() => navigateToGame(gameId), 350);
  }

  function submit() {
    setMessage(null);
    if (mode !== "join" && !selectedCityHasPlayableDifficulty) {
      setMessage(t("cityUnavailable"));
      return;
    }
    const nicknameResult = validateNickname(nickname);
    if (!nicknameResult.success) {
      setMessage(t("invalidInput"));
      return;
    }
    const cleanNickname = nicknameResult.value;
    window.localStorage.setItem("roadhunt:nickname", cleanNickname);

    startTransition(async () => {
      if (mode === "join") {
        const result = await joinGame({ code, nickname: cleanNickname });
        if (!result.ok) {
          setMessage(
            result.error === "backend_unavailable"
              ? t("lobbyNeedsBackend")
              : result.error === "invalid_input"
                ? t("invalidInput")
                : t("requestFailed"),
          );
          return;
        }
        const gameId = String(result.data.id ?? result.data.gameId ?? result.data.game_id ?? "");
        if (!gameId) return setMessage(t("requestFailed"));
        router.push(`/${locale}/lobby/${code.trim().toUpperCase()}?game=${gameId}`);
        return;
      }

      const result = await createGame({
        mode,
        citySlug,
        difficulty,
        nickname: cleanNickname,
      });
      if (!result.ok) {
        if (result.error === "backend_unavailable" && mode === "solo") {
          if (CITIES.some((city) => city.slug === citySlug)) {
            startDemo();
          } else {
            setMessage(t("searchedCityNeedsBackend"));
          }
          return;
        }
        setMessage(
          result.error === "backend_unavailable"
            ? t("lobbyNeedsBackend")
            : result.error === "invalid_input"
              ? t("invalidInput")
              : t("requestFailed"),
        );
        return;
      }

      const gameId = String(result.data.id ?? result.data.gameId ?? result.data.game_id ?? "");
      if (!gameId) return setMessage(t("requestFailed"));
      if (mode === "lobby") {
        const lobbyCode = String(result.data.lobbyCode ?? result.data.code ?? "");
        router.push(`/${locale}/lobby/${lobbyCode}?game=${gameId}`);
      } else {
        navigateToGame(gameId);
      }
    });
  }

  return (
    <div className="setup-layout shell">
      <section className="setup-copy">
        <span className="eyebrow"><span />{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
        <div className="setup-facts">{t("roundFacts")}</div>
      </section>

      <section className="setup-card" aria-label={t("title")}>
        <div className="mode-tabs" role="tablist" aria-label="Game mode">
          {(["solo", "lobby", "join"] as Mode[]).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={mode === item}
              className={mode === item ? "active" : ""}
              onClick={() => { setMode(item); setMessage(null); }}
            >
              {t(item)}
            </button>
          ))}
        </div>

        <label className="field-label" htmlFor="nickname">{t("nickname")}</label>
        <input
          id="nickname"
          className="text-input"
          value={nickname}
          maxLength={20}
          placeholder={t("nicknamePlaceholder")}
          onChange={(event) => setNickname(event.target.value)}
        />

        {mode === "join" ? (
          <>
            <label className="field-label" htmlFor="lobby-code">{t("code")}</label>
            <input
              id="lobby-code"
              className="text-input code-input"
              value={code}
              maxLength={6}
              autoCapitalize="characters"
              placeholder={t("codePlaceholder")}
              onChange={(event) => setCode(
                event.target.value
                  .toUpperCase()
                  .replace(/[^2-9A-HJKMNP-Z]/g, "")
                  .slice(0, 6),
              )}
            />
          </>
        ) : (
          <>
            <div className="field-label" id="city-picker-label">{t("city")}</div>
            <label className="city-search" htmlFor="city-search">
              <span className="sr-only">{t("citySearch")}</span>
              <span aria-hidden="true">⌕</span>
              <input
                id="city-search"
                type="search"
                value={citySearch}
                autoComplete="off"
                aria-describedby={searchActive ? "city-search-feedback" : undefined}
                enterKeyHint="search"
                maxLength={CATALOG_SEARCH_QUERY_MAX_LENGTH * 4}
                placeholder={t("citySearchPlaceholder")}
                spellCheck={false}
                onChange={(event) => updateCitySearch(event.target.value)}
              />
            </label>
            {searchActive ? (
              <p
                className={citySearchState.phase === "error"
                  ? "city-search-status city-search-error"
                  : "city-search-status"}
                id="city-search-feedback"
                role={citySearchState.phase === "error" ? "alert" : "status"}
                aria-atomic="true"
              >
                {searchBusy
                  ? t("citySearchLoading")
                  : citySearchState.phase === "error"
                    ? t("citySearchError")
                    : t("citySearchResults", { count: visibleCities.length })}
              </p>
            ) : null}
            <div
              className="city-grid"
              role="radiogroup"
              aria-labelledby="city-picker-label"
              aria-describedby="selected-location-summary"
              aria-busy={searchBusy}
            >
              {visibleCities.map((city) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={citySlug === city.slug}
                  className={citySlug === city.slug ? "selected" : ""}
                  key={city.slug}
                  onClick={() => selectCity(city)}
                >
                  <span>{city.name}</span>
                  {searchDisambiguators.get(city.slug) ? (
                    <span className="city-disambiguator">
                      {searchDisambiguators.get(city.slug)}
                    </span>
                  ) : null}
                  {citySlug === city.slug ? <small aria-hidden="true">{t("selected")}</small> : null}
                </button>
              ))}
            </div>
            {searchActive && citySearchState.phase === "success" && visibleCities.length === 0 ? (
              <p className="city-search-empty">{t("citySearchEmpty")}</p>
            ) : null}

            <div className="field-label">{t("difficulty")}</div>
            <div className="difficulty-grid" role="radiogroup" aria-label={t("difficulty")}>
              {difficulties.map((item, index) => {
                const available = isDifficultyAvailable(selectedCity, item);
                const count = selectedCity.difficultyCounts?.[item] ?? null;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={difficulty === item}
                    className={difficulty === item ? "selected" : ""}
                    disabled={!available}
                    key={item}
                    onClick={() => { setDifficulty(item); setMessage(null); }}
                  >
                    <span className="difficulty-dots" aria-hidden="true">
                      {Array.from({ length: 4 }, (_, dot) => <i className={dot <= index ? "on" : ""} key={dot} />)}
                    </span>
                    <strong>{t(item)}</strong>
                    <small>{t(`${item}Hint`)}</small>
                    {!available && count !== null ? (
                      <em>{t("difficultyUnavailable", { count })}</em>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {!selectedCityHasPlayableDifficulty ? (
              <p className="city-unavailable" role="status">{t("cityUnavailable")}</p>
            ) : null}
          </>
        )}

        {message ? <p className="form-message" role="status">{message}</p> : null}
        <button
          className="submit-hunt"
          type="button"
          onClick={submit}
          disabled={isPending || (mode !== "join" && !selectedCityHasPlayableDifficulty)}
        >
          <span>{isPending ? "…" : t(mode === "solo" ? "startSolo" : mode === "lobby" ? "createLobby" : "joinLobby")}</span>
          <b aria-hidden="true">→</b>
        </button>

        {mode !== "join" && selectedCity ? (
          <div className="selected-location" id="selected-location-summary" aria-live="polite">
            <span aria-hidden="true">⌖</span>
            <span><span className="sr-only">{t("selected")}: </span>{selectedCity.name} · {t(difficulty)}</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
