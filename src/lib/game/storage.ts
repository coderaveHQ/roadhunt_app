import { DIFFICULTIES, type Difficulty } from "./types";

export const LOCAL_BESTS_STORAGE_KEY = "roadhunt:local-bests:v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalBestScore {
  readonly citySlug: string;
  readonly difficulty: Difficulty;
  readonly score: number;
  readonly achievedAt: string;
}

interface StoredBestScores {
  readonly version: 1;
  readonly scores: Record<string, LocalBestScore>;
}

function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && DIFFICULTIES.includes(value as Difficulty);
}

const citySlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isStoredCitySlug(value: unknown): value is string {
  return typeof value === "string" && citySlugPattern.test(value);
}

function bestKey(citySlug: string, difficulty: Difficulty): string {
  return `${citySlug}:${difficulty}`;
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(storage: StorageLike | null | undefined): StorageLike | null {
  return storage === undefined ? browserStorage() : storage;
}

function emptyStore(): StoredBestScores {
  return { version: 1, scores: {} };
}

function parseStore(raw: string | null): StoredBestScores {
  if (!raw) return emptyStore();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) {
      return emptyStore();
    }
    const candidates = (parsed as { scores?: unknown }).scores;
    if (!candidates || typeof candidates !== "object" || Array.isArray(candidates)) {
      return emptyStore();
    }

    const scores: Record<string, LocalBestScore> = {};
    for (const value of Object.values(candidates)) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Partial<LocalBestScore>;
      if (
        !isStoredCitySlug(candidate.citySlug) ||
        !isDifficulty(candidate.difficulty) ||
        typeof candidate.score !== "number" ||
        !Number.isInteger(candidate.score) ||
        candidate.score < 0 ||
        candidate.score > 10_000 ||
        typeof candidate.achievedAt !== "string" ||
        !Number.isFinite(Date.parse(candidate.achievedAt))
      ) {
        continue;
      }
      scores[bestKey(candidate.citySlug, candidate.difficulty)] = candidate as LocalBestScore;
    }
    return { version: 1, scores };
  } catch {
    return emptyStore();
  }
}

function readStore(storage: StorageLike | null): StoredBestScores {
  if (!storage) return emptyStore();
  try {
    return parseStore(storage.getItem(LOCAL_BESTS_STORAGE_KEY));
  } catch {
    return emptyStore();
  }
}

export function readLocalBestScores(
  storage?: StorageLike | null,
): readonly LocalBestScore[] {
  return Object.values(readStore(resolveStorage(storage)).scores).sort(
    (left, right) => right.score - left.score || left.achievedAt.localeCompare(right.achievedAt),
  );
}

export function readLocalBestScore(
  citySlug: string,
  difficulty: Difficulty,
  storage?: StorageLike | null,
): LocalBestScore | null {
  if (!isStoredCitySlug(citySlug)) return null;
  return readStore(resolveStorage(storage)).scores[bestKey(citySlug, difficulty)] ?? null;
}

export interface SaveLocalBestResult {
  readonly best: LocalBestScore;
  readonly improved: boolean;
  readonly persisted: boolean;
}

export function saveLocalBestScore(
  citySlug: string,
  difficulty: Difficulty,
  score: number,
  achievedAt = new Date().toISOString(),
  storage?: StorageLike | null,
): SaveLocalBestResult {
  if (!isStoredCitySlug(citySlug)) {
    throw new TypeError("citySlug must be a normalized lowercase slug");
  }
  if (!Number.isInteger(score) || score < 0 || score > 10_000) {
    throw new RangeError("A game score must be an integer from 0 to 10000");
  }
  if (!Number.isFinite(Date.parse(achievedAt))) {
    throw new TypeError("achievedAt must be an ISO-compatible date string");
  }

  const target = resolveStorage(storage);
  const store = readStore(target);
  const key = bestKey(citySlug, difficulty);
  const previous = store.scores[key];
  if (previous && previous.score >= score) {
    return { best: previous, improved: false, persisted: target !== null };
  }

  const best: LocalBestScore = { citySlug, difficulty, score, achievedAt };
  const next: StoredBestScores = {
    version: 1,
    scores: { ...store.scores, [key]: best },
  };
  if (!target) return { best, improved: true, persisted: false };
  try {
    target.setItem(LOCAL_BESTS_STORAGE_KEY, JSON.stringify(next));
    return { best, improved: true, persisted: true };
  } catch {
    return { best, improved: true, persisted: false };
  }
}

export function clearLocalBestScores(storage?: StorageLike | null): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.removeItem(LOCAL_BESTS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
