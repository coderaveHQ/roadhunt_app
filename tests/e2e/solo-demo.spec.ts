import { expect, test, type Page } from "@playwright/test";

type DemoScenario = {
  locale: "de" | "en";
  browserLocale: string;
  gameId: string;
  citySlug: "duesseldorf" | "berlin";
  nickname: string;
  viewport: { width: number; height: number };
  labels: {
    confirm: string;
    finished: string;
    map: string;
    result: string;
    selectFirst: string;
  };
};

const scenarios: DemoScenario[] = [
  {
    locale: "de",
    browserLocale: "de-DE",
    gameId: "demo-e2e-de-desktop",
    citySlug: "duesseldorf",
    nickname: "Rheinjäger",
    viewport: { width: 1365, height: 900 },
    labels: {
      confirm: "Antwort bestätigen",
      finished: "Jagd beendet!",
      map: "Interaktive Karte von Roadhunt",
      result: "Rundenergebnis",
      selectFirst: "Erst Marker setzen",
    },
  },
  {
    locale: "en",
    browserLocale: "en-US",
    gameId: "demo-e2e-en-phone",
    citySlug: "berlin",
    nickname: "Street Scout",
    viewport: { width: 390, height: 844 },
    labels: {
      confirm: "Confirm answer",
      finished: "Hunt complete!",
      map: "Interactive Roadhunt map",
      result: "Round result",
      selectFirst: "Place a marker first",
    },
  },
];

async function openDemo(page: Page, scenario: DemoScenario) {
  await page.clock.install({ time: new Date("2026-08-20T12:00:00.000Z") });
  await page.addInitScript(
    ({ gameId, citySlug, nickname }) => {
      window.sessionStorage.setItem(
        `roadhunt:game:${gameId}`,
        JSON.stringify({ citySlug, difficulty: "medium", nickname, mode: "solo" }),
      );
    },
    {
      gameId: scenario.gameId,
      citySlug: scenario.citySlug,
      nickname: scenario.nickname,
    },
  );

  await page.goto(`/${scenario.locale}/game/${scenario.gameId}`);
  await expect(page.getByRole("main")).toHaveClass(/game-page/);
  await expect(page.getByLabel(scenario.labels.map)).toBeVisible();
  await expect(page.locator(".mapboxgl-canvas")).toBeVisible({ timeout: 20_000 });

  const pageTime = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(pageTime + 1_000);
}

async function playAllTenRounds(page: Page, scenario: DemoScenario) {
  const canvas = page.locator(".mapboxgl-canvas");

  for (let round = 1; round <= 10; round += 1) {
    await test.step(`${scenario.locale}: round ${round}`, async () => {
      await expect(page.locator(".game-round-label strong")).toContainText(`${round}/10`);

      const confirmButton = page.getByRole("button", { name: scenario.labels.selectFirst });
      await expect(confirmButton).toBeDisabled();

      const box = await canvas.boundingBox();
      expect(box, "Mapbox must expose a clickable canvas").not.toBeNull();
      await page.mouse.click(box!.x + box!.width * 0.52, box!.y + box!.height * 0.48);

      const readyButton = page.getByRole("button", { name: scenario.labels.confirm });
      await expect(readyButton).toBeEnabled();
      await readyButton.click();

      await expect(page.getByText(scenario.labels.result, { exact: true })).toBeVisible();
      await expect(page.locator(".reveal-banner")).toBeVisible();
      await page.clock.fastForward(5_100);

      if (round < 10) {
        await expect(page.locator(".game-round-label strong")).toContainText(`${round + 1}/10`);
      }
    });
  }

  await expect(page.getByRole("heading", { name: scenario.labels.finished })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Revanche starten|Start rematch/i }),
  ).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("roadhunt:local-bests:v1")),
    )
    .not.toBeNull();
  const storedBest = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("roadhunt:local-bests:v1") ?? "null"),
  );
  expect(storedBest?.version).toBe(1);
  const score = storedBest?.scores?.[`${scenario.citySlug}:medium`]?.score;
  expect(score).toEqual(expect.any(Number));
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(10_000);
}

for (const scenario of scenarios) {
  test.describe(`${scenario.locale} demo at ${scenario.viewport.width}px`, () => {
    test.use({ locale: scenario.browserLocale, viewport: scenario.viewport });

    test("finishes all ten rounds with map guesses and persists the local best", async ({ page }) => {
      await openDemo(page, scenario);

      if (scenario.viewport.width < 500) {
        const hasHorizontalOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        expect(hasHorizontalOverflow).toBe(false);
      }

      await playAllTenRounds(page, scenario);

      if (scenario.viewport.width < 500) {
        const resultsOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        expect(resultsOverflow).toBe(false);
      }
    });
  });
}
