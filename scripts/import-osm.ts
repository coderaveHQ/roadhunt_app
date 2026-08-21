#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { CITIES, getCity, isCitySlug, type CitySlug } from "../src/lib/game/catalog";
import {
  classifyDifficulty,
  getDifficultyOverride,
} from "../src/lib/game/difficulty";
import { lineLengthMeters } from "../src/lib/game/geo";
import { normalizeStreetName, normalizeWhitespace } from "../src/lib/game/normalization";
import { DIFFICULTIES, type Difficulty, type MultiLineStringGeometry, type Position } from "../src/lib/game/types";

const DEFAULT_OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
const FETCH_RETRIES = 3;

const SUITABLE_HIGHWAY_TYPES = new Set([
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "pedestrian",
]);

const BLOCKED_ACCESS_VALUES = new Set(["private", "no"]);

export interface OverpassWay {
  readonly type: "way";
  readonly id: number;
  readonly tags?: Readonly<Record<string, string>>;
  readonly geometry?: readonly {
    readonly lat: number;
    readonly lon: number;
  }[];
}

export interface OverpassResponse {
  readonly version?: number;
  readonly generator?: string;
  readonly osm3s?: {
    readonly timestamp_osm_base?: string;
    readonly copyright?: string;
  };
  readonly elements: readonly unknown[];
}

export interface StreetImportRow {
  readonly city_slug: CitySlug;
  readonly name: string;
  readonly normalized_name: string;
  readonly osm_ids: readonly number[];
  readonly highway_types: readonly string[];
  readonly length_m: number;
  readonly difficulty: Difficulty;
  readonly geom: MultiLineStringGeometry;
  readonly source_updated_at: string | null;
  readonly source: {
    readonly provider: "OpenStreetMap";
    readonly license: "ODbL";
    readonly attribution: "© OpenStreetMap contributors";
    readonly copyright_url: typeof OSM_COPYRIGHT_URL;
    readonly city_wikidata_id: `Q${number}`;
  };
}

interface MutableStreetGroup {
  readonly names: Map<string, number>;
  readonly wayIds: Set<number>;
  readonly highwayTypes: Set<string>;
  readonly lines: Position[][];
  lengthMeters: number;
}

export function buildOverpassQuery(citySlug: CitySlug): string {
  const city = getCity(citySlug);
  return `[out:json][timeout:180];
area["boundary"="administrative"]["wikidata"="${city.wikidataId}"]->.city;
way(area.city)["highway"]["name"];
out tags geom qt;`;
}

function asOverpassResponse(value: unknown): OverpassResponse {
  if (!value || typeof value !== "object" || !Array.isArray((value as { elements?: unknown }).elements)) {
    throw new TypeError("Overpass response must be an object with an elements array");
  }
  return value as OverpassResponse;
}

function asSuitableWay(value: unknown): OverpassWay | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<OverpassWay>;
  if (
    candidate.type !== "way" ||
    typeof candidate.id !== "number" ||
    !Number.isSafeInteger(candidate.id) ||
    !candidate.tags ||
    typeof candidate.tags.name !== "string" ||
    typeof candidate.tags.highway !== "string" ||
    !SUITABLE_HIGHWAY_TYPES.has(candidate.tags.highway) ||
    BLOCKED_ACCESS_VALUES.has(candidate.tags.access ?? "") ||
    candidate.tags.motor_vehicle === "private" ||
    !Array.isArray(candidate.geometry)
  ) {
    return null;
  }
  return candidate as OverpassWay;
}

function wayCoordinates(way: OverpassWay): Position[] | null {
  const coordinates: Position[] = [];
  for (const node of way.geometry ?? []) {
    if (
      !node ||
      !Number.isFinite(node.lon) ||
      !Number.isFinite(node.lat) ||
      node.lon < -180 ||
      node.lon > 180 ||
      node.lat < -90 ||
      node.lat > 90
    ) {
      return null;
    }
    const previous = coordinates.at(-1);
    if (!previous || previous[0] !== node.lon || previous[1] !== node.lat) {
      coordinates.push([node.lon, node.lat]);
    }
  }
  return coordinates.length >= 2 ? coordinates : null;
}

