import type {
  BoundingBox,
  CitySummaryDto,
  Locale,
  LocalizedText,
  Position,
} from "./types";

export const CITY_SLUGS = [
  "berlin",
  "hamburg",
  "munich",
  "cologne",
  "frankfurt",
  "duesseldorf",
  "stuttgart",
  "leipzig",
  "solingen",
  "duisburg",
  "moers",
  "wuppertal",
] as const;

export type CitySlug = (typeof CITY_SLUGS)[number];

export interface CityDefinition extends CitySummaryDto {
  readonly slug: CitySlug;
  readonly overpassName: string;
  readonly wikidataId: `Q${number}`;
}

function city(
  slug: CitySlug,
  name: LocalizedText,
  center: Position,
  bounds: BoundingBox,
  overpassName: string,
  wikidataId: `Q${number}`,
): CityDefinition {
  return {
    slug,
    countryCode: "DE",
    name,
    center,
    bounds,
    overpassName,
    wikidataId,
  };
}

/** Stable catalog shared by the UI, demo mode, and OSM import. */
export const CITIES: readonly CityDefinition[] = [
  city(
    "berlin",
    { de: "Berlin", en: "Berlin" },
    [13.405, 52.52],
    [13.0884, 52.3383, 13.7611, 52.6755],
    "Berlin",
    "Q64",
  ),
  city(
    "hamburg",
    { de: "Hamburg", en: "Hamburg" },
    [9.9937, 53.5511],
    [9.73, 53.395, 10.325, 53.739],
    "Hamburg",
    "Q1055",
  ),
  city(
    "munich",
    { de: "München", en: "Munich" },
    [11.582, 48.1351],
    [11.36, 47.98, 11.722, 48.249],
    "München",
    "Q1726",
  ),
  city(
    "cologne",
    { de: "Köln", en: "Cologne" },
    [6.9603, 50.9375],
    [6.772, 50.829, 7.162, 51.085],
    "Köln",
    "Q365",
  ),
  city(
    "frankfurt",
    { de: "Frankfurt am Main", en: "Frankfurt" },
    [8.6821, 50.1109],
    [8.472, 50.015, 8.8, 50.228],
    "Frankfurt am Main",
    "Q1794",
  ),
  city(
    "duesseldorf",
    { de: "Düsseldorf", en: "Düsseldorf" },
    [6.7735, 51.2277],
    [6.688, 51.124, 6.939, 51.353],
    "Düsseldorf",
    "Q1718",
  ),
  city(
    "stuttgart",
    { de: "Stuttgart", en: "Stuttgart" },
    [9.1829, 48.7758],
    [9.038, 48.692, 9.316, 48.866],
    "Stuttgart",
    "Q1022",
  ),
  city(
    "leipzig",
    { de: "Leipzig", en: "Leipzig" },
    [12.3731, 51.3397],
    [12.236, 51.235, 12.542, 51.449],
    "Leipzig",
    "Q2079",
  ),
  city(
    "solingen",
    { de: "Solingen", en: "Solingen" },
    [7.083, 51.1652],
    [6.985, 51.101, 7.178, 51.224],
    "Solingen",
    "Q2942",
  ),
  city(
    "duisburg",
    { de: "Duisburg", en: "Duisburg" },
    [6.7623, 51.4344],
    [6.627, 51.334, 6.838, 51.548],
    "Duisburg",
    "Q2100",
  ),
  city(
    "moers",
    { de: "Moers", en: "Moers" },
    [6.6263, 51.4516],
    [6.546, 51.378, 6.724, 51.524],
    "Moers",
    "Q3132",
  ),
  city(
    "wuppertal",
    { de: "Wuppertal", en: "Wuppertal" },
    [7.1508, 51.2562],
    [7, 51.165, 7.313, 51.346],
    "Wuppertal",
    "Q2107",
  ),
] as const;

const CITY_BY_SLUG = new Map(CITIES.map((entry) => [entry.slug, entry]));

export function isCitySlug(value: string): value is CitySlug {
  return CITY_BY_SLUG.has(value as CitySlug);
}

export function getCity(slug: CitySlug): CityDefinition {
  const result = CITY_BY_SLUG.get(slug);
  if (!result) throw new RangeError(`Unknown Roadhunt city: ${slug}`);
  return result;
}

export function findCity(value: string): CityDefinition | null {
  return isCitySlug(value) ? getCity(value) : null;
}

export function getCityName(slug: CitySlug, locale: Locale): string {
  return getCity(slug).name[locale];
}
