import { expect, test } from "@playwright/test";

const fixture = {
  games: [
    { eventId: 1, date: "2020-01-01T12:00:00Z", competitors: [{ teamId: 1, score: 20, roster: [{ playerId: 1 }, { playerId: 2 }] }, { teamId: 2, score: 10, roster: [{ playerId: 3 }, { playerId: 4 }] }] },
    { eventId: 2, date: "2020-01-03T12:00:00Z", competitors: [{ teamId: 1, score: 8, roster: [{ playerId: 1 }, { playerId: 2 }, { playerId: 3 }] }] },
    { eventId: 3, date: "2020-01-10T12:00:00Z", competitors: [{ teamId: 1, score: 12, roster: [{ playerId: 1 }, { playerId: 2 }] }] },
  ],
  players: { "1": "One", "2": "Two", "3": "Three", "4": "Four" }, teams: { "1": "One", "2": "Two" },
};

const productionUiFixture = {
  games: Array.from({ length: 120 }, (_, game) => ({
    eventId: game + 1,
    date: `2020-${String((game % 12) + 1).padStart(2, "0")}-${String((game % 28) + 1).padStart(2, "0")}T12:00:00Z`,
    competitors: [{ teamId: 39, roster: Array.from({ length: 34 }, (_, player) => ({ playerId: (game * 17 + player) % 201 })) }],
  })),
  players: Object.fromEntries(Array.from({ length: 201 }, (_, player) => [String(player), `Player ${player}`])),
  teams: { "39": "Production team" },
};

async function openFixture(page: import("@playwright/test").Page) {
  await page.route("**/data/dataset.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByTestId("timeline-panel")).toBeVisible();
}

test("main page fetches dataset only and timeline controls seek and play", async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForTimeout(1_000);
  expect(errors).toEqual([]);
  expect(await page.locator("body").innerText()).toContain("Rugby co-occurrence graph");
  await expect(page.getByTestId("main-graph")).toBeVisible({ timeout: 30_000 });
  expect(requests.some((url) => url.endsWith("/data/dataset.json"))).toBe(true);
  expect(requests.some((url) => url.endsWith("/data/graph.json"))).toBe(false);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByTestId("timeline-panel")).toBeVisible();
  await page.getByLabel("Minimum shared matches").fill("2");
  await expect(page.getByLabel("Minimum shared matches")).toHaveValue("2");
  await page.getByLabel("Team overlay").selectOption({ index: 1 });
  await page.getByRole("slider", { name: "Timeline date" }).press("Home");
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.getByRole("button", { name: "Fit graph" }).click();
  await page.getByLabel("Trails").check();
  await expect(page.getByTestId("main-graph")).toHaveAttribute("data-trails-enabled", "true");
});

