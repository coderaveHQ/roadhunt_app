import { execFileSync } from "node:child_process";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const rootDirectory = process.cwd();
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

type SupabaseEnvironment = {
  url: string;
  publishableKey: string;
  secretKey: string;
};

function parseEnvOutput(output: string) {
  const values: Record<string, string> = {};

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
    if (!match) continue;
    values[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  return values;
}

function localSupabaseEnvironment(): SupabaseEnvironment | null {
  const configured = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY,
    secretKey: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  if (configured.url && configured.publishableKey && configured.secretKey) {
    return configured as SupabaseEnvironment;
  }

  try {
    const executable = path.join(
      rootDirectory,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "supabase.cmd" : "supabase",
    );
    const output = execFileSync(executable, ["status", "-o", "env"], {
      cwd: rootDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    const status = parseEnvOutput(output);
    const local = {
      url: status.API_URL ?? "http://127.0.0.1:55321",
      publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
      secretKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
    };

    return local.url && local.publishableKey && local.secretKey
      ? (local as SupabaseEnvironment)
      : null;
  } catch {
    return null;
  }
}

const supabase = localSupabaseEnvironment();
process.env.ROADHUNT_E2E_SUPABASE_AVAILABLE = supabase ? "true" : "false";
const webServerEnvironment = supabase
  ? {
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
      SUPABASE_SECRET_KEY: supabase.secretKey,
    }
  : {};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "de-DE",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    cwd: rootDirectory,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: webServerEnvironment,
  },
});
