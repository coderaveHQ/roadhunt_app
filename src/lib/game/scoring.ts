export const ROUND_DURATION_SECONDS = 60;
export const REVEAL_DURATION_SECONDS = 5;
export const ROUNDS_PER_GAME = 10;
export const MAX_SCORING_DISTANCE_METERS = 500;
// OSM stores road centerlines, so this radius models the clickable road surface.
export const STREET_HIT_RADIUS_METERS = 15;
export const MAX_ROUND_SCORE = 1_000;
export const MAX_GAME_SCORE = ROUNDS_PER_GAME * MAX_ROUND_SCORE;

export interface RoundScoreInput {
  readonly distanceMeters: number | null;
  readonly remainingSeconds: number;
  readonly roundDurationSeconds?: number;
}

export function calculateAccuracy(distanceMeters: number | null): number {
  if (distanceMeters === null || !Number.isFinite(distanceMeters)) return 0;
  const distance = Math.max(0, distanceMeters);
  const linearAccuracy = Math.max(0, 1 - distance / MAX_SCORING_DISTANCE_METERS);
  return linearAccuracy * linearAccuracy;
}

export function calculateRoundScore(input: RoundScoreInput): number {
  const duration = input.roundDurationSeconds ?? ROUND_DURATION_SECONDS;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError("Round duration must be a positive finite number");
  }

  if (
    input.distanceMeters !== null &&
    Number.isFinite(input.distanceMeters) &&
    Math.max(0, input.distanceMeters) <= STREET_HIT_RADIUS_METERS
  ) {
    return MAX_ROUND_SCORE;
  }

  const accuracy = calculateAccuracy(input.distanceMeters);
  if (accuracy === 0) return 0;
  const remaining = Number.isFinite(input.remainingSeconds)
    ? Math.min(duration, Math.max(0, input.remainingSeconds))
    : 0;
  const timeFactor = 0.85 + 0.15 * (remaining / duration);
  return Math.min(MAX_ROUND_SCORE, Math.round(MAX_ROUND_SCORE * accuracy * timeFactor));
}

export function calculateScore(
  distanceMeters: number | null,
  remainingSeconds: number,
  roundDurationSeconds = ROUND_DURATION_SECONDS,
): number {
  return calculateRoundScore({ distanceMeters, remainingSeconds, roundDurationSeconds });
}

function epochMilliseconds(value: string | number | Date): number {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
}

export function getRemainingSeconds(
  endsAt: string | number | Date,
  now: string | number | Date = Date.now(),
  roundDurationSeconds = ROUND_DURATION_SECONDS,
): number {
  const difference = (epochMilliseconds(endsAt) - epochMilliseconds(now)) / 1_000;
  if (!Number.isFinite(difference)) return 0;
  return Math.min(roundDurationSeconds, Math.max(0, difference));
}

export function getCountdownSeconds(
  endsAt: string | number | Date,
  now: string | number | Date = Date.now(),
  roundDurationSeconds = ROUND_DURATION_SECONDS,
): number {
  return Math.ceil(getRemainingSeconds(endsAt, now, roundDurationSeconds));
}

export function isRoundExpired(
  endsAt: string | number | Date,
  now: string | number | Date = Date.now(),
): boolean {
  return getRemainingSeconds(endsAt, now) <= 0;
}
