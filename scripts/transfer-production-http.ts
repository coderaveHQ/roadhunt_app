#!/usr/bin/env node

import { spawn } from "node:child_process";
import type { Readable } from "node:stream";

import { PRODUCTION_COUNTS } from "./transfer-production-data";

const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const DEFAULT_SUPABASE_URL = "https://jyivcugkvbovbbrukmwz.supabase.co";
const MAX_BATCH_BYTES = 1_750_000;
const MAX_BATCH_ROWS = 1_000;

type ImportTable =
  | "cities"
  | "city_translations"
  | "city_admin_area_translations"
  | "streets";

interface BatchResponse {
  ok: boolean;
  table?: string;
  received?: number;
  inserted?: number;
  cities?: number;
  cityTranslations?: number;
  cityAdminAreaTranslations?: number;
  streets?: number;
  playableStreets?: number;
  databaseBytes?: number;
}

interface TableDefinition {
  name: ImportTable;
  expected: number;
  query: string;
}

async function* readLines(input: Readable): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of input) {
    buffer += chunk.toString();
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      yield buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  if (buffer) yield buffer.replace(/\r$/, "");
}

const TABLES: readonly TableDefinition[] = [
  {
    name: "cities",
    expected: PRODUCTION_COUNTS.cities,
    query: `select jsonb_build_object(
      'id', id,
      'countryId', country_id,
      'slug', slug,
      'centerEwkb', encode(extensions.st_asewkb(center), 'base64'),
      'boundsEwkb', encode(extensions.st_asewkb(bounds), 'base64'),
      'enabled', enabled,
      'createdAt', created_at,
      'updatedAt', updated_at,
      'officialCode', official_code,
      'osmRelationId', osm_relation_id,
      'wikidataId', wikidata_id,
      'adminLevel', admin_level,
      'settlementType', settlement_type,
      'population', population,
      'featured', featured,
      'sourceUpdatedAt', source_updated_at,
      'source', source,
      'featuredOrder', featured_order,
      'boundsBbox', bounds_bbox
    )::text from public.cities order by id`,
  },
  {
    name: "city_translations",
    expected: PRODUCTION_COUNTS.cityTranslations,
    query: `select jsonb_build_object(
      'cityId', city_id,
      'locale', locale,
      'name', name
    )::text from public.city_translations order by city_id, locale`,
  },
  {
    name: "city_admin_area_translations",
    expected: PRODUCTION_COUNTS.cityAdminAreaTranslations,
    query: `select jsonb_build_object(
      'cityId', city_id,
      'locale', locale,
      'stateName', state_name,
      'districtName', district_name
    )::text from public.city_admin_area_translations order by city_id, locale`,
  },
  {
    name: "streets",
    expected: PRODUCTION_COUNTS.streets,
    query: `select jsonb_build_object(
      'id', id,
      'cityId', city_id,
      'name', name,
      'normalizedName', normalized_name,
      'osmIds', osm_ids,
      'highwayTypes', highway_types,
      'lengthM', length_m,
      'difficulty', difficulty,
      'geomEwkb', encode(extensions.st_asewkb(geom), 'base64'),
      'importedAt', imported_at,
      'sourceUpdatedAt', source_updated_at,
      'source', source,
      'isPlayable', is_playable,
      'exclusionReasons', exclusion_reasons
    )::text
    from private.streets
    where source->>'kind' is distinct from 'synthetic-demo'
    order by id`,
  },
] as const;

function connectionArgs(databaseUrl: string): { args: string[]; env: NodeJS.ProcessEnv } {
  const url = new URL(databaseUrl);
  return {
    args: [
      "--host", url.hostname,
      "--port", url.port || "5432",
      "--username", decodeURIComponent(url.username || "postgres"),
      "--dbname", url.pathname.replace(/^\//, "") || "postgres",
      "--no-password",
      "--quiet",
      "--tuples-only",
      "--no-align",
    ],
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
  };
}

async function rpc(
  supabaseUrl: string,
  secretKey: string,
  table: string,
  rows: readonly unknown[] = [],
): Promise<BatchResponse> {
  const requestBody = JSON.stringify({ p_table: table, p_rows: rows });
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/import_production_batch`, {
        method: "POST",
        headers: {
          apikey: secretKey,
          "Content-Type": "application/json",
          "User-Agent": "roadhunt-production-import/1.0",
        },
        body: requestBody,
        signal: AbortSignal.timeout(120_000),
      });
      const body = await response.text();
      if (response.ok) return JSON.parse(body) as BatchResponse;
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`Import RPC ${response.status}: ${body}`);
      }
      lastError = new Error(`Import RPC ${response.status}: ${body}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1_000 * 2 ** attempt)));
  }

  throw lastError ?? new Error("Production import RPC failed");
}

