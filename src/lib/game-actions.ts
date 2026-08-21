"use server";

import "server-only";

import { z } from "zod";

import { normalizeNickname, validateNickname } from "@/lib/game/normalization";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import {
  ensureAnonymousPlayer,
  getCurrentPlayerId,
} from "@/lib/supabase/server";

const nicknameSchema = z
  .string()
  .transform(normalizeNickname)
  .refine((value) => validateNickname(value).success);
const citySchema = z.string().regex(/^[a-z0-9-]+$/);
const difficultySchema = z.enum(["easy", "medium", "hard", "insane"]);
const modeSchema = z.enum(["solo", "lobby"]);
const idSchema = z.uuid();
const codeSchema = z.string().trim().toUpperCase().regex(/^[2-9A-HJKMNP-Z]{6}$/);

type ActionErrorCode =
  | "backend_unavailable"
  | "invalid_input"
  | "not_authenticated"
  | "request_failed";

export type GameMutationResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: ActionErrorCode; message?: string };

type PublicFunctions = Database["public"]["Functions"];
type GameRpcName =
  | "create_game"
  | "create_rematch"
  | "join_game"
  | "leave_game"
  | "start_game"
  | "submit_guess"
  | "synchronize_game";

function safeData(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function invokeGameRpc<Name extends GameRpcName>(
  name: Name,
  params: PublicFunctions[Name]["Args"],
): Promise<GameMutationResult> {
  const admin = getSupabaseAdminClient();
  if (!admin) return { ok: false, error: "backend_unavailable" };

  const { data, error } = await admin.rpc(name, params);
  if (error) {
    console.error(`Roadhunt RPC ${name} failed`, error.code);
    return { ok: false, error: "request_failed" };
  }
  return { ok: true, data: safeData(data) };
}

export async function createGame(input: {
  mode: "solo" | "lobby";
  citySlug: string;
  difficulty: "easy" | "medium" | "hard" | "insane";
  nickname: string;
}): Promise<GameMutationResult> {
  const parsed = z
    .object({
      mode: modeSchema,
      citySlug: citySchema,
      difficulty: difficultySchema,
      nickname: nicknameSchema,
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  try {
    const userId = await ensureAnonymousPlayer();
    if (!userId) return { ok: false, error: "backend_unavailable" };
    return invokeGameRpc("create_game", {
      p_mode: parsed.data.mode,
      p_city_slug: parsed.data.citySlug,
      p_difficulty: parsed.data.difficulty,
      p_nickname: parsed.data.nickname,
      p_user_id: userId,
    });
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

export async function joinGame(input: {
  code: string;
  nickname: string;
}): Promise<GameMutationResult> {
  const parsed = z
    .object({ code: codeSchema, nickname: nicknameSchema })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const userId = await ensureAnonymousPlayer();
  if (!userId) return { ok: false, error: "backend_unavailable" };
  return invokeGameRpc("join_game", {
    p_code: parsed.data.code,
    p_nickname: parsed.data.nickname,
    p_user_id: userId,
  });
}

async function memberMutation(
  name: "create_rematch" | "leave_game" | "start_game" | "synchronize_game",
  gameId: string,
) {
  const parsedId = idSchema.safeParse(gameId);
  if (!parsedId.success) return { ok: false, error: "invalid_input" } as const;
  const userId = await getCurrentPlayerId();
  if (!userId) return { ok: false, error: "not_authenticated" } as const;
  return invokeGameRpc(name, { p_game_id: parsedId.data, p_user_id: userId });
}

export async function leaveGame(gameId: string) {
  return memberMutation("leave_game", gameId);
}

export async function startGame(gameId: string) {
  return memberMutation("start_game", gameId);
}

export async function createRematch(gameId: string) {
  return memberMutation("create_rematch", gameId);
}

export async function synchronizeGame(gameId: string) {
  return memberMutation("synchronize_game", gameId);
}

export async function submitGuess(input: {
  gameId: string;
  roundId: string;
  lng: number;
  lat: number;
}): Promise<GameMutationResult> {
  const parsed = z
    .object({
      gameId: idSchema,
      roundId: idSchema,
      lng: z.number().min(-180).max(180),
      lat: z.number().min(-90).max(90),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const userId = await getCurrentPlayerId();
  if (!userId) return { ok: false, error: "not_authenticated" };

  return invokeGameRpc("submit_guess", {
    p_game_id: parsed.data.gameId,
    p_round_id: parsed.data.roundId,
    p_user_id: userId,
    p_lng: parsed.data.lng,
    p_lat: parsed.data.lat,
  });
}
