import { describe, expect, it } from "vitest";

import { CITY_SLUGS } from "../../src/lib/game/catalog";
import {
  fallbackCityOptions,
  filterCityOptions,
  citySearchDisambiguators,
  isDifficultyAvailable,
  launchCityOptions,
  parseCatalogCityOptions,
  parseCitySearchResponse,
  playableDifficulty,
  type CityCatalogOption,
} from "../../src/lib/game/setup-catalog";

const allAvailable = { easy: 10, medium: 10, hard: 10, insane: 10 } as const;

function option(name: string, slug = name.toLocaleLowerCase("de")): CityCatalogOption {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug,
    name,
    countryCode: "DE",
    center: [7, 51],
    bounds: [6.9, 50.9, 7.1, 51.1],
    difficultyCounts: allAvailable,
    settlementType: "city",
    population: 100_000,
    featured: false,
    adminArea: {
      stateName: "Nordrhein-Westfalen",
      districtName: "Städteregion Aachen",
      code: "05334002",
    },
  };
}

describe("game setup city catalog", () => {
  it("keeps the twelve launch cities in their established order without search", () => {
    const launch = launchCityOptions([], "de");

    expect(launch).toHaveLength(12);
    expect(launch.map((city) => city.slug)).toEqual(CITY_SLUGS);
    expect(launch.map((city) => city.name)).toEqual(
      fallbackCityOptions("de").map((city) => city.name),
    );
    expect(launch.every((city) => city.difficultyCounts === null)).toBe(true);
  });

  it("parses the compact localized RPC contract", () => {
    const result = parseCatalogCityOptions({
      countries: [{
        code: "DE",
        name: "Deutschland",
        cities: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            slug: "aachen",
            name: "Aachen",
            center: [6.0839, 50.7753],
            bounds: [5.974, 50.662, 6.218, 50.864],
            difficultyCounts: { easy: 21, medium: 18, hard: 9, insane: 4 },
            settlementType: "city",
            population: 261_472,
            featured: false,
            adminArea: {
              stateName: "Nordrhein-Westfalen",
              districtName: "Städteregion Aachen",
              code: "05334002",
            },
          },
          { slug: "--invalid-city--" },
        ],
      }],
    });

    expect(result).toEqual([expect.objectContaining({
      slug: "aachen",
      name: "Aachen",
      countryCode: "DE",
      center: [6.0839, 50.7753],
      bounds: [5.974, 50.662, 6.218, 50.864],
      difficultyCounts: { easy: 21, medium: 18, hard: 9, insane: 4 },
    })]);
  });

  it("rejects malformed geometry instead of leaking an incompatible catalog to the UI", () => {
    expect(parseCatalogCityOptions({
      countries: [{
        code: "DE",
        name: "Deutschland",
        cities: [{ ...option("Aachen", "aachen"), center: { type: "Point" } }],
      }],
    })).toBeNull();
  });

  it("distinguishes a valid empty search result from an invalid response", () => {
    expect(parseCatalogCityOptions({ countries: [] })).toEqual([]);
    expect(parseCitySearchResponse({ cities: [] })).toEqual([]);
    expect(parseCitySearchResponse({ cities: [{ slug: "incomplete" }] })).toBeNull();
  });

  it("accepts only compact, bounded city-search response objects", () => {
    const aachen = option("Aachen", "aachen");
    expect(parseCitySearchResponse({ cities: [aachen] })).toEqual([aachen]);
    expect(parseCitySearchResponse({
      cities: [{
        ...aachen,
        adminArea: { ...aachen.adminArea!, code: "osm-r123456" },
      }],
    })).not.toBeNull();
    expect(parseCitySearchResponse({
      cities: [{ ...aachen, bounds: { type: "Polygon", coordinates: [] } }],
    })).toBeNull();
    expect(parseCitySearchResponse({
      cities: Array.from({ length: 13 }, (_, index) => ({
        ...aachen,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        slug: `aachen-${index}`,
      })),
    })).toBeNull();
  });

  it("searches accent-insensitively, sorts for the active locale, and caps results", () => {
    const cities = [
      option("Zürich", "zurich"),
      option("München", "munich"),
      ...Array.from({ length: 13 }, (_, index) => option(`Musterstadt ${String(index).padStart(2, "0")}`, `musterstadt-${index}`)),
    ];

    expect(filterCityOptions(cities, "munchen", "de").map((city) => city.slug)).toEqual([
      "munich",
    ]);
    const matches = filterCityOptions(cities, "musterstadt", "de");
    expect(matches).toHaveLength(12);
    expect(matches.map((city) => city.name)).toEqual(
      [...matches.map((city) => city.name)].sort(new Intl.Collator("de").compare),
    );
  });

  it("disambiguates duplicate names by district, state, and finally AGS", () => {
    const first = {
      ...option("Neuenkirchen", "neuenkirchen-1"),
      adminArea: {
        stateName: "Nordrhein-Westfalen",
        districtName: "Kreis Steinfurt",
        code: "05566060",
      },
    };
    const second = {
      ...option("Neuenkirchen", "neuenkirchen-2"),
      adminArea: { ...first.adminArea, code: "05566061" },
    };
    const third = {
      ...option("Neuenkirchen", "neuenkirchen-3"),
      adminArea: {
        stateName: "Niedersachsen",
        districtName: "Landkreis Osnabrück",
        code: "03459028",
      },
    };
    const relationFallback = {
      ...option("Neuenkirchen", "neuenkirchen-4"),
      adminArea: {
        stateName: "Nordrhein-Westfalen",
        districtName: "Kreis Steinfurt",
        code: "osm-r123456",
      },
    };

    const labels = citySearchDisambiguators([first, second, third, relationFallback], "de");
    expect(labels.get(first.slug)).toBe(
      "Kreis Steinfurt · Nordrhein-Westfalen · AGS 05566060",
    );
    expect(labels.get(second.slug)).toBe(
      "Kreis Steinfurt · Nordrhein-Westfalen · AGS 05566061",
    );
    expect(labels.get(third.slug)).toBe("Landkreis Osnabrück · Niedersachsen");
    expect(labels.get(relationFallback.slug)).toBe(
      "Kreis Steinfurt · Nordrhein-Westfalen · OSM r123456",
    );
    expect(citySearchDisambiguators(fallbackCityOptions("de"), "de").get("berlin"))
      .toBeNull();
  });

  it("requires ten targets per difficulty but leaves fallback cities playable", () => {
    const catalogCity = {
      ...option("Aachen", "aachen"),
      difficultyCounts: { easy: 10, medium: 9, hard: 0, insane: 14 },
    };

    expect(isDifficultyAvailable(catalogCity, "easy")).toBe(true);
    expect(isDifficultyAvailable(catalogCity, "medium")).toBe(false);
    expect(isDifficultyAvailable(catalogCity, "insane")).toBe(true);
    expect(playableDifficulty(catalogCity, "medium")).toBe("easy");
    expect(playableDifficulty(catalogCity, "insane")).toBe("insane");
    expect(isDifficultyAvailable(fallbackCityOptions("en")[0]!, "hard")).toBe(true);

    expect(playableDifficulty({
      ...catalogCity,
      difficultyCounts: { easy: 0, medium: 0, hard: 0, insane: 0 },
    }, "medium")).toBeNull();
  });
});
