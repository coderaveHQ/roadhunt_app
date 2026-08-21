import type { Difficulty } from "./types";

export interface StreetDifficultyInput {
  readonly lengthMeters: number;
  readonly highwayTypes?: readonly string[];
  readonly override?: Difficulty | null;
}

function hasRoadClass(highwayTypes: readonly string[], classes: readonly string[]) {
  return highwayTypes.some((value) => {
    const normalized = value.trim().toLowerCase().replace(/_link$/u, "");
    return classes.includes(normalized);
  });
}

/** Implements the deterministic MVP thresholds in descending priority. */
export function classifyDifficulty(input: StreetDifficultyInput): Difficulty {
  if (!Number.isFinite(input.lengthMeters) || input.lengthMeters <= 0) {
    throw new RangeError("Street length must be a positive finite number");
  }
  if (input.override) return input.override;

  const types = input.highwayTypes ?? [];
  if (input.lengthMeters >= 2_000 || hasRoadClass(types, ["trunk", "primary", "secondary"])) {
    return "easy";
  }
  if (input.lengthMeters >= 1_000 || hasRoadClass(types, ["tertiary"])) {
    return "medium";
  }
  return input.lengthMeters >= 400 ? "hard" : "insane";
}

/** Explicit extension point for reviewed street-specific corrections. */
export const DIFFICULTY_OVERRIDES: Readonly<Record<string, Difficulty>> = Object.freeze({});

export function getDifficultyOverride(
  citySlug: string,
  normalizedStreetName: string,
): Difficulty | null {
  return DIFFICULTY_OVERRIDES[`${citySlug}:${normalizedStreetName}`] ?? null;
}
