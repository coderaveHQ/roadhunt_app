#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { SNAPSHOT } from "./import-osm-germany";

export const PRODUCTION_COUNTS = {
  cities: 10_941,
  cityTranslations: 21_882,
  cityAdminAreaTranslations: 21_882,
  archiveStreets: 1_324_500,
  syntheticStreets: 480,
  streets: 1_324_020,
  playableStreets: 1_124_492,
  pools: { easy: 2_401, medium: 2_998, hard: 5_215, insane: 8_181 },
} as const;

export const PRODUCTION_TABLES = [
  "public.cities",
  "public.city_translations",
  "public.city_admin_area_translations",
  "private.streets",
] as const;

const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const SQL_ROOT = path.join(import.meta.dirname, "osm-germany");
const OUTPUT_ROOT = path.join(REPOSITORY_ROOT, "data", "osm-germany", "production");
const DEFAULT_ARCHIVE = path.join(OUTPUT_ROOT, "roadhunt-germany-260819.dump");

type Phase = "export" | "restore" | "verify";

export interface TransferOptions {
  phase: Phase;
  archivePath: string;
  sourceDatabaseUrl: string;
  targetDatabaseUrl: string | null;
  allowRemote: boolean;
  help: boolean;
}

interface DatabaseConnection {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  sslmode: string | null;
}

interface ProductionManifest {
  version: 1;
  createdAt: string;
  snapshot: typeof SNAPSHOT;
  counts: typeof PRODUCTION_COUNTS;
  tables: readonly string[];
  archive: { filename: string; bytes: number; sha256: string };
}

const HELP = `Roadhunt Micro-safe production data transfer

Usage:
  npm run osm:export:production
  npm run osm:restore:production -- --allow-remote
  npm run osm:verify:production -- --allow-remote

Options:
  --archive <path>  Custom archive path
  --allow-remote    Explicitly authorize a remote production target
  --help            Show this help

Environment:
  ROADHUNT_SOURCE_DATABASE_URL      Optional local source override
  ROADHUNT_PRODUCTION_DATABASE_URL  Required remote Direct/Session URL
`;

function optionValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseTransferOptions(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): TransferOptions {
  const phase = args[0] as Phase | undefined;
  if (!phase || !["export", "restore", "verify"].includes(phase)) {
    throw new Error("The first argument must be export, restore, or verify");
  }

  let archivePath = DEFAULT_ARCHIVE;
  let allowRemote = false;
  let help = false;

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--allow-remote") allowRemote = true;
    else if (argument === "--archive") {
      archivePath = path.resolve(optionValue(args, index, argument));
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  const sourceDatabaseUrl = env.ROADHUNT_SOURCE_DATABASE_URL ?? LOCAL_DATABASE_URL;
  const targetDatabaseUrl = env.ROADHUNT_PRODUCTION_DATABASE_URL ?? null;

  if (phase !== "export") {
    if (!targetDatabaseUrl) {
      throw new Error("ROADHUNT_PRODUCTION_DATABASE_URL is required");
    }
    const target = new URL(targetDatabaseUrl);
    if (["127.0.0.1", "localhost", "::1"].includes(target.hostname)) {
      throw new Error("Production restore refuses a local target");
    }
    if (!allowRemote) {
      throw new Error("Production restore requires explicit --allow-remote authorization");
    }
    if (!target.password) {
      throw new Error("The production database URL must include its database password");
    }
  }

  return { phase, archivePath, sourceDatabaseUrl, targetDatabaseUrl, allowRemote, help };
}

function databaseConnection(databaseUrl: string): DatabaseConnection {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.replace(/^\//, "") || "postgres",
    user: decodeURIComponent(url.username || "postgres"),
    password: decodeURIComponent(url.password),
    sslmode: url.searchParams.get("sslmode"),
  };
}

function connectionArgs(connection: DatabaseConnection): string[] {
  return [
    "--host", connection.host,
    "--port", connection.port,
    "--username", connection.user,
    "--dbname", connection.database,
    "--no-password",
  ];
}

function connectionEnv(connection: DatabaseConnection): NodeJS.ProcessEnv {
  const remote = !["127.0.0.1", "localhost", "::1"].includes(connection.host);
  return {
    ...process.env,
    PGPASSWORD: connection.password,
    ...(connection.sslmode || remote
      ? { PGSSLMODE: connection.sslmode ?? "require" }
      : {}),
  };
}

async function run(
  command: string,
  args: readonly string[],
  connection?: DatabaseConnection,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPOSITORY_ROOT,
      env: connection ? connectionEnv(connection) : process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal ?? "unknown status"}`));
    });
  });
}

async function capture(
  command: string,
  args: readonly string[],
  connection?: DatabaseConnection,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: REPOSITORY_ROOT,
      env: connection ? connectionEnv(connection) : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(
        `${command} exited with ${code ?? signal ?? "unknown status"}${stderr ? `: ${stderr.trim()}` : ""}`,
      ));
    });
  });
}

async function psqlFile(connection: DatabaseConnection, filename: string): Promise<void> {
  await run("psql", [
    ...connectionArgs(connection),
    "--set", "ON_ERROR_STOP=1",
    "--set", `snapshot_url=${SNAPSHOT.url}`,
    "--set", `snapshot_date=${SNAPSHOT.date}`,
    "--set", `snapshot_md5=${SNAPSHOT.md5}`,
    "--file", filename,
  ], connection);
}

async function psqlJson<T>(connection: DatabaseConnection, filename: string): Promise<T> {
  const output = await capture("psql", [
    ...connectionArgs(connection),
    "--set", "ON_ERROR_STOP=1",
    "--set", `snapshot_url=${SNAPSHOT.url}`,
    "--set", `snapshot_date=${SNAPSHOT.date}`,
    "--set", `snapshot_md5=${SNAPSHOT.md5}`,
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--file", filename,
  ], connection);
  return JSON.parse(output) as T;
}

async function sha256(filename: string): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filename);
    input.on("data", (chunk) => digest.update(chunk));
    input.once("error", reject);
    input.once("end", resolve);
  });
  return digest.digest("hex");
}

function manifestPath(archivePath: string): string {
  return `${archivePath}.manifest.json`;
}

export function pgDumpArgs(connection: DatabaseConnection, archivePath: string): string[] {
  return [
    ...connectionArgs(connection),
    "--format", "custom",
    "--compress", "zstd:6",
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--verbose",
    "--strict-names",
    ...PRODUCTION_TABLES.flatMap((table) => ["--table", table]),
    "--file", archivePath,
  ];
}

export function pgRestoreArgs(connection: DatabaseConnection, archivePath: string): string[] {
  return [
    ...connectionArgs(connection),
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--verbose",
    "--exit-on-error",
    "--single-transaction",
    archivePath,
  ];
}

async function exportProduction(options: TransferOptions): Promise<void> {
  const source = databaseConnection(options.sourceDatabaseUrl);
  await psqlJson(source, path.join(SQL_ROOT, "production-source-verify.sql"));

  await mkdir(path.dirname(options.archivePath), { recursive: true });
  const partialArchive = `${options.archivePath}.partial`;
  try {
    await access(options.archivePath);
    throw new Error(`Production archive already exists: ${options.archivePath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Production archive")) throw error;
  }

  await run("pg_dump", pgDumpArgs(source, partialArchive), source);
  await run("pg_restore", ["--list", partialArchive]);

  const archiveStat = await stat(partialArchive);
  const manifest: ProductionManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    snapshot: SNAPSHOT,
    counts: PRODUCTION_COUNTS,
    tables: PRODUCTION_TABLES,
    archive: {
      filename: path.basename(options.archivePath),
      bytes: archiveStat.size,
      sha256: await sha256(partialArchive),
    },
  };

  const partialManifest = `${manifestPath(options.archivePath)}.partial`;
  await writeFile(partialManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(partialArchive, options.archivePath);
  await rename(partialManifest, manifestPath(options.archivePath));
  process.stderr.write(`Production archive ready: ${options.archivePath}\n`);
}

async function readManifest(archivePath: string): Promise<ProductionManifest> {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(manifestPath(archivePath), "utf8")) as ProductionManifest;
  if (manifest.version !== 1 || manifest.snapshot.md5 !== SNAPSHOT.md5) {
    throw new Error("Production archive manifest does not match the pinned OSM snapshot");
  }
  const archiveStat = await stat(archivePath);
  if (archiveStat.size !== manifest.archive.bytes || await sha256(archivePath) !== manifest.archive.sha256) {
    throw new Error("Production archive size or SHA-256 does not match its manifest");
  }
  return manifest;
}

async function restoreProduction(options: TransferOptions): Promise<void> {
  if (!options.targetDatabaseUrl) throw new Error("Missing production database URL");
  const target = databaseConnection(options.targetDatabaseUrl);
  await readManifest(options.archivePath);
  await run("pg_restore", ["--list", options.archivePath]);
  await psqlJson(target, path.join(SQL_ROOT, "production-target-preflight.sql"));
  await run("pg_restore", pgRestoreArgs(target, options.archivePath), target);
  await psqlFile(target, path.join(SQL_ROOT, "production-target-finalize.sql"));
  await psqlJson(target, path.join(SQL_ROOT, "production-target-verify.sql"));
  process.stderr.write("Production Roadhunt catalog restore verified successfully.\n");
}

async function verifyProduction(options: TransferOptions): Promise<void> {
  if (!options.targetDatabaseUrl) throw new Error("Missing production database URL");
  await psqlJson(
    databaseConnection(options.targetDatabaseUrl),
    path.join(SQL_ROOT, "production-target-verify.sql"),
  );
  process.stderr.write("Production Roadhunt catalog verification passed.\n");
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help") && args.length === 1) {
    process.stdout.write(HELP);
    return;
  }
  const options = parseTransferOptions(args);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (options.phase === "export") await exportProduction(options);
  else if (options.phase === "restore") await restoreProduction(options);
  else await verifyProduction(options);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
