import { execFileSync } from "node:child_process";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const LOCAL_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";
const LOCAL_DATABASE_URL =
  process.env.ROADHUNT_E2E_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

type GameStateSnapshot = {
  id: string;
  lobbyCode: string | null;
  status: string;
  difficulty: string;
  roundNumber: number;
  viewerIsHost: boolean;
  city: { slug: string };
  players: Array<{ nickname: string; isHost: boolean }>;
  revealedRounds: Array<{
    number: number;
    guesses: Array<{ playerId: string; position: [number, number] | null }>;
  }>;
};

async function localSupabaseIsHealthy() {
  try {
    const response = await fetch(`${LOCAL_SUPABASE_URL}/auth/v1/health`, {
      signal: AbortSignal.timeout(2_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function runLocalSql(sql: string, variables: Record<string, string> = {}) {
  const args = [
    LOCAL_DATABASE_URL,
    "--no-psqlrc",
    "--set",
    "ON_ERROR_STOP=1",
    "--quiet",
    "--tuples-only",
    "--no-align",
  ];

  for (const [name, value] of Object.entries(variables)) {
    args.push("--set", `${name}=${value}`);
  }

  return execFileSync("psql", args, {
    encoding: "utf8",
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5_000,
  }).trim();
}

function holdCurrentReveal(gameId: string) {
  return runLocalSql(
    `
      with held_round as (
        update private.game_rounds
        set revealed_at = statement_timestamp() + interval '5 minutes'
        where game_id = :'game_id'::uuid
          and status = 'revealing'
        returning round_number
      )
      select coalesce(max(round_number)::text, 'waiting')
      from held_round;
    `,
    { game_id: gameId },
  );
}

function advancePastReveal(gameId: string) {
  return runLocalSql(
    `
      begin;

      update private.game_rounds
      set revealed_at = statement_timestamp() - interval '6 seconds'
      where game_id = :'game_id'::uuid
        and status = 'revealing';

      select private.synchronize_game_locked(
        :'game_id'::uuid,
        statement_timestamp()
      );

      select current_round_number::text || '|' || status::text
      from private.games
      where id = :'game_id'::uuid;

      commit;
    `,
    { game_id: gameId },
  );
}

async function createLobby(page: Page) {
  await page.goto("/de/play?mode=lobby");
  await page.getByLabel("Dein Nickname").fill("Host Hunter");
  await page.getByRole("button", { name: "Lobby erstellen" }).click();
  await expect(page).toHaveURL(/\/de\/lobby\/[2-9A-HJKMNP-Z]{6}\?game=[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Deine Lobby" })).toBeVisible();

  const url = new URL(page.url());
  const code = url.pathname.split("/").at(-1) ?? "";
  const gameId = url.searchParams.get("game") ?? "";
  expect(code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
  expect(gameId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  const settings = (await page.locator(".lobby-subtitle").textContent())?.trim() ?? "";
  return { code, gameId, settings };
}

async function joinLobby(page: Page, code: string) {
  await page.goto(`/en/lobby/${code}`);
  await expect(page).toHaveURL(`/en/play?mode=join&code=${code}`);
  await page.getByLabel("Your nickname").fill("Guest Scout");
  await expect(page.getByLabel("Lobby code")).toHaveValue(code);
  await page.getByRole("button", { name: "Join lobby" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/en/lobby/${code}\\?game=[0-9a-f-]{36}$`),
  );
  await expect(page.getByRole("heading", { name: "Your lobby" })).toBeVisible();
}

async function placeAndConfirmGuess(
  page: Page,
  labels: {
    confirm: string;
    initial: string;
    map: string;
    nickname: string;
    selectFirst: string;
  },
  offset: { x: number; y: number },
) {
  await expect(page.getByLabel(new RegExp(labels.map))).toBeVisible();
  const canvas = page.locator(".mapboxgl-canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: labels.selectFirst })).toBeDisabled();
  await expect(page.locator(".guess-pin")).toHaveCount(0);

  const box = await canvas.boundingBox();
  expect(box, "Mapbox must expose a clickable canvas").not.toBeNull();
  await page.mouse.click(
    box!.x + box!.width * offset.x,
    box!.y + box!.height * offset.y,
  );

  const marker = page.locator(".guess-pin");
  await expect(marker).toHaveCount(1);
  await expect(marker).toBeVisible();
  await expect(marker).toHaveText(labels.initial);
  await expect(marker).toHaveAttribute("aria-label", new RegExp(labels.nickname));
  await expect(marker).toHaveAttribute("role", "img");
  const markerColor = await marker.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--player-marker-color").trim(),
  );

  const confirm = page.getByRole("button", { name: labels.confirm });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  return markerColor;
}

async function gameState(page: Page, gameId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/games/${encodeURIComponent(id)}/state`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Game state request failed with ${response.status}`);
    return response.json() as Promise<GameStateSnapshot>;
  }, gameId);
}

test("two isolated players finish all ten private-lobby rounds and reconnect", async ({ browser }) => {
  test.setTimeout(120_000);

  expect(
    await localSupabaseIsHealthy(),
    `Local Supabase must be running and healthy at ${LOCAL_SUPABASE_URL}. Run \`npm run db:start\` first.`,
  ).toBe(true);
  expect(
    runLocalSql("select 1;"),
    `The private-lobby E2E test needs the local database at ${LOCAL_DATABASE_URL}.`,
  ).toBe("1");

  let hostContext: BrowserContext | undefined;
  let guestContext: BrowserContext | undefined;

  try {
    hostContext = await browser.newContext({
      locale: "de-DE",
      viewport: { width: 1280, height: 800 },
    });
    guestContext = await browser.newContext({
      locale: "en-US",
      viewport: { width: 390, height: 844 },
    });
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    const { code, gameId, settings } = await test.step("host creates a private lobby", () =>
      createLobby(host),
    );
    await test.step("guest joins with a separate anonymous session", () =>
      joinLobby(guest, code),
    );

    await test.step("both lobby views converge on the canonical player list", async () => {
      await expect(host.getByText("2 von 8", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(guest.getByText("2 of 8", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(host.getByText("Guest Scout", { exact: true })).toBeVisible();
      await expect(guest.getByText("Host Hunter", { exact: true })).toBeVisible();
      await expect(host.getByRole("button", { name: "Jagd starten" })).toBeEnabled();
      await expect(guest.getByRole("button", { name: "Start the hunt" })).toHaveCount(0);
    });

    await test.step("only the host starts and both players reach round one", async () => {
      await host.getByRole("button", { name: "Jagd starten" }).click();

      await expect(host).toHaveURL(new RegExp(`/de/game/${gameId}$`));
      await expect(guest).toHaveURL(new RegExp(`/en/game/${gameId}$`), { timeout: 15_000 });
      await expect(host.getByText(/Private lobby/i)).toHaveText(/Private lobby/i);
      await expect(guest.getByText(/Private lobby/i)).toHaveText(/Private lobby/i);
      await expect(host.locator(".game-round-label strong")).toContainText("1/10");
      await expect(guest.locator(".game-round-label strong")).toContainText("1/10");
    });

    let stableHostMarkerColor = "";
    let stableGuestMarkerColor = "";

    for (let round = 1; round <= 10; round += 1) {
      await test.step(`both players confirm a map guess in round ${round}`, async () => {
        await expect(host.locator(".game-round-label strong")).toContainText(`${round}/10`);
        await expect(guest.locator(".game-round-label strong")).toContainText(`${round}/10`);

        const [hostSelectionColor, guestSelectionColor] = await Promise.all([
          placeAndConfirmGuess(
            host,
            {
              confirm: "Antwort bestätigen",
              initial: "H",
              map: "Interaktive Karte von Roadhunt",
              nickname: "Host Hunter",
              selectFirst: "Erst Marker setzen",
            },
            { x: 0.47, y: 0.51 },
          ),
          placeAndConfirmGuess(
            guest,
            {
              confirm: "Confirm answer",
              initial: "G",
              map: "Interactive Roadhunt map",
              nickname: "Guest Scout",
              selectFirst: "Place a marker first",
            },
            { x: 0.56, y: 0.46 },
          ),
        ]);
        if (round === 1) {
          stableHostMarkerColor = hostSelectionColor;
          stableGuestMarkerColor = guestSelectionColor;
          expect(stableHostMarkerColor).not.toBe(stableGuestMarkerColor);
        } else {
          expect(hostSelectionColor).toBe(stableHostMarkerColor);
          expect(guestSelectionColor).toBe(stableGuestMarkerColor);
        }

        await expect
          .poll(() => holdCurrentReveal(gameId), {
            message: `Round ${round} never entered the revealing state after both guesses`,
            timeout: 10_000,
          })
          .toBe(String(round));
      });

      await test.step(`round ${round} reveal is synchronized`, async () => {
        await expect(host.getByText("Rundenergebnis", { exact: true })).toBeVisible();
        await expect(guest.getByText("Round result", { exact: true })).toBeVisible();
        await expect(host.locator(".reveal-banner")).toBeVisible();
        await expect(guest.locator(".reveal-banner")).toBeVisible();

        const targetStreet = (await host.locator(".reveal-banner strong").textContent())?.trim();
        expect(targetStreet).toBeTruthy();
        await expect(guest.locator(".reveal-banner strong")).toHaveText(targetStreet!);

        for (const page of [host, guest]) {
          await expect(page.locator(".round-player-results li")).toHaveCount(2);
          await expect(page.locator(".round-player-results").getByText("Host Hunter", { exact: true })).toBeVisible();
          await expect(page.locator(".round-player-results").getByText("Guest Scout", { exact: true })).toBeVisible();
          await expect(page.locator(".result-pin")).toHaveCount(2);
          const hostMarker = page.locator(".result-pin").filter({ hasText: "H" });
          const guestMarker = page.locator(".result-pin").filter({ hasText: "G" });
          await expect(hostMarker).toHaveText("H");
          await expect(guestMarker).toHaveText("G");
          await expect(hostMarker).toHaveAttribute("aria-label", /Host Hunter/);
          await expect(guestMarker).toHaveAttribute("aria-label", /Guest Scout/);
          await expect(hostMarker).toHaveAttribute("role", "img");
          await expect(guestMarker).toHaveAttribute("role", "img");
          expect(await hostMarker.evaluate((element) =>
            getComputedStyle(element).getPropertyValue("--player-marker-color").trim(),
          )).toBe(stableHostMarkerColor);
          expect(await guestMarker.evaluate((element) =>
            getComputedStyle(element).getPropertyValue("--player-marker-color").trim(),
          )).toBe(stableGuestMarkerColor);
        }

        if (round === 5) {
          await guest.reload({ waitUntil: "domcontentloaded" });
          await expect(guest).toHaveURL(new RegExp(`/en/game/${gameId}$`));
          await expect(guest.locator(".game-round-label strong")).toContainText("5/10");
          await expect(guest.getByText("Round result", { exact: true })).toBeVisible();
          await expect(guest.locator(".reveal-banner strong")).toHaveText(targetStreet!);
          await expect(guest.locator(".round-player-results li")).toHaveCount(2);
          await expect(guest.locator(".result-pin")).toHaveCount(2, { timeout: 20_000 });
        }
      });

      await test.step(`round ${round} advances without a five-second wall-clock wait`, async () => {
        const expectedDatabaseState = round < 10 ? `${round + 1}|playing` : "10|finished";
        expect(advancePastReveal(gameId)).toBe(expectedDatabaseState);

        if (round < 10) {
          await expect(host.locator(".game-round-label strong")).toContainText(`${round + 1}/10`);
          await expect(guest.locator(".game-round-label strong")).toContainText(`${round + 1}/10`);
          await expect(host.getByRole("button", { name: "Erst Marker setzen" })).toBeDisabled();
          await expect(guest.getByRole("button", { name: "Place a marker first" })).toBeDisabled();
        }
      });
    }

    await test.step("both players receive the final result and podium", async () => {
      await expect(host.getByRole("heading", { name: "Jagd beendet!" })).toBeVisible();
      await expect(guest.getByRole("heading", { name: "Hunt complete!" })).toBeVisible();
      await expect(host.getByLabel("Siegerpodest")).toBeVisible();
      await expect(guest.getByLabel("Winner podium")).toBeVisible();

      for (const page of [host, guest]) {
        await expect(page.locator(".podium-place")).toHaveCount(2);
        await expect(page.locator(".final-ranking li")).toHaveCount(2);
        await expect(page.locator(".final-ranking").getByText("Host Hunter", { exact: true })).toBeVisible();
        await expect(page.locator(".final-ranking").getByText("Guest Scout", { exact: true })).toBeVisible();
      }

      const [hostState, guestState] = await Promise.all([
        gameState(host, gameId),
        gameState(guest, gameId),
      ]);
      for (const state of [hostState, guestState]) {
        expect(state.status).toBe("finished");
        expect(state.roundNumber).toBe(10);
        expect(state.revealedRounds).toHaveLength(10);
        expect(state.revealedRounds.map((revealedRound) => revealedRound.number)).toEqual([
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
        ]);
        for (const revealedRound of state.revealedRounds) {
          expect(revealedRound.guesses).toHaveLength(2);
          expect(revealedRound.guesses.every((guess) => guess.position !== null)).toBe(true);
        }
      }
    });

    await test.step("both players request the same idempotent rematch lobby", async () => {
      const originalState = await gameState(host, gameId);

      await Promise.all([
        host.getByRole("button", { name: "Revanche starten" }).click(),
        guest.getByRole("button", { name: "Start rematch" }).click(),
      ]);

      await expect(host).toHaveURL(
        /\/de\/lobby\/[2-9A-HJKMNP-Z]{6}\?game=[0-9a-f-]{36}$/,
        { timeout: 15_000 },
      );
      await expect(guest).toHaveURL(
        /\/en\/lobby\/[2-9A-HJKMNP-Z]{6}\?game=[0-9a-f-]{36}$/,
        { timeout: 15_000 },
      );

      const hostRematchUrl = new URL(host.url());
      const guestRematchUrl = new URL(guest.url());
      const rematchCode = hostRematchUrl.pathname.split("/").at(-1) ?? "";
      const rematchGameId = hostRematchUrl.searchParams.get("game") ?? "";

      expect(rematchCode).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
      expect(rematchGameId).toMatch(/^[0-9a-f-]{36}$/);
      expect(rematchCode).not.toBe(code);
      expect(rematchGameId).not.toBe(gameId);
      expect(guestRematchUrl.pathname.split("/").at(-1)).toBe(rematchCode);
      expect(guestRematchUrl.searchParams.get("game")).toBe(rematchGameId);

      await expect(host.getByRole("heading", { name: "Deine Lobby" })).toBeVisible();
      await expect(guest.getByRole("heading", { name: "Your lobby" })).toBeVisible();
      await expect(host.locator(".lobby-subtitle")).toHaveText(settings);
      await expect(host.getByText("2 von 8", { exact: true })).toBeVisible();
      await expect(guest.getByText("2 of 8", { exact: true })).toBeVisible();

      for (const page of [host, guest]) {
        await expect(page.locator(".lobby-player-list").getByText("Host Hunter", { exact: true })).toBeVisible();
        await expect(page.locator(".lobby-player-list").getByText("Guest Scout", { exact: true })).toBeVisible();
        await expect(page.locator(".lobby-player-list .lobby-player")).toHaveCount(2);
      }

      await expect(host.getByRole("button", { name: "Jagd starten" })).toBeEnabled();
      await expect(guest.getByRole("button", { name: "Start the hunt" })).toHaveCount(0);

      const [hostRematchState, guestRematchState] = await Promise.all([
        gameState(host, rematchGameId),
        gameState(guest, rematchGameId),
      ]);
      for (const state of [hostRematchState, guestRematchState]) {
        expect(state.id).toBe(rematchGameId);
        expect(state.lobbyCode).toBe(rematchCode);
        expect(state.status).toBe("waiting");
        expect(state.city.slug).toBe(originalState.city.slug);
        expect(state.difficulty).toBe(originalState.difficulty);
        expect(state.players.map((player) => player.nickname).sort()).toEqual([
          "Guest Scout",
          "Host Hunter",
        ]);
        expect(state.players.filter((player) => player.isHost).map((player) => player.nickname)).toEqual([
          "Host Hunter",
        ]);
      }
      expect(hostRematchState.viewerIsHost).toBe(true);
      expect(guestRematchState.viewerIsHost).toBe(false);
    });
  } finally {
    await Promise.all([hostContext?.close(), guestContext?.close()]);
  }
});