function sourceTimestamp(response: OverpassResponse): string | null {
  const value = response.osm3s?.timestamp_osm_base;
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function canonicalName(names: ReadonlyMap<string, number>): string {
  return [...names.entries()].sort(([leftName, leftCount], [rightName, rightCount]) => {
    if (leftCount !== rightCount) return rightCount - leftCount;
    return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
  })[0]![0];
}

/**
 * Converts raw Overpass ways into one MultiLineString per normalized street
 * name. Repeated ways and malformed/private/unsuitable ways are ignored.
 */
export function transformOverpassResponse(
  citySlug: CitySlug,
  input: unknown,
): readonly StreetImportRow[] {
  const response = asOverpassResponse(input);
  const groups = new Map<string, MutableStreetGroup>();

  for (const element of response.elements) {
    const way = asSuitableWay(element);
    if (!way) continue;
    const name = normalizeWhitespace(way.tags!.name!);
    const normalizedName = normalizeStreetName(name);
    const coordinates = wayCoordinates(way);
    if (!name || !normalizedName || !coordinates) continue;

    let group = groups.get(normalizedName);
    if (!group) {
      group = {
        names: new Map(),
        wayIds: new Set(),
        highwayTypes: new Set(),
        lines: [],
        lengthMeters: 0,
      };
      groups.set(normalizedName, group);
    }
    if (group.wayIds.has(way.id)) continue;

    group.wayIds.add(way.id);
    group.names.set(name, (group.names.get(name) ?? 0) + 1);
    group.highwayTypes.add(way.tags!.highway!);
    group.lines.push(coordinates);
    group.lengthMeters += lineLengthMeters(coordinates);
  }

  const city = getCity(citySlug);
  const updatedAt = sourceTimestamp(response);
  return [...groups.entries()]
    .map(([normalizedName, group]): StreetImportRow => {
      const highwayTypes = [...group.highwayTypes].sort();
      const roundedLength = Math.max(0.01, Math.round(group.lengthMeters * 100) / 100);
      return {
        city_slug: citySlug,
        name: canonicalName(group.names),
        normalized_name: normalizedName,
        osm_ids: [...group.wayIds].sort((left, right) => left - right),
        highway_types: highwayTypes,
        length_m: roundedLength,
        difficulty: classifyDifficulty({
          lengthMeters: roundedLength,
          highwayTypes,
          override: getDifficultyOverride(citySlug, normalizedName),
        }),
        geom: { type: "MultiLineString", coordinates: group.lines },
        source_updated_at: updatedAt,
        source: {
          provider: "OpenStreetMap",
          license: "ODbL",
          attribution: "© OpenStreetMap contributors",
          copyright_url: OSM_COPYRIGHT_URL,
          city_wikidata_id: city.wikidataId,
        },
      };
    })
    .sort((left, right) =>
      left.normalized_name < right.normalized_name
        ? -1
        : left.normalized_name > right.normalized_name
          ? 1
          : 0,
    );
}

export function countDifficultyPools(
  rows: readonly StreetImportRow[],
): Readonly<Record<Difficulty, number>> {
  const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, insane: 0 };
  for (const row of rows) counts[row.difficulty] += 1;
  return counts;
}