async function importTable(
  definition: TableDefinition,
  sourceDatabaseUrl: string,
  supabaseUrl: string,
  secretKey: string,
): Promise<void> {
  const connection = connectionArgs(sourceDatabaseUrl);
  const child = spawn("psql", [
    ...connection.args,
    "--command", definition.query,
  ], { env: connection.env, stdio: ["ignore", "pipe", "inherit"] });
  const exitPromise = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  if (!child.stdout) throw new Error("psql did not expose stdout");
  let rows: unknown[] = [];
  let bytes = 2;
  let scanned = 0;
  let inserted = 0;
  let batches = 0;

  const flush = async (): Promise<void> => {
    if (rows.length === 0) return;
    const result = await rpc(supabaseUrl, secretKey, definition.name, rows);
    if (!result.ok || result.received !== rows.length || typeof result.inserted !== "number") {
      throw new Error(`Invalid ${definition.name} import response`);
    }
    inserted += result.inserted;
    batches += 1;
    if (batches === 1 || batches % 25 === 0 || scanned === definition.expected) {
      process.stderr.write(
        `${definition.name}: ${scanned.toLocaleString("en-US")}/${definition.expected.toLocaleString("en-US")} sent, ${inserted.toLocaleString("en-US")} inserted\n`,
      );
    }
    rows = [];
    bytes = 2;
  };

  for await (const line of readLines(child.stdout)) {
    if (!line) continue;
    const rowBytes = Buffer.byteLength(line) + 1;
    if (rows.length > 0 && (rows.length >= MAX_BATCH_ROWS || bytes + rowBytes > MAX_BATCH_BYTES)) {
      await flush();
    }
    rows.push(JSON.parse(line) as unknown);
    bytes += rowBytes;
    scanned += 1;
  }
  await flush();

  const exitCode = await exitPromise;
  if (exitCode !== 0) throw new Error(`psql source stream exited with ${exitCode}`);
  if (scanned !== definition.expected) {
    throw new Error(`${definition.name} source count ${scanned} differs from ${definition.expected}`);
  }
}

function assertPreflight(status: BatchResponse): void {
  if (!status.ok) throw new Error("Production import status failed");
  const limits = [
    ["cities", status.cities, PRODUCTION_COUNTS.cities],
    ["cityTranslations", status.cityTranslations, PRODUCTION_COUNTS.cityTranslations],
    ["cityAdminAreaTranslations", status.cityAdminAreaTranslations, PRODUCTION_COUNTS.cityAdminAreaTranslations],
    ["streets", status.streets, PRODUCTION_COUNTS.streets],
  ] as const;
  for (const [label, value, maximum] of limits) {
    if (typeof value !== "number" || value < 0 || value > maximum) {
      throw new Error(`Unexpected production ${label} count: ${String(value)}`);
    }
  }
}

export async function main(): Promise<void> {
  const secretKey = process.env.ROADHUNT_PRODUCTION_SECRET_KEY;
  if (!secretKey?.startsWith("sb_secret_")) {
    throw new Error("ROADHUNT_PRODUCTION_SECRET_KEY must contain a Supabase secret key");
  }
  const supabaseUrl = (process.env.ROADHUNT_PRODUCTION_SUPABASE_URL ?? DEFAULT_SUPABASE_URL).replace(/\/$/, "");
  const sourceDatabaseUrl = process.env.ROADHUNT_SOURCE_DATABASE_URL ?? LOCAL_DATABASE_URL;

  assertPreflight(await rpc(supabaseUrl, secretKey, "status"));
  for (const definition of TABLES) {
    await importTable(definition, sourceDatabaseUrl, supabaseUrl, secretKey);
  }
  const final = await rpc(supabaseUrl, secretKey, "finalize");
  if (!final.ok || final.cities !== PRODUCTION_COUNTS.cities || final.streets !== PRODUCTION_COUNTS.streets) {
    throw new Error("Production HTTPS import final verification failed");
  }
  process.stderr.write(
    `Production HTTPS import verified: ${final.cities?.toLocaleString("en-US")} cities, ${final.streets?.toLocaleString("en-US")} streets.\n`,
  );
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
