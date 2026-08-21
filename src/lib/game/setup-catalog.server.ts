import "server-only";

import type { Locale } from "./types";
import {
  CATALOG_SEARCH_LIMIT,
  fallbackCityOptions,
  launchCityOptions,
  parseCatalogCityOptions,
  type CityCatalogOption,
} from "./setup-catalog";
import { getSupabaseAdminClient } from "../supabase/admin";

export type CatalogSearchResult =
  | { readonly ok: true; readonly cities: readonly CityCatalogOption[] }
  | { readonly ok: false; readonly error: "backend_unavailable" | "request_failed" | "invalid_response" };

export async function searchGameSetupCities(
  locale: Locale,
  query: string | null,
  limit = CATALOG_SEARCH_LIMIT,
): Promise<CatalogSearchResult> {
  const admin = getSupabaseAdminClient();
  if (!admin) return { ok: false, error: "backend_unavailable" };

  try {
    const { data, error } = await admin.rpc("search_catalog", {
      p_locale: locale,
      p_query: query ?? undefined,
      p_limit: limit,
    });
    if (error) return { ok: false, error: "request_failed" };

    const cities = parseCatalogCityOptions(data);
    return cities === null
      ? { ok: false, error: "invalid_response" }
      : { ok: true, cities };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

export async function loadGameSetupCities(locale: Locale): Promise<CityCatalogOption[]> {
  const fallback = fallbackCityOptions(locale);
  const result = await searchGameSetupCities(locale, null, CATALOG_SEARCH_LIMIT);
  return result.ok && result.cities.length > 0
    ? launchCityOptions(result.cities, locale)
    : fallback;
}
