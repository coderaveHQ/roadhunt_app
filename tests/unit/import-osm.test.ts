import { describe, expect, it } from "vitest";

import {
  buildOverpassQuery,
  parseCliOptions,
  renderStreetImportSql,
  transformOverpassResponse,
} from "../../scripts/import-osm";

const fixture = {
  osm3s: { timestamp_osm_base: "2026-08-20T10:00:00Z" },
  elements: [
    {
      type: "way",
      id: 12,
      tags: { name: "Große Straße", highway: "primary" },
      geometry: [
        { lon: 13.4, lat: 52.52 },
        { lon: 13.41, lat: 52.52 },
      ],
    },
    {
      type: "way",
      id: 13,
      tags: { name: "Große Straße", highway: "residential" },
      geometry: [
        { lon: 13.41, lat: 52.52 },
        { lon: 13.42, lat: 52.52 },
      ],
    },
    {
      type: "way",
      id: 13,
      tags: { name: "Große Straße", highway: "residential" },
      geometry: [
        { lon: 13.41, lat: 52.52 },
        { lon: 13.42, lat: 52.52 },
      ],
    },
    {
      type: "way",
      id: 20,
      tags: { name: "Privatweg", highway: "residential", access: "private" },
      geometry: [
        { lon: 13.4, lat: 52.52 },
        { lon: 13.401, lat: 52.52 },
      ],
    },
    {
      type: "way",
      id: 14,
      tags: { name: "Große   Straße", highway: "secondary" },
      geometry: [
        { lon: 13.42, lat: 52.52 },
        { lon: 13.43, lat: 52.52 },
      ],
    },
    {
      type: "way",
      id: 22,
      tags: { name: "Marktplatz", highway: "pedestrian", motor_vehicle: "no" },
      geometry: [
        { lon: 13.4, lat: 52.52 },
        { lon: 13.401, lat: 52.52 },
      ],
    },
    {
      type: "way",
      id: 21,
      tags: { name: "Fußweg", highway: "footway" },
      geometry: [
        { lon: 13.4, lat: 52.52 },
        { lon: 13.401, lat: 52.52 },
      ],
    },
  ],
};

describe("OSM transformation", () => {
  it("groups same-name ways, deduplicates IDs, and excludes unsuitable ways", () => {
    const rows = transformOverpassResponse("berlin", fixture);
    expect(rows).toHaveLength(2);
    const groupedStreet = rows.find((row) => row.normalized_name === "grosse strasse");
    expect(groupedStreet).toMatchObject({
      name: "Große Straße",
      normalized_name: "grosse strasse",
      osm_ids: [12, 13, 14],
      highway_types: ["primary", "residential", "secondary"],
      difficulty: "easy",
      source_updated_at: "2026-08-20T10:00:00.000Z",
    });
    expect(groupedStreet?.geom.coordinates).toHaveLength(3);
    expect(groupedStreet?.length_m).toBeGreaterThan(1_500);
    expect(rows.find((row) => row.name === "Marktplatz")?.difficulty).toBe("insane");
  });

  it("renders idempotent private.streets SQL", () => {
    const sql = renderStreetImportSql("berlin", transformOverpassResponse("berlin", fixture));
    expect(sql).toContain("insert into private.streets");
    expect(sql).toContain("::public.difficulty");
    expect(sql).toContain("extensions.st_geomfromgeojson");
    expect(sql).toContain("street.source->>'kind' = 'synthetic-demo'");
    expect(sql).toContain("on conflict (city_id, normalized_name) do update");
    expect(sql).toContain("where city.slug = 'berlin'");
  });
});

describe("OSM importer safety", () => {
  it("targets the city's Wikidata-backed administrative area", () => {
    expect(buildOverpassQuery("berlin")).toContain('["wikidata"="Q64"]');
    expect(buildOverpassQuery("moers")).toContain('["wikidata"="Q3132"]');
  });

  it("does not enable the network without an explicit --fetch", () => {
    expect(parseCliOptions([]).help).toBe(true);
    expect(() => parseCliOptions(["--city", "berlin"])).toThrow(
      "Choose exactly one of --fetch or --input",
    );
    expect(
      parseCliOptions(["--city", "berlin", "--input", "/tmp/fixture.json"]),
    ).toMatchObject({ fetch: false, citySlug: "berlin" });
  });
});
