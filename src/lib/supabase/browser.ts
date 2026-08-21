"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { getPublicSupabaseConfig, resolveBrowserSupabaseUrl } from "./env";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getBrowserSupabaseClient() {
  const config = getPublicSupabaseConfig();
  if (!config) return null;

  const browserUrl = resolveBrowserSupabaseUrl(config.url, window.location.hostname);
  browserClient ??= createBrowserClient<Database>(browserUrl, config.publishableKey, {
    cookies: { encode: "tokens-only" },
  });

  return browserClient;
}