test("Given production-shaped data is routed, When the timeline opens, Then player and match DOM stay bounded", async ({ page }) => {
  await page.route("**/data/dataset.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(productionUiFixture) }));
  await page.goto("/");
  await expect(page.getByTestId("main-graph")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByTestId("timeline-panel")).toBeVisible();

  expect(await page.locator("option").count()).toBeLessThan(200);
  expect(await page.getByTestId("timeline-panel").locator("*").count()).toBeLessThan(1200);
});

test("Given a rendered temporal graph, When dates are entered rapidly, Then camera and layout topology remain stable", async ({ page }) => {
  await openFixture(page);
  const graph = page.getByTestId("main-graph");
  const slider = page.getByRole("slider", { name: "Timeline date" });
  const camera = await graph.getAttribute("data-camera-state");
  const worker = await graph.getAttribute("data-layout-worker-id");
  const reloads = await graph.getAttribute("data-layout-reloads");
  expect(camera).not.toBeNull();

  await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    for (const value of ["1", "2", "1", "2"]) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  expect(await graph.getAttribute("data-camera-state")).toBe(camera);
  expect(await graph.getAttribute("data-layout-worker-id")).toBe(worker);
  expect(await graph.getAttribute("data-layout-reloads")).toBe(reloads);
  expect(await graph.getAttribute("data-seek-requests")).toBe("4");
  expect(await graph.getAttribute("data-seek-applies")).toBe("1");
});

test("timeline range handles use available-date steps and keyboard playback controls", async ({ page }) => {
  await openFixture(page);
  const start = page.getByRole("slider", { name: "Timeline start date" });
  const end = page.getByRole("slider", { name: "Timeline end date" });
  await expect(start).toBeVisible();
  await expect(end).toBeVisible();
  await expect(start).toHaveAttribute("min", "0");
  await expect(start).toHaveAttribute("max", "2");
  await expect(start).toHaveAttribute("step", "1");
  await expect(page.getByRole("group", { name: "Timeline playback" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Filter:");
  await end.press("End");
  await expect(page.getByRole("status")).toContainText("2020-01-10");
  await end.press("ArrowLeft");
  await expect(page.getByRole("status")).toContainText("2020-01-03");
  await end.press("Home");
  await expect(page.getByRole("status")).toContainText("2020-01-01");
  await end.press("End");
  await end.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "false");
});

test("playback stops at the selected end date and filter changes pause it", async ({ page }) => {
  await openFixture(page);
  const end = page.getByRole("slider", { name: "Timeline end date" });
  await page.getByLabel("Timeline speed").selectOption("4");
  await end.press("End");
  await end.press("ArrowLeft");
  await end.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByTestId("timeline-label")).toHaveText("2020-01-03", { timeout: 2_000 });
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(page.getByTestId("timeline-label")).toHaveText("2020-01-03");

  await end.press("End");
  await page.getByLabel("Timeline speed").selectOption("0.25");
  await end.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.getByLabel("Team overlay").selectOption("1");
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
});

test("timeline scrub is reversible, playback speed advances, pause freezes, and endpoint labels update", async ({ page }) => {
  await openFixture(page);
  const graph = page.getByTestId("main-graph");
  const slider = page.getByRole("slider", { name: "Timeline date" });
   await expect(graph).toHaveAttribute("data-node-count", "4");
  await slider.press("End");
  await expect(graph).toHaveAttribute("data-node-count", "4");
  await expect(graph).toHaveAttribute("data-edge-count", "4");
  await expect(page.getByTestId("timeline-label")).toHaveText("2020-01-10");
  const worker = await graph.getAttribute("data-layout-worker-id");
  await slider.press("Home");
  await expect(graph).toHaveAttribute("data-node-count", "4");
  await expect(graph).toHaveAttribute("data-edge-count", "2");
  await slider.press("End");
  await expect(graph).toHaveAttribute("data-layout-worker-id", worker!);
  await page.getByLabel("Timeline speed").selectOption("4");
  await slider.press("Home");
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByTestId("timeline-label")).toHaveText("2020-01-10", { timeout: 3_000 });
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  const frozen = await page.getByTestId("timeline-label").textContent();
  await page.waitForTimeout(250);
  await expect(page.getByTestId("timeline-label")).toHaveText(frozen!);
});

test("initial position UI supports empty dateMin and full dateMax", async ({ page }) => {
  await openFixture(page);
  const graph = page.getByTestId("main-graph");
    await expect(graph).toHaveAttribute("data-node-count", "4");
  const worker = await graph.getAttribute("data-layout-worker-id");
  await page.getByLabel("Initial timeline position").selectOption("max");
  await expect(graph).toHaveAttribute("data-edge-count", "4");
  await expect(page.getByTestId("timeline-label")).toHaveText("2020-01-10");
  await page.getByLabel("Initial timeline position").selectOption("min");
    await expect(graph).toHaveAttribute("data-node-count", "0");
  await expect(graph).toHaveAttribute("data-layout-worker-id", worker!);
});

test("match and partner overlays keep legacy interaction semantics without rebuilding topology", async ({ page }) => {
  await openFixture(page);
  const graph = page.getByTestId("main-graph");
  await page.getByRole("slider", { name: "Timeline date" }).press("End");
  const before = await graph.getAttribute("data-edge-count");
  await page.getByLabel("Selected player").selectOption("1");
  await expect(page.getByTestId("partner-overlay")).toContainText("Partners for 1");
  await page.getByTestId("partner-overlay").getByRole("button", { name: "2" }).click();
  // Match and partner controls are reducer overlays: neither changes topology.
  await page.getByRole("button", { name: "Match 2" }).click();
  await expect(page.getByTestId("match-overlay")).toBeVisible();
  await expect(graph).toHaveAttribute("data-edge-count", before!);
});
