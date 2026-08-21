import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  PRODUCTION_COUNTS,
  PRODUCTION_TABLES,
  parseTransferOptions,
  pgDumpArgs,
  pgRestoreArgs,
} from "../../scripts/transfer-production-data";

const remoteUrl = "postgresql://postgres.project:top-secret@example.test:5432/postgres";

describe("Micro production catalog transfer", () => {
  it("pins the audited final catalog counts", () => {
    expect(PRODUCTION_COUNTS).toEqual({
      cities: 10_941,
      cityTranslations: 21_882,
      cityAdminAreaTranslations: 21_882,
      archiveStreets: 1_324_500,
      syntheticStreets: 480,
      streets: 1_324_020,
      playableStreets: 1_124_492,
      pools: { easy: 2_401, medium: 2_998, hard: 5_215, insane: 8_181 },
    });
  });

  it("exports only final application catalog tables", () => {
    expect(PRODUCTION_TABLES).toEqual([
      "public.cities",
      "public.city_translations",
      "public.city_admin_area_translations",
      "private.streets",
    ]);
  });

  it("requires a password and explicit remote authorization", () => {
    expect(() => parseTransferOptions(["restore"], {
      ROADHUNT_PRODUCTION_DATABASE_URL: remoteUrl,
    })).toThrow("--allow-remote");
    expect(() => parseTransferOptions(["restore", "--allow-remote"], {
      ROADHUNT_PRODUCTION_DATABASE_URL: "postgresql://postgres@example.test:5432/postgres",
    })).toThrow("must include its database password");
    expect(() => parseTransferOptions(["restore", "--allow-remote"], {
      ROADHUNT_PRODUCTION_DATABASE_URL: "postgresql://postgres:secret@127.0.0.1:55322/postgres",
    })).toThrow("refuses a local target");
  });

  it("keeps credentials out of pg_dump and pg_restore argv", () => {
    const options = parseTransferOptions(["restore", "--allow-remote"], {
      ROADHUNT_PRODUCTION_DATABASE_URL: remoteUrl,
    });
    const connection = {
      host: "example.test",
      port: "5432",
      database: "postgres",
      user: "postgres.project",
      password: "top-secret",
      sslmode: "require",
    };
    const dump = pgDumpArgs(connection, "/tmp/road.dump");
    const restore = pgRestoreArgs(connection, options.archivePath);

    expect(dump.join(" ")).not.toContain("top-secret");
    expect(restore.join(" ")).not.toContain("top-secret");
    expect(dump).toContain("zstd:6");
    expect(restore).toContain("--single-transaction");
    expect(restore).not.toContain("--jobs");
  });

  it("fails closed on target contents and verifies the pinned snapshot", () => {
    const preflight = readFileSync(
      new URL("../../scripts/osm-germany/production-target-preflight.sql", import.meta.url),
      "utf8",
    );
    const verify = readFileSync(
      new URL("../../scripts/osm-germany/production-target-verify.sql", import.meta.url),
      "utf8",
    );

    expect(preflight).toContain("Production catalog/game tables must be empty");
    expect(preflight).toContain("20260821085327");
    expect(verify).toContain("1324020");
    expect(verify).toContain("1124492");
    expect(verify).toContain("osm_import");
    expect(verify).toContain("snapshot_md5");
  });

  it("keeps the HTTPS fallback temporary, bounded, and service-role only", () => {
    const install = readFileSync(
      new URL("../../scripts/osm-germany/production-http-import-install.sql", import.meta.url),
      "utf8",
    );
    const uninstall = readFileSync(
      new URL("../../scripts/osm-germany/production-http-import-uninstall.sql", import.meta.url),
      "utf8",
    );
    const importer = readFileSync(
      new URL("../../scripts/transfer-production-http.ts", import.meta.url),
      "utf8",
    );

    expect(install).toContain("security definer");
    expect(install).toContain("set search_path = ''");
    expect(install).toContain("v_received > 2000");
    expect(install).toContain("pg_column_size(p_rows) > 3145728");
    expect(install).toContain("from public, anon, authenticated");
    expect(install).toContain("to service_role");
    expect(install).toContain("14a4f4ce1ab3ace8e858efa73b43c78f");
    expect(install).toContain("2026-08-19T20:20:48Z");
    expect(uninstall).toContain("drop function if exists");
    expect(importer).not.toMatch(/sb_secret_[A-Za-z0-9_-]{10,}/);
  });
});
