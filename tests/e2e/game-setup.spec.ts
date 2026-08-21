import { expect, test } from "@playwright/test";

test.use({ locale: "de-DE", viewport: { width: 390, height: 844 } });

type DifficultyCounts = { easy: number; medium: number; hard: number; insane: number };

function city(slug: string, name: string, difficultyCounts: DifficultyCounts) {
  const adminArea = slug === "munich"
    ? { stateName: "Bayern", districtName: "München", code: "09162000" }
    : slug === "slowtown"
      ? { stateName: "Testland", districtName: null, code: "00000001" }
      : {
          stateName: "Nordrhein-Westfalen",
          districtName: "Städteregion Aachen",
          code: "05334002",
        };
  return {
    id: crypto.randomUUID(),
    slug,
    name,
    countryCode: "DE",
    center: [6.0839, 50.7753],
    bounds: [5.974, 50.662, 6.218, 50.864],
    difficultyCounts,
    settlementType: "city",
    population: 100_000,
    featured: false,
    adminArea,
  };
}

const allAvailable = { easy: 12, medium: 12, hard: 12, insane: 12 };

test("mobile city search is debounced, race-safe, accessible, and keeps its selection", async ({ page }) => {
  const requestedQueries: string[] = [];

  await page.route("**/api/catalog/cities?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    requestedQueries.push(query);

    if (query === "slow") {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ cities: [city("slowtown", "Slowtown", allAvailable)] }),
      });
      return;
    }
    if (query === "berlin") {
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return;
    }

    const cities = query === "munchen"
      ? [city("munich", "München", allAvailable)]
      : query === "aachen"
        ? [city("aachen", "Aachen", { easy: 14, medium: 9, hard: 4, insane: 0 })]
        : [];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ cities }),
    });
  });

  await page.goto("/de/play?mode=solo");

  const cityGroup = page.getByRole("radiogroup", { name: "Stadt wählen" });
  const cityOptions = cityGroup.getByRole("radio");
  await expect(cityOptions).toHaveCount(12);
  await expect(cityOptions).toHaveText([
    "Berlin",
    "Hamburg",
    "München",
    "Köln",
    "Frankfurt am Main",
    /DüsseldorfAusgewählt/,
    "Stuttgart",
    "Leipzig",
    "Solingen",
    "Duisburg",
    "Moers",
    "Wuppertal",
  ]);

  const berlin = cityGroup.getByRole("radio", { name: "Berlin", exact: true });
  await berlin.click();
  await expect(berlin).toHaveAttribute("aria-checked", "true");

  const difficultyGroup = page.getByRole("radiogroup", { name: "Schwierigkeit" });
  const hard = difficultyGroup.getByRole("radio", { name: /^Hard/ });
  await hard.click();
  await expect(hard).toHaveAttribute("aria-checked", "true");

  const search = page.getByRole("searchbox", { name: "Stadt suchen" });
  await search.fill("m");
  await search.fill("munch");
  await search.fill("munchen");
  await expect(page.getByRole("status")).toContainText("Städte werden gesucht");
  await expect(cityOptions).toHaveCount(1);
  await expect(cityOptions.first()).toContainText("München");
  expect(requestedQueries).toEqual(["munchen"]);

  await search.fill("slow");
  await expect.poll(() => requestedQueries).toContain("slow");
  await search.fill("aachen");
  await expect(cityOptions).toHaveCount(1);
  await expect(cityOptions.first()).toContainText("Aachen");
  await expect(cityOptions.first().locator(".city-disambiguator")).toHaveText(
    "Städteregion Aachen · Nordrhein-Westfalen",
  );

  await cityOptions.first().click();
  await expect(difficultyGroup.getByRole("radio", { name: /^Easy/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(difficultyGroup.getByRole("radio", { name: /^Medium/ })).toBeDisabled();
  await expect(difficultyGroup.getByRole("radio", { name: /^Hard/ })).toBeDisabled();

  await search.clear();
  await expect(cityOptions).toHaveCount(12);
  await expect(page.locator(".selected-location")).toContainText("Aachen · Easy");
  await page.waitForTimeout(750);
  await expect(cityOptions).toHaveCount(12);
  await expect(page.locator(".selected-location")).toContainText("Aachen · Easy");

  await search.fill("berlin");
  await expect(page.locator("#city-search-feedback")).toContainText(
    "Städtesuche ist gerade nicht erreichbar",
  );
  await expect(cityOptions).toHaveCount(12);
  await expect(cityOptions.first()).toContainText("Berlin");
  await expect(page.locator(".selected-location")).toContainText("Aachen · Easy");

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("city search endpoint is bounded, secret-free, and validates requests", async ({ request }) => {
  const [featuredResponse, searchResponse, localeResponse, limitResponse, queryResponse] = await Promise.all([
    request.get("/api/catalog/cities?locale=de&limit=12"),
    request.get("/api/catalog/cities?locale=de&q=berlin&limit=12"),
    request.get("/api/catalog/cities?locale=fr&q=berlin&limit=12"),
    request.get("/api/catalog/cities?locale=de&q=berlin&limit=13"),
    request.get(`/api/catalog/cities?locale=de&q=${"a".repeat(81)}&limit=12`),
  ]);

  expect(featuredResponse.status()).toBe(200);
  expect(searchResponse.status()).toBe(200);
  expect(featuredResponse.headers()["cache-control"]).toBe(
    "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  );
  expect(localeResponse.headers()["cache-control"]).toBe("no-store");
  const featured = await featuredResponse.json();
  const searchResult = await searchResponse.json();
  expect(featured.cities).toHaveLength(12);
  expect(searchResult.cities.length).toBeGreaterThan(0);
  expect(searchResult.cities.length).toBeLessThanOrEqual(12);
  const berlin = searchResult.cities.find((candidate: { slug?: unknown }) =>
    candidate.slug === "berlin"
  );
  expect(berlin).toMatchObject({ slug: "berlin", name: "Berlin" });
  expect(berlin.adminArea.stateName).toEqual(expect.any(String));
  expect(berlin.adminArea.code).toMatch(/^(?:\d{8}|osm-r\d+)$/);
  expect(Object.keys(berlin).sort()).toEqual([
    "adminArea",
    "bounds",
    "center",
    "countryCode",
    "difficultyCounts",
    "featured",
    "id",
    "name",
    "population",
    "settlementType",
    "slug",
  ]);
  expect(localeResponse.status()).toBe(400);
  expect(limitResponse.status()).toBe(400);
  expect(queryResponse.status()).toBe(400);
});
