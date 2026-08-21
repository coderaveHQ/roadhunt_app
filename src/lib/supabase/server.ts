import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./database.types";
import { getPublicSupabaseConfig } from "./env";

export async function createServerSupabaseClient() {
  const config = getPublicSupabaseConfig();
  if (!config) return null;
  const cookieStore = await cookies();

  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      encode: "tokens-only",
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, headers) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The proxy refreshes them.
        }
        void headers;
      },
    },
  });
}

export async function getCurrentPlayerId() {
  const client = await createServerSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.auth.getClaims();
  if (error) return null;
  return typeof data?.claims?.sub === "string" ? data.claims.sub : null;
}

export async function ensureAnonymousPlayer() {
  const client = await createServerSupabaseClient();
  if (!client) return null;

  const existingId = await getCurrentPlayerId();
  if (existingId) return existingId;

  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw new Error("anonymous_sign_in_failed", { cause: error });
  if (!data.user?.id) throw new Error("anonymous_user_missing");
  return data.user.id;
}
