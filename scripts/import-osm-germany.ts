#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, rename, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SNAPSHOT = {
  date: "2026-08-19T20:20:48Z",
  filename: "germany-260819.osm.pbf",
  url: "https://download.geofabrik.de/europe/germany-260819.osm.pbf",
  bytes: 4_821_837_039,
  md5: "14a4f4ce1ab3ace8e858efa73b43c78f",
} as const;

export const OSM2PGSQL_VERSION = "2.3.1";
export const OSM2PGSQL_DOCKER_IMAGE =
  "iboates/osm2pgsql@sha256:25ad3e2c316f4c582f188c88d50bdae4b7d67671ade99c9a7539d2c2a2c0a670";
const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const IMPORT_ROOT = path.join(REPOSITORY_ROOT, "data", "osm-germany");
const SQL_ROOT = path.join(import.meta.dirname, "osm-germany");

type Phase = "all" | "download" | "stage" | "publish" | "verify";
export type Runtime = "auto" | "native" | "docker";

export interface CommandProbeResult {
  status: "ok" | "missing" | "failed";
  output: string;
}

export type CommandProbe = (
  command: string,
  args: readonly string[],
) => Promise<CommandProbeResult>;

export interface GermanyImportOptions {
  phase: Phase;
  runtime: Runtime;
  pbfPath: string;
  databaseUrl: string;
  allowRemote: boolean;
  cacheMb: number;
  processes: number;
  skipChecksum: boolean;
  help: boolean;
}

const HELP = `Roadhunt Germany-wide OpenStreetMap importer

Usage:
  npm run osm:import -- all
  npm run osm:import -- stage --runtime native
  npm run osm:import -- publish
  npm run osm:import -- verify

Phases:
  download   Resume/download and verify the pinned Geofabrik PBF
  stage      Recreate only osm_import and load the PBF with osm2pgsql Flex
  publish    Validate staging, then upsert the Roadhunt catalog and streets
  verify     Print catalog, geometry and difficulty-pool statistics
  all        Run all phases in order (default)

Options:
  --pbf <path>          PBF path (default: data/osm-germany/cache/${SNAPSHOT.filename})
  --database-url <url> PostgreSQL URL (default: local Supabase port 55322)
  --runtime <mode>     auto, native or docker (default: auto)
  --cache-mb <n>       osm2pgsql node cache in MiB (default: 4096)
  --processes <n>      osm2pgsql workers, 1..32 (default: up to 8)
  --allow-remote       Permit a non-local database URL
  --skip-checksum      Skip PBF size/MD5 verification (not recommended)
  --help               Show this help
`;

function optionValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseGermanyImportOptions(args: readonly string[]): GermanyImportOptions {
  let index = 0;
  let phase: Phase = "all";
  if (args[0] && !args[0].startsWith("--")) {
    if (!["all", "download", "stage", "publish", "verify"].includes(args[0])) {
      throw new Error(`Unknown phase: ${args[0]}`);
    }
    phase = args[0] as Phase;
    index = 1;
  }

  let runtime: Runtime = "auto";
  let pbfPath = path.join(IMPORT_ROOT, "cache", SNAPSHOT.filename);
  let databaseUrl = process.env.ROADHUNT_DATABASE_URL ?? DEFAULT_DATABASE_URL;
  let allowRemote = false;
  let cacheMb = 4096;
  let processes = Math.max(1, Math.min(8, os.availableParallelism()));
  let skipChecksum = false;
  let help = false;

  for (; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--allow-remote") allowRemote = true;
    else if (argument === "--skip-checksum") skipChecksum = true;
    else if (argument === "--pbf") {
      pbfPath = path.resolve(optionValue(args, index, argument));
      index += 1;
    } else if (argument === "--database-url") {
      databaseUrl = optionValue(args, index, argument);
      index += 1;
    } else if (argument === "--runtime") {
      const value = optionValue(args, index, argument);
      if (value !== "auto" && value !== "native" && value !== "docker") {
        throw new Error(`Unsupported runtime: ${value}`);
      }
      runtime = value;
      index += 1;
    } else if (argument === "--cache-mb") {
      cacheMb = Number(optionValue(args, index, argument));
      if (!Number.isInteger(cacheMb) || cacheMb < 256) {
        throw new Error("--cache-mb must be an integer of at least 256");
      }
      index += 1;
    } else if (argument === "--processes") {
      processes = Number(optionValue(args, index, argument));
      if (!Number.isInteger(processes) || processes < 1 || processes > 32) {
        throw new Error("--processes must be an integer between 1 and 32");
      }
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  const database = new URL(databaseUrl);
  const isLocal = ["127.0.0.1", "localhost", "::1"].includes(database.hostname);
  if (!allowRemote && (!isLocal || database.port !== "55322")) {
    throw new Error("Refusing a database other than local Supabase port 55322 without --allow-remote");
  }

  return { phase, runtime, pbfPath, databaseUrl, allowRemote, cacheMb, processes, skipChecksum, help };
}

interface DatabaseConnection {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  sslmode: string | null;
}

function databaseConnection(databaseUrl: string, docker = false): DatabaseConnection {
  const url = new URL(databaseUrl);
  return {
    host: docker && ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
      ? "host.docker.internal"
      : url.hostname,
    port: url.port || "5432",
    database: url.pathname.replace(/^\//, "") || "postgres",
    user: decodeURIComponent(url.username || "postgres"),
    password: decodeURIComponent(url.password),
    sslmode: url.searchParams.get("sslmode"),
  };
}

async function run(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal ?? "unknown status"}`));
    });
  });
}

async function probeCommand(command: string, args: readonly string[]): Promise<CommandProbeResult> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(command, args, {
      cwd: REPOSITORY_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      resolve({
        status: error.code === "ENOENT" ? "missing" : "failed",
        output: error.message,
      });
    });
    child.once("exit", (code) => {
      resolve({
        status: code === 0 ? "ok" : "failed",
        output: output.trim(),
      });
    });
  });
}

export function parseOsm2pgsqlVersion(output: string): string | null {
  return output.match(/^osm2pgsql version (\d+\.\d+\.\d+)\b/m)?.[1] ?? null;
}

function probeDetails(probe: CommandProbeResult): string {
  return probe.output ? ` (${probe.output.replace(/\s+/g, " ").trim()})` : "";
}

export async function resolveOsm2pgsqlRuntime(
  requested: Runtime,
  probe: CommandProbe = probeCommand,
): Promise<Exclude<Runtime, "auto">> {
  if (requested !== "docker") {
    const nativeProbe = await probe("osm2pgsql", ["--version"]);
    const nativeVersion = nativeProbe.status === "ok"
      ? parseOsm2pgsqlVersion(nativeProbe.output)
      : null;

    if (nativeProbe.status === "ok" && nativeVersion === OSM2PGSQL_VERSION) {
      return "native";
    }

    if (requested === "native") {
      if (nativeProbe.status === "missing") {
        throw new Error(
          `Native osm2pgsql is not installed or not on PATH; exactly version ${OSM2PGSQL_VERSION} is required`,
        );
      }
      if (nativeVersion) {
        throw new Error(
          `Native osm2pgsql version mismatch: found ${nativeVersion}, required exactly ${OSM2PGSQL_VERSION}`,
        );
      }
      throw new Error(
        `Could not verify native osm2pgsql ${OSM2PGSQL_VERSION}${probeDetails(nativeProbe)}`,
      );
    }
  }

  const dockerProbe = await probe("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (dockerProbe.status === "missing") {
    throw new Error(
      `Docker is not installed or not on PATH. Install and start Docker, or install osm2pgsql ${OSM2PGSQL_VERSION}`,
    );
  }
  if (dockerProbe.status !== "ok") {
    throw new Error(
      `Docker is installed but its daemon is unavailable. Start Docker Desktop (or the Docker daemon) and retry${probeDetails(dockerProbe)}`,
    );
  }
  return "docker";
}

async function fileMd5(filename: string): Promise<string> {
  const digest = createHash("md5");
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filename);
    input.on("data", (chunk) => digest.update(chunk));
    input.once("error", reject);
    input.once("end", resolve);
  });
  return digest.digest("hex");
}

export async function verifyPinnedPbf(pbfPath: string): Promise<void> {
  const details = await stat(pbfPath);
  if (details.size !== SNAPSHOT.bytes) {
    throw new Error(`PBF size mismatch: got ${details.size}, expected ${SNAPSHOT.bytes}`);
  }
  const digest = await fileMd5(pbfPath);
  if (digest !== SNAPSHOT.md5) {
    throw new Error(`PBF MD5 mismatch: got ${digest}, expected ${SNAPSHOT.md5}`);
  }
}

async function downloadPinnedPbf(pbfPath: string): Promise<void> {
  await mkdir(path.dirname(pbfPath), { recursive: true });
  try {
    await verifyPinnedPbf(pbfPath);
    process.stderr.write(`PBF already verified: ${pbfPath}\n`);
    return;
  } catch {
    // A valid final file is the only condition that skips the resumable download.
  }

  const partialPath = `${pbfPath}.part`;
  await run("curl", ["--fail", "--location", "--continue-at", "-", "--output", partialPath, SNAPSHOT.url]);
  await verifyPinnedPbf(partialPath);
  await rename(partialPath, pbfPath);
}

function postgresArgs(connection: DatabaseConnection): string[] {
  return [
    "--host", connection.host,
    "--port", connection.port,
    "--username", connection.user,
    "--dbname", connection.database,
  ];
}

async function psql(databaseUrl: string, filename: string, variables: Record<string, string> = {}): Promise<void> {
  const connection = databaseConnection(databaseUrl);
  const args = [
    ...postgresArgs(connection),
    "--set", "ON_ERROR_STOP=1",
    ...Object.entries(variables).flatMap(([key, value]) => ["--set", `${key}=${value}`]),
    "--file", filename,
  ];
  await run("psql", args, {
    PGPASSWORD: connection.password,
    ...(connection.sslmode ? { PGSSLMODE: connection.sslmode } : {}),
  });
}

export function nativeOsm2pgsqlArgs(options: GermanyImportOptions): string[] {
  const connection = databaseConnection(options.databaseUrl);
  return [
    "--create",
    "--slim",
    "--drop",
    "--output", "flex",
    "--style", path.join(SQL_ROOT, "flex.lua"),
    "--middle-schema", "osm_import",
    "--host", connection.host,
    "--port", connection.port,
    "--username", connection.user,
    "--database", connection.database,
    "--cache", String(options.cacheMb),
    "--number-processes", String(options.processes),
    "--log-progress", "true",
    options.pbfPath,
  ];
}

async function stageNative(options: GermanyImportOptions): Promise<void> {
  const connection = databaseConnection(options.databaseUrl);
  await run("osm2pgsql", nativeOsm2pgsqlArgs(options), {
    PGPASSWORD: connection.password,
    ...(connection.sslmode ? { PGSSLMODE: connection.sslmode } : {}),
  });
}

export interface DockerOsm2pgsqlInvocation {
  args: string[];
  env: Record<string, string>;
}

export function dockerOsm2pgsqlInvocation(options: GermanyImportOptions): DockerOsm2pgsqlInvocation {
  const connection = databaseConnection(options.databaseUrl, true);
  const pbfPath = path.resolve(options.pbfPath);
  const flexPath = path.join(SQL_ROOT, "flex.lua");
  const args = [
    "run", "--rm", "--platform", "linux/amd64",
    "--add-host", "host.docker.internal:host-gateway",
    "--volume", `${pbfPath}:/data/source.osm.pbf:ro`,
    "--volume", `${flexPath}:/config/flex.lua:ro`,
    "--env", "PGPASSWORD",
    ...(connection.sslmode ? ["--env", "PGSSLMODE"] : []),
    OSM2PGSQL_DOCKER_IMAGE,
    "--create", "--slim", "--drop", "--output", "flex",
    "--style", "/config/flex.lua",
    "--middle-schema", "osm_import",
    "--host", connection.host,
    "--port", connection.port,
    "--username", connection.user,
    "--database", connection.database,
    "--cache", String(options.cacheMb),
    "--number-processes", String(options.processes),
    "--log-progress", "true",
    "/data/source.osm.pbf",
  ];
  return {
    args,
    env: {
      PGPASSWORD: connection.password,
      ...(connection.sslmode ? { PGSSLMODE: connection.sslmode } : {}),
    },
  };
}

async function stageDocker(options: GermanyImportOptions): Promise<void> {
  const invocation = dockerOsm2pgsqlInvocation(options);
  try {
    await run("docker", invocation.args, invocation.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Docker osm2pgsql import failed with pinned image ${OSM2PGSQL_DOCKER_IMAGE}: ${message}`,
    );
  }
}