export function assertMinimumStreetPools(
  rows: readonly StreetImportRow[],
  minimum = 10,
): void {
  if (!Number.isInteger(minimum) || minimum < 0) {
    throw new RangeError("Minimum pool size must be a non-negative integer");
  }
  const counts = countDifficultyPools(rows);
  const shortPools = DIFFICULTIES.filter((difficulty) => counts[difficulty] < minimum);
  if (shortPools.length > 0) {
    throw new Error(
      `Street pool validation failed (${shortPools
        .map((difficulty) => `${difficulty}: ${counts[difficulty]}/${minimum}`)
        .join(", ")})`,
    );
  }
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlTextArray(values: readonly string[]): string {
  if (values.length === 0) return "ARRAY[]::text[]";
  return `ARRAY[${values.map(sqlString).join(", ")}]::text[]`;
}

function sqlBigintArray(values: readonly number[]): string {
  if (values.length === 0) return "ARRAY[]::bigint[]";
  return `ARRAY[${values.join(", ")}]::bigint[]`;
}

export function renderStreetImportSql(
  citySlug: CitySlug,
  rows: readonly StreetImportRow[],
): string {
  const matchingRows = rows.filter((row) => row.city_slug === citySlug);
  if (matchingRows.length === 0) {
    return `-- No suitable OpenStreetMap streets found for ${citySlug}.\n`;
  }

  const values = matchingRows
    .map((row) => {
      const timestamp = row.source_updated_at
        ? `${sqlString(row.source_updated_at)}::timestamptz`
        : "NULL::timestamptz";
      const geometry = `extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(${sqlString(
        JSON.stringify(row.geom),
      )}::text), 4326))`;
      return `  (${sqlString(row.name)}, ${sqlString(row.normalized_name)}, ${sqlBigintArray(
        row.osm_ids,
      )}, ${sqlTextArray(row.highway_types)}, ${row.length_m}, ${sqlString(
        row.difficulty,
      )}::public.difficulty, ${geometry}, ${timestamp}, ${sqlString(
        JSON.stringify(row.source),
      )}::jsonb)`;
    })
    .join(",\n");

  return `-- Generated by scripts/import-osm.ts. OpenStreetMap data is © OpenStreetMap contributors (ODbL).
begin;

do $$
begin
  if not exists (select 1 from public.cities where slug = ${sqlString(citySlug)}) then
    raise exception 'Roadhunt city is not seeded: ${citySlug}';
  end if;
end
$$;

delete from private.streets as street
using public.cities as city
where street.city_id = city.id
  and city.slug = ${sqlString(citySlug)}
  and street.source->>'kind' = 'synthetic-demo';

insert into private.streets (
  city_id,
  name,
  normalized_name,
  osm_ids,
  highway_types,
  length_m,
  difficulty,
  geom,
  source_updated_at,
  source
)
select
  city.id,
  source.name,
  source.normalized_name,
  source.osm_ids,
  source.highway_types,
  source.length_m,
  source.difficulty,
  source.geom,
  source.source_updated_at,
  source.source
from public.cities as city
cross join (values
${values}
) as source (
  name,
  normalized_name,
  osm_ids,
  highway_types,
  length_m,
  difficulty,
  geom,
  source_updated_at,
  source
)
where city.slug = ${sqlString(citySlug)}
on conflict (city_id, normalized_name) do update set
  name = excluded.name,
  osm_ids = excluded.osm_ids,
  highway_types = excluded.highway_types,
  length_m = excluded.length_m,
  difficulty = excluded.difficulty,
  geom = excluded.geom,
  imported_at = now(),
  source_updated_at = excluded.source_updated_at,
  source = excluded.source;

commit;
`;
}

export function renderStreetImportJson(
  citySlug: CitySlug,
  rows: readonly StreetImportRow[],
): string {
  return `${JSON.stringify(
    {
      schema: "private.streets",
      city_slug: citySlug,
      source_updated_at: rows[0]?.source_updated_at ?? null,
      streets: rows.filter((row) => row.city_slug === citySlug),
    },
    null,
    2,
  )}\n`;
}

type OutputFormat = "json" | "sql" | "both";

interface CliOptions {
  readonly citySlug: CitySlug | null;
  readonly allCities: boolean;
  readonly fetch: boolean;
  readonly inputPath: string | null;
  readonly endpoint: string;
  readonly outputDirectory: string | null;
  readonly format: OutputFormat;
  readonly minimumPoolSize: number;
  readonly allowSmallPools: boolean;
  readonly help: boolean;
}

const HELP = `Roadhunt OpenStreetMap importer

No network request is made unless --fetch is explicitly present.

Usage:
  npm run osm:import -- --city berlin --input /path/overpass.json --format json
  npm run osm:import -- --city berlin --fetch --format sql --output /path/to/output
  npm run osm:import -- --all --fetch --format both --output /path/to/output

Options:
  --city <slug>              One of: ${CITIES.map((city) => city.slug).join(", ")}
  --all                      Import all twelve cities (requires --fetch and --output)
  --input <file>             Transform an existing Overpass JSON response offline
  --fetch                    Explicitly allow an Overpass network request
  --endpoint <url>           Override the Overpass endpoint
  --format <json|sql|both>   Output format (default: json)
  --output <directory>       Write <city>.json/.sql instead of stdout
  --minimum-pool-size <n>    Require n streets per difficulty (default: 10)
  --allow-small-pools        Skip minimum pool validation
  --help                     Show this help
`;

function optionValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseCliOptions(args: readonly string[]): CliOptions {
  let citySlug: CitySlug | null = null;
  let allCities = false;
  let fetchEnabled = false;
  let inputPath: string | null = null;
  let endpoint = DEFAULT_OVERPASS_ENDPOINT;
  let outputDirectory: string | null = null;
  let format: OutputFormat = "json";
  let minimumPoolSize = 10;
  let allowSmallPools = false;
  let help = args.length === 0;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--all") allCities = true;
    else if (argument === "--fetch") fetchEnabled = true;
    else if (argument === "--allow-small-pools") allowSmallPools = true;
    else if (argument === "--city") {
      const value = optionValue(args, index, argument);
      if (!isCitySlug(value)) throw new Error(`Unknown city slug: ${value}`);
      citySlug = value;
      index += 1;
    } else if (argument === "--input") {
      inputPath = optionValue(args, index, argument);
      index += 1;
    } else if (argument === "--endpoint") {
      endpoint = optionValue(args, index, argument);
      index += 1;
    } else if (argument === "--output") {
      outputDirectory = optionValue(args, index, argument);
      index += 1;
    } else if (argument === "--format") {
      const value = optionValue(args, index, argument);
      if (value !== "json" && value !== "sql" && value !== "both") {
        throw new Error(`Unsupported output format: ${value}`);
      }
      format = value;
      index += 1;
    } else if (argument === "--minimum-pool-size") {
      const value = Number(optionValue(args, index, argument));
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("--minimum-pool-size must be a non-negative integer");
      }
      minimumPoolSize = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!help) {
    if (allCities === (citySlug !== null)) {
      throw new Error("Choose exactly one of --city or --all");
    }
    if (fetchEnabled === (inputPath !== null)) {
      throw new Error("Choose exactly one of --fetch or --input");
    }
    if (allCities && (!fetchEnabled || !outputDirectory)) {
      throw new Error("--all requires both --fetch and --output");
    }
    if ((allCities || format === "both") && !outputDirectory) {
      throw new Error("--all and --format both require --output");
    }
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.protocol !== "https:" && endpointUrl.protocol !== "http:") {
      throw new Error("Overpass endpoint must use http or https");
    }
  }

  return {
    citySlug,
    allCities,
    fetch: fetchEnabled,
    inputPath,
    endpoint,
    outputDirectory,
    format,
    minimumPoolSize,
    allowSmallPools,
    help,
  };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchOverpassResponse(
  citySlug: CitySlug,
  endpoint = DEFAULT_OVERPASS_ENDPOINT,
): Promise<OverpassResponse> {
  const body = new URLSearchParams({ data: buildOverpassQuery(citySlug) });
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "Roadhunt-OSM-Importer/1.0 (https://roadhunt.app)",
        },
        body,
        signal: AbortSignal.timeout(190_000),
      });
      if (response.ok) return asOverpassResponse(await response.json());
      const message = `Overpass request failed with HTTP ${response.status}`;
      if (response.status !== 429 && response.status < 500) throw new Error(message);
      lastError = new Error(message);
    } catch (error) {
      lastError = error;
    }
    if (attempt < FETCH_RETRIES) await delay(500 * 2 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error("Overpass request failed");
}

