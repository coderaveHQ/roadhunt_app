import { describe, expect, it } from "vitest";

import { CITIES } from "../../src/lib/game/catalog";
import { createDemoRounds } from "../../src/lib/game/demo";
import { pointToStreetDistanceMeters } from "../../src/lib/game/geo";
import { DIFFICULTIES } from "../../src/lib/game/types";

describe("SSR-safe demo rounds", () => {
  it("creates ten stable unique rounds for every city and difficulty", () => {
    for (const city of CITIES) {
      for (const difficulty of DIFFICULTIES) {
        const first = createDemoRounds(city.slug, difficulty);
        const second = createDemoRounds(city.slug, difficulty);
        expect(first).toEqual(second);
        expect(first).toHaveLength(10);
        expect(new Set(first.map((round) => round.id))).toHaveLength(10);
        expect(new Set(first.map((round) => round.targetStreetName))).toHaveLength(10);
        for (const round of first) {
          expect(round.targetGeometry.coordinates).toHaveLength(3);
          for (const [longitude, latitude] of round.targetGeometry.coordinates) {
            expect(longitude).toBeGreaterThanOrEqual(city.bounds[0]);
            expect(latitude).toBeGreaterThanOrEqual(city.bounds[1]);
            expect(longitude).toBeLessThanOrEqual(city.bounds[2]);
            expect(latitude).toBeLessThanOrEqual(city.bounds[3]);
          }
        }
      }
    }
  });
});

describe("demo point-to-street distance", () => {
  const street = {
    type: "LineString" as const,
    coordinates: [
      [0, 0] as const,
      [0.01, 0] as const,
    ],
  };

  it("is zero on a segment and measures a nearby perpendicular offset", () => {
    expect(pointToStreetDistanceMeters([0.005, 0], street)).toBeCloseTo(0, 6);
    expect(pointToStreetDistanceMeters([0.005, 0.001], street)).toBeCloseTo(111.2, 0);
  });

  it("chooses the closest segment in a multi-line street", () => {
    const distance = pointToStreetDistanceMeters([0.005, 0.001], {
      type: "MultiLineString",
      coordinates: [street.coordinates, [[10, 10], [10.01, 10]]],
    });
    expect(distance).toBeCloseTo(111.2, 0);
  });
});