async function stage(options: GermanyImportOptions): Promise<void> {
  await access(options.pbfPath);
  if (!options.skipChecksum) await verifyPinnedPbf(options.pbfPath);
  const runtime = await resolveOsm2pgsqlRuntime(options.runtime);
  await psql(options.databaseUrl, path.join(SQL_ROOT, "prepare.sql"));

  if (runtime === "native") await stageNative(options);
  else await stageDocker(options);
}

function importVariables(): Record<string, string> {
  return { snapshot_url: SNAPSHOT.url, snapshot_date: SNAPSHOT.date, snapshot_md5: SNAPSHOT.md5 };
}

async function publish(options: GermanyImportOptions): Promise<void> {
  await psql(options.databaseUrl, path.join(SQL_ROOT, "publish.sql"), importVariables());
}

async function verify(options: GermanyImportOptions): Promise<void> {
  await psql(options.databaseUrl, path.join(SQL_ROOT, "verify.sql"), importVariables());
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseGermanyImportOptions(args);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (options.phase === "all" || options.phase === "download") await downloadPinnedPbf(options.pbfPath);
  if (options.phase === "all" || options.phase === "stage") await stage(options);
  if (options.phase === "all" || options.phase === "publish") await publish(options);
  if (options.phase === "all" || options.phase === "verify") await verify(options);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
