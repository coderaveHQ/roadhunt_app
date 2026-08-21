import { z } from "zod";

import {
  CATALOG_SEARCH_LIMIT,
  CATALOG_SEARCH_QUERY_MAX_LENGTH,
} from "@/lib/game/setup-catalog";
import { searchGameSetupCities } from "@/lib/game/setup-catalog.server";
import { countVisibleCharacters } from "@/lib/game/normalization";
import { LOCALES } from "@/lib/game/types";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  locale: z.enum(LOCALES),
  query: z.string()
    .trim()
    .max(CATALOG_SEARCH_QUERY_MAX_LENGTH * 4)
    .refine((value) => countVisibleCharacters(value) <= CATALOG_SEARCH_QUERY_MAX_LENGTH)
    .nullable(),
  limit: z.coerce.number().int().min(1).max(CATALOG_SEARCH_LIMIT),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = requestSchema.safeParse({
    locale: url.searchParams.get("locale"),
    query: url.searchParams.get("q"),
    limit: url.searchParams.get("limit") ?? String(CATALOG_SEARCH_LIMIT),
  });

  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const result = await searchGameSetupCities(
    parsed.data.locale,
    parsed.data.query || null,
    parsed.data.limit,
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, {
      status: result.error === "backend_unavailable" ? 503 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return Response.json({ cities: result.cities }, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
