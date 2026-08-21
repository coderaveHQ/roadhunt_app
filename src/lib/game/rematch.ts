import type { GameMode, GameStatus } from "./types";

export interface RematchEligibility {
  readonly mode: GameMode;
  readonly status: GameStatus;
  readonly activePlayerCount: number;
}

/** Mirrors the authoritative player-count rules enforced by `create_rematch`. */
export function canCreateRematch({
  mode,
  status,
  activePlayerCount,
}: RematchEligibility): boolean {
  if (status !== "finished") return false;
  return mode === "solo"
    ? activePlayerCount === 1
    : activePlayerCount >= 2 && activePlayerCount <= 8;
}
