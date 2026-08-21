export const LOCALES = ["de", "en"] as const;
export const GAME_MODES = ["solo", "lobby"] as const;
export const DIFFICULTIES = ["easy", "medium", "hard", "insane"] as const;
export const GAME_STATUSES = [
  "waiting",
  "playing",
  "revealing",
  "finished",
] as const;

export type Locale = (typeof LOCALES)[number];
export type GameMode = (typeof GAME_MODES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];
export type GameStatus = (typeof GAME_STATUSES)[number];

export type Position = readonly [longitude: number, latitude: number];
export type BoundingBox = readonly [
  west: number,
  south: number,
  east: number,
  north: number,
];

export interface LineStringGeometry {
  readonly type: "LineString";
  readonly coordinates: readonly Position[];
}

export interface PointGeometry {
  readonly type: "Point";
  readonly coordinates: Position;
}

export interface PolygonGeometry {
  readonly type: "Polygon";
  readonly coordinates: readonly (readonly Position[])[];
}

export interface MultiPolygonGeometry {
  readonly type: "MultiPolygon";
  readonly coordinates: readonly (readonly (readonly Position[])[])[];
}

export interface MultiLineStringGeometry {
  readonly type: "MultiLineString";
  readonly coordinates: readonly (readonly Position[])[];
}

export type StreetGeometry = LineStringGeometry | MultiLineStringGeometry;

export interface LocalizedText {
  readonly de: string;
  readonly en: string;
}

export interface CitySummaryDto {
  readonly slug: string;
  readonly countryCode: "DE";
  readonly name: LocalizedText;
  readonly center: Position;
  readonly bounds: BoundingBox;
}

export interface PlayerStateDto {
  readonly id: string;
  readonly nickname: string;
  readonly isHost: boolean;
  readonly isConnected: boolean;
  readonly hasSubmitted: boolean;
  readonly score: number;
  readonly rank: number | null;
}

export interface GuessRevealDto {
  readonly playerId: string;
  readonly position: Position | null;
  readonly distanceMeters: number | null;
  readonly points: number;
  readonly submittedAt: string | null;
}

export type RoundStatus = "pending" | "playing" | "revealing" | "complete";

export interface ActiveRoundDto {
  readonly id: string;
  readonly number: number;
  readonly targetStreetName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly revealEndsAt?: null;
  readonly targetGeometry?: never;
  readonly guesses?: never;
}

export interface RevealedRoundDto {
  readonly id: string;
  readonly number: number;
  readonly targetStreetName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly revealEndsAt: string | null;
  readonly targetGeometry: MultiLineStringGeometry;
  readonly guesses: readonly GuessRevealDto[];
}

export interface CompletedRoundDto {
  readonly id: string;
  readonly number: number;
  readonly targetStreetName: string;
  readonly targetGeometry: MultiLineStringGeometry;
  readonly guesses: readonly GuessRevealDto[];
}

export interface BaseGameStateDto {
  readonly id: string;
  /** Opaque game-player id, never the authenticated user's UUID. */
  readonly viewerPlayerId: string;
  readonly viewerIsHost: boolean;
  readonly mode: GameMode;
  readonly city: CitySummaryDto;
  readonly difficulty: Difficulty;
  readonly lobbyCode: string | null;
  readonly canStart: boolean;
  readonly roundNumber: number;
  readonly totalRounds: 10;
  readonly roundDurationSeconds: 60;
  readonly revealDurationSeconds: 15;
  readonly serverNow: string;
  readonly players: readonly PlayerStateDto[];
  readonly revealedRounds: readonly CompletedRoundDto[];
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly expiresAt: string;
}

export interface WaitingGameStateDto extends BaseGameStateDto {
  readonly status: "waiting";
  readonly currentRound: null;
}

export interface PlayingGameStateDto extends BaseGameStateDto {
  readonly status: "playing";
  readonly currentRound: ActiveRoundDto;
}

export interface RevealingGameStateDto extends BaseGameStateDto {
  readonly status: "revealing";
  readonly currentRound: RevealedRoundDto;
}

export interface FinishedGameStateDto extends BaseGameStateDto {
  readonly status: "finished";
  readonly currentRound: RevealedRoundDto | null;
}

/** Canonical state returned immediately after creating a live rematch. */
export type RematchGameStateDto = WaitingGameStateDto | PlayingGameStateDto;

/**
 * Canonical, client-safe response shape for `GET /api/games/:id/state`.
 * The discriminated union makes leaking target geometry during play a type error.
 */
export type GameStateDto =
  | WaitingGameStateDto
  | PlayingGameStateDto
  | RevealingGameStateDto
  | FinishedGameStateDto;

export type GameStateDTO = GameStateDto;
