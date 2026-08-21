import { z } from "zod";

import { CITIES } from "./catalog";
import type { BoundingBox, Difficulty, Locale, Position } from "./types";

const difficulties: readonly Difficulty[] = ["easy", "medium", "hard", "insane"];

export const CATALOG_SEARCH_LIMIT = 12;
export const CATALOG_SEARCH_QUERY_MAX_LENGTH = 80;

export type DifficultyCounts = Readonly<Record<Difficulty, number>>;

export interface CityAdminArea {
  readonly stateName: string;
  readonly districtName: string | null;
  readonly code: string;
}

export interface CityCatalogOption {
  readonly id: string | null;
  readonly slug: string;
  readonly name: string;
  readonly countryCode: string;
  readonly center: Position;
  readonly bounds: BoundingBox;
  /** Null means the static fallback is active and every level remains available. */
  readonly difficultyCounts: DifficultyCounts | null;
  readonly settlementType: string | null;
  readonly population: number | null;
  readonly featured: boolean;
  readonly adminArea: CityAdminArea | null;
}

const difficultyCountsSchema = z.object({
  easy: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  hard: z.number().int().nonnegative(),
  insane: z.number().int().nonnegative(),
});

const citySchema = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1),
  center: z.tuple([z.number(), z.number()]),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  difficultyCounts: difficultyCountsSchema,
  settlementType: z.string().nullable(),
  population: z.number().int().nonnegative().nullable(),
  featured: z.boolean(),
  adminArea: z.object({
    stateName: z.string().trim().min(1),
    districtName: z.string().trim().min(1).nullable(),
    code: z.string().regex(/^(?:\d{8}|osm-r\d+)$/),
  }),
});

const citySearchResponseSchema = z.object({
  cities: z.array(citySchema.extend({
    countryCode: z.string().trim().min(1),
  })).max(CATALOG_SEARCH_LIMIT),
});

const catalogEnvelopeSchema = z.object({
  countries: z.array(z.object({
    code: z.string().trim().min(1),
    name: z.string(),
    cities: z.array(z.unknown()),
  })),
});

export function fallbackCityOptions(locale: Locale): CityCatalogOption[] {
  return CITIES.map((city) => ({
    id: null,
    slug: city.slug,
    name: city.name[locale],
    countryCode: city.countryCode,
    center: city.center,
    bounds: city.bounds,
    difficultyCounts: null,
    settlementType: null,
    population: null,
    featured: true,
    adminArea: null,
  }));
}

export function launchCityOptions(
  catalogCities: readonly CityCatalogOption[],
  locale: Locale,
) {
  const catalogBySlug = new Map(catalogCities.map((city) => [city.slug, city]));
  const fallbackBySlug = new Map(
    fallbackCityOptions(locale).map((city) => [city.slug, city]),
  );

  return CITIES.map((city) => {
    const option = catalogBySlug.get(city.slug) ?? fallbackBySlug.get(city.slug);
    if (!option) throw new RangeError(`Missing launch city: ${city.slug}`);
    return { ...option, name: city.name[locale] };
  });
}

export function parseCatalogCityOptions(value: unknown): CityCatalogOption[] | null {
  const parsed = catalogEnvelopeSchema.safeParse(value);
  if (!parsed.success) return null;

  const receivedCityCount = parsed.data.countries.reduce(
    (total, country) => total + country.cities.length,
    0,
  );
  const cities = parsed.data.countries.flatMap((country) =>
    country.cities.flatMap((value) => {
      const city = citySchema.safeParse(value);
      return city.success ? [{ ...city.data, countryCode: country.code }] : [];
    }),
  );

  return receivedCityCount > 0 && cities.length === 0 ? null : cities;
}

export function parseCitySearchResponse(value: unknown): CityCatalogOption[] | null {
  const parsed = citySearchResponseSchema.safeParse(value);
  return parsed.success ? parsed.data.cities : null;
}

export function citySearchDisambiguators(
  cities: readonly CityCatalogOption[],
  locale: Locale,
) {
  const baseLabels = new Map<string, string>();
  const collisions = new Map<string, number>();
  const codeLabel = (code: string) => /^\d{8}$/.test(code)
    ? `AGS ${code}`
    : `OSM ${code.replace(/^osm-/, "")}`;

  for (const city of cities) {
    const area = city.adminArea;
    const baseLabel = area
      ? [area.districtName, area.stateName].filter(Boolean).join(" · ")
      : "";
    baseLabels.set(city.slug, baseLabel);
    const key = `${city.name.normalize("NFKC").toLocaleLowerCase(locale)}\u0000${baseLabel}`;
    collisions.set(key, (collisions.get(key) ?? 0) + 1);
  }

  return new Map(cities.map((city) => {
    const baseLabel = baseLabels.get(city.slug) ?? "";
    const area = city.adminArea;
    if (!area) return [city.slug, null] as const;
    if (!baseLabel) return [city.slug, codeLabel(area.code)] as const;

    const key = `${city.name.normalize("NFKC").toLocaleLowerCase(locale)}\u0000${baseLabel}`;
    return [
      city.slug,
      (collisions.get(key) ?? 0) > 1
        ? `${baseLabel} · ${codeLabel(area.code)}`
        : baseLabel,
    ] as const;
  }));
}

function comparableSearchText(value: string, locale: Locale) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase(locale)
    .trim();
}

export function filterCityOptions(
  cities: readonly CityCatalogOption[],
  query: string,
  locale: Locale,
  limit = 12,
) {
  const normalizedQuery = comparableSearchText(query, locale);
  if (!normalizedQuery) return [];

  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  return cities
    .filter((city) => comparableSearchText(city.name, locale).includes(normalizedQuery))
    .sort((left, right) => collator.compare(left.name, right.name))
    .slice(0, limit);
}

export function isDifficultyAvailable(
  city: CityCatalogOption,
  difficulty: Difficulty,
) {
  return city.difficultyCounts === null || city.difficultyCounts[difficulty] >= 10;
}

export function playableDifficulty(
  city: CityCatalogOption,
  preferred: Difficulty,
): Difficulty | null {
  if (isDifficultyAvailable(city, preferred)) return preferred;
  return difficulties.find((difficulty) => isDifficultyAvailable(city, difficulty)) ?? null;
}
