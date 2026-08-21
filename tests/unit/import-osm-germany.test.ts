import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  OSM2PGSQL_DOCKER_IMAGE,
  SNAPSHOT,
  dockerOsm2pgsqlInvocation,
  nativeOsm2pgsqlArgs,
  parseGermanyImportOptions,
  parseOsm2pgsqlVersion,
  resolveOsm2pgsqlRuntime,
} from "../../scripts/import-osm-germany";

describe("Germany OSM importer options", () => {
  it("uses deterministic numeric lengths and stable geometry ordering in the street rollup", () => {
    const publishSql = readFileSync(
      new URL("../../scripts/osm-germany/publish.sql", import.meta.url),
      "utf8",
    ).replace(/\s+/g, " ");

    expect(publishSql).toContain(
      "round(sum(segment.length_m::numeric), 6)::double precision as length_m",
    );
    expect(publishSql).toContain(
      "round( sum(segment.length_m::numeric) filter (where segment.segment_playable), 6 )::double precision as playable_length_m",
    );
    expect(publishSql).not.toContain("sum(segment.length_m) as length_m");
    expect(
      publishSql.match(
        /extensions\.st_collect\( segment\.geom order by segment\.way_id, segment\.length_m, extensions\.st_asewkb\(segment\.geom\) \)/g,
      ),
    ).toHaveLength(2);
    expect(publishSql).toContain(
      "'rollupAlgorithm', 'stable-ordered-numeric-v1'",
    );
  });

  it("pins an immutable Geofabrik snapshot and osm2pgsql image", () => {
    expect(SNAPSHOT.filename).toBe("germany-260819.osm.pbf");
    expect(SNAPSHOT.bytes).toBe(4_821_837_039);
    expect(SNAPSHOT.md5).toMatch(/^[a-f0-9]{32}$/);
    expect(OSM2PGSQL_DOCKER_IMAGE).toBe(
      "iboates/osm2pgsql@sha256:25ad3e2c316f4c582f188c88d50bdae4b7d67671ade99c9a7539d2c2a2c0a670",
    );
  });

  it("defaults to the isolated local Supabase database", () => {
    const options = parseGermanyImportOptions(["stage"]);
    expect(options).toMatchObject({
      phase: "stage",
      runtime: "auto",
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:55322/postgres",
      cacheMb: 4096,
    });
  });

  it("uses slim/drop so the node cache is valid but middle tables are disposable", () => {
    const options = parseGermanyImportOptions([
      "stage",
      "--runtime",
      "native",
      "--skip-checksum",
    ]);
    const args = nativeOsm2pgsqlArgs(options);
    expect(args).toContain("--slim");
    expect(args).toContain("--drop");
    expect(args).toContain("--middle-schema");
    expect(args).toContain("osm_import");
    expect(args).toContain("--cache");
  });

  it("mounts only an arbitrary PBF and flex.lua into Docker without putting secrets in argv", () => {
    const options = parseGermanyImportOptions([
      "stage",
      "--runtime",
      "docker",
      "--pbf",
      "/tmp/road hunt/custom-germany.osm.pbf",
      "--database-url",
      "postgresql://road_user:top-secret@example.test:5432/roadhunt?sslmode=require",
      "--allow-remote",
      "--skip-checksum",
    ]);
    const invocation = dockerOsm2pgsqlInvocation(options);
    const mounts = invocation.args.flatMap((argument, index) =>
      invocation.args[index - 1] === "--volume" ? [argument] : [],
    );

    expect(mounts).toHaveLength(2);
    expect(mounts[0]).toBe("/tmp/road hunt/custom-germany.osm.pbf:/data/source.osm.pbf:ro");
    expect(mounts[1]).toMatch(/\/scripts\/osm-germany\/flex\.lua:\/config\/flex\.lua:ro$/);
    expect(invocation.args).toContain("PGPASSWORD");
    expect(invocation.args).toContain("PGSSLMODE");
    expect(invocation.args.join(" ")).not.toContain("top-secret");
    expect(invocation.env).toEqual({ PGPASSWORD: "top-secret", PGSSLMODE: "require" });
  });

  it("parses and accepts exactly the pinned native osm2pgsql version", async () => {
    expect(parseOsm2pgsqlVersion("osm2pgsql version 2.3.1\nBuild: Release")).toBe("2.3.1");
    expect(parseOsm2pgsqlVersion("Docker version 29.7.2")).toBeNull();

    const runtime = await resolveOsm2pgsqlRuntime("native", async (command) => ({
      status: "ok",
      output: command === "osm2pgsql" ? "osm2pgsql version 2.3.1\nBuild: Release" : "unexpected",
    }));
    expect(runtime).toBe("native");
  });

  it("hard-fails a mismatched explicitly selected native runtime", async () => {
    await expect(resolveOsm2pgsqlRuntime("native", async () => ({
      status: "ok",
      output: "osm2pgsql version 2.2.0",
    }))).rejects.toThrow("found 2.2.0, required exactly 2.3.1");
  });

  it("falls back from a mismatched native runtime to an available Docker daemon", async () => {
    const commands: string[] = [];
    const runtime = await resolveOsm2pgsqlRuntime("auto", async (command) => {
      commands.push(command);
      return command === "osm2pgsql"
        ? { status: "ok", output: "osm2pgsql version 2.4.0" }
        : { status: "ok", output: "29.7.2" };
    });

    expect(runtime).toBe("docker");
    expect(commands).toEqual(["osm2pgsql", "docker"]);
  });

  it("reports a clear Docker availability error before staging", async () => {
    await expect(resolveOsm2pgsqlRuntime("docker", async () => ({
      status: "failed",
      output: "Cannot connect to the Docker daemon",
    }))).rejects.toThrow("Docker is installed but its daemon is unavailable");
  });

  it("requires explicit authorization for every non-local database", () => {
    expect(() =>
      parseGermanyImportOptions([
        "verify",
        "--database-url",
        "postgresql://postgres:secret@example.test:5432/postgres",
      ]),
    ).toThrow("Refusing a database other than local Supabase port 55322");

    expect(
      parseGermanyImportOptions([
        "verify",
        "--database-url",
        "postgresql://postgres:secret@example.test:5432/postgres",
        "--allow-remote",
      ]).allowRemote,
    ).toBe(true);
  });
});