async function writeOutputs(
  outputDirectory: string,
  citySlug: CitySlug,
  format: OutputFormat,
  rows: readonly StreetImportRow[],
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  if (format === "json" || format === "both") {
    await writeFile(
      path.join(outputDirectory, `${citySlug}.json`),
      renderStreetImportJson(citySlug, rows),
      "utf8",
    );
  }
  if (format === "sql" || format === "both") {
    await writeFile(
      path.join(outputDirectory, `${citySlug}.sql`),
      renderStreetImportSql(citySlug, rows),
      "utf8",
    );
  }
}

async function loadRows(citySlug: CitySlug, options: CliOptions): Promise<readonly StreetImportRow[]> {
  const response = options.fetch
    ? await fetchOverpassResponse(citySlug, options.endpoint)
    : asOverpassResponse(JSON.parse(await readFile(options.inputPath!, "utf8")) as unknown);
  const rows = transformOverpassResponse(citySlug, response);
  if (!options.allowSmallPools) assertMinimumStreetPools(rows, options.minimumPoolSize);
  return rows;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const citySlugs = options.allCities ? CITIES.map((city) => city.slug) : [options.citySlug!];
  for (const citySlug of citySlugs) {
    const rows = await loadRows(citySlug, options);
    if (options.outputDirectory) {
      await writeOutputs(path.resolve(options.outputDirectory), citySlug, options.format, rows);
      process.stderr.write(
        `${citySlug}: wrote ${rows.length} grouped streets (${JSON.stringify(
          countDifficultyPools(rows),
        )})\n`,
      );
    } else {
      process.stdout.write(
        options.format === "sql"
          ? renderStreetImportSql(citySlug, rows)
          : renderStreetImportJson(citySlug, rows),
      );
    }
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
