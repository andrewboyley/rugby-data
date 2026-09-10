import { expect, test } from "@playwright/test";
import type { TestBenchState } from "../src/test-bench";

const fixture = {
  games: [
    { eventId: 1, date: "2020-01-01T12:00:00Z", competitors: [{ teamId: 1, score: 20, roster: [{ playerId: 1 }, { playerId: 2 }] }, { teamId: 2, score: 10, roster: [{ playerId: 3 }, { playerId: 4 }] }] },
    { eventId: 2, date: "2020-01-07T12:00:00Z", competitors: [{ teamId: 1, score: 8, roster: [{ playerId: 1 }, { playerId: 2 }, { playerId: 3 }] }, { teamId: 2, score: 7, roster: [{ playerId: 4 }, { playerId: 5 }, { playerId: 6 }] }] },
  ],
  players: { "1": "One", "2": "Two", "3": "Three", "4": "Four", "5": "Five", "6": "Six" },
  teams: { "1": "One", "2": "Two" },
};

async function testBenchState(page: import("@playwright/test").Page): Promise<TestBenchState> {
  const state = await page.evaluate(() => window.__rugbyTestBench?.state() ?? null);
  expect(state).not.toBeNull();
  if (state === null) throw new Error("The development test bench is unavailable.");
  return state;
}

async function openTemporal(page: import("@playwright/test").Page) {
  await page.route("**/data/dataset.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture) }));
  await page.goto("/");
  await expect(page.getByTestId("main-graph")).toBeVisible();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByTestId("timeline-panel")).toBeVisible();
}

test.describe("End-user acceptance: temporal viewer", () => {
  test("a visitor sees a usable graph without a legacy graph request or page errors", async ({ page }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    await page.route("**/data/dataset.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture) }));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Rugby co-occurrence graph" })).toBeVisible();
    await expect(page.getByTestId("main-graph")).toBeVisible();
    await expect(page.locator('[data-testid="main-graph"] canvas').first()).toBeVisible();
    expect(requests.some((url) => url.endsWith("/data/graph.json"))).toBe(false);
    expect(errors).toEqual([]);
  });

  test("a visitor can open and close the timeline without losing the graph", async ({ page }) => {
    await openTemporal(page);
    const toggle = page.getByRole("button", { name: "Timeline", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("timeline-panel")).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId("timeline-panel")).toBeHidden();
    await expect(page.getByTestId("main-graph")).toBeVisible();
  });

  test("a visitor can move from the first date to the last date and back", async ({ page }) => {
    await openTemporal(page);
    const graph = page.getByTestId("main-graph");
    const slider = page.getByRole("slider", { name: "Timeline date" });
     await expect(graph).toHaveAttribute("data-node-count", "6");
    await slider.press("End");
    await expect(graph).toHaveAttribute("data-node-count", "6");
    await expect(graph).toHaveAttribute("data-edge-count", "7");
    await expect(page.getByTestId("timeline-label")).toHaveText("2020-01-07");
    await slider.press("Home");
     await expect(graph).toHaveAttribute("data-node-count", "6");
    await expect(graph).toHaveAttribute("data-edge-count", "2");
    await expect(page.getByTestId("timeline-label")).toHaveText("2020-01-01");
  });

  test("a visitor can choose a full initial timeline and return to an empty one", async ({ page }) => {
    await openTemporal(page);
    const graph = page.getByTestId("main-graph");
    const position = page.getByLabel("Initial timeline position");
    await position.selectOption("max");
    await expect(graph).toHaveAttribute("data-node-count", "6");
    await expect(graph).toHaveAttribute("data-edge-count", "7");
    await position.selectOption("min");
    await expect(graph).toHaveAttribute("data-node-count", "0");
  });

  test("a visitor can play, pause, change speed, and reach the timeline endpoint", async ({ page }) => {
    await openTemporal(page);
    await page.getByLabel("Timeline speed").selectOption("4");
    await page.getByRole("slider", { name: "Timeline date" }).press("Home");
    await page.getByRole("button", { name: "Play" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(page.getByTestId("timeline-label")).toHaveText("2020-01-07", { timeout: 2_000 });
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  });

  test("a visitor can change graph visibility controls and recover framing", async ({ page }) => {
    await openTemporal(page);
    const graph = page.getByTestId("main-graph");
    await page.getByRole("checkbox", { name: "Grid" }).uncheck();
    await expect(graph).toHaveAttribute("data-grid-enabled", "false");
    await page.getByRole("checkbox", { name: "Trails" }).check();
    await expect(graph).toHaveAttribute("data-trails-enabled", "true");
    await page.getByRole("checkbox", { name: "Auto-fit" }).uncheck();
    await expect(page.getByRole("checkbox", { name: "Auto-fit" })).not.toBeChecked();
    await page.getByRole("button", { name: "Fit graph" }).click();
    await expect(page.getByRole("checkbox", { name: "Auto-fit" })).toBeChecked();
  });

  test("a visitor can filter by team and minimum matches, then focus a player neighborhood", async ({ page }) => {
    await openTemporal(page);
    await page.getByRole("slider", { name: "Timeline date" }).press("End");
    await page.getByLabel("Team overlay").selectOption({ index: 1 });
    await page.getByLabel("Minimum shared matches").fill("2");
    await expect(page.getByLabel("Minimum shared matches")).toHaveValue("2");
    await expect(page.locator('[data-testid="main-graph"] canvas').first()).toBeVisible();
    await page.getByLabel("Selected player").selectOption("1");
    await expect(page.getByTestId("partner-overlay")).toContainText("Partners for 1");
    await expect(page.getByTestId("partner-overlay").getByRole("button")).toHaveCount(3);
  });

  test("a narrow-screen visitor can still reach the timeline and graph controls", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 640 });
    await openTemporal(page);
    await expect(page.getByRole("button", { name: "Timeline", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fit graph" })).toBeVisible();
    await expect(page.getByTestId("main-graph")).toBeVisible();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    for (const locator of [page.getByRole("button", { name: "Timeline", exact: true }), page.getByRole("button", { name: "Fit graph" }), page.getByTestId("timeline-panel")]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.getByRole("button", { name: "Play" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  test("a visitor gets a clear recovery message when the dataset cannot be loaded", async ({ page }) => {
    await page.route("**/data/dataset.json", (route) => route.fulfill({ status: 503, body: "unavailable" }));
    await page.goto("/");
    await expect(page.getByText("Could not load temporal dataset:")).toBeVisible();
    await expect(page.getByTestId("main-graph")).toHaveCount(0);
  });
});

test.describe("End-user acceptance: ForceAtlas2 test bench", () => {
  test("a user can generate a graph, change its seed, and reset it", async ({ page }) => {
    await page.goto("/test");
    await expect(page.getByTestId("test-page")).toBeVisible();
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    const before = await page.getByTestId("graph-count").textContent();
    const seed = page.getByTestId("seed");
    await seed.fill("99");
    await expect(page.getByTestId("graph-count")).not.toHaveText(before!);
    await page.getByRole("button", { name: "ForceAtlas2", exact: true }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).last().click();
    await expect(page.getByTestId("start-stop")).toHaveText("Start Layout");
  });

  test("a user can start and stop a layout while the graph remains visible", async ({ page }) => {
    await page.goto("/test");
    await expect(page.getByTestId("test-page")).toBeVisible();
    const start = page.getByTestId("start-stop");
    await start.click();
    await expect(start).toHaveText("Stop Layout");
    await expect(page.locator("canvas").first()).toBeVisible();
    await start.click();
    await expect(start).toHaveText("Start Layout");
  });

  test("a user can start and stop Auto-tune and change its iteration horizon", async ({ page }) => {
    await page.goto("/test");
    await page.getByTestId("autotune-tab").click();
    await expect(page.getByTestId("episode-length")).toBeVisible();
    await page.getByTestId("episode-length").fill("2");
    await expect(page.getByTestId("episode-length")).toHaveValue("2");
    await page.getByTestId("autotune-toggle").click();
    await expect(page.getByTestId("autotune-toggle")).toHaveText("Disable Auto-tune");
    await page.getByRole("button", { name: "ForceAtlas2", exact: true }).click();
    await page.getByTestId("start-stop").click();
    await expect.poll(async () => (await testBenchState(page)).training.session.latestReward, { timeout: 10_000 }).not.toBeNull();
    const scored = await testBenchState(page);
    expect(scored.training.session.latestReward).toEqual(expect.any(Number));
    expect(Number.isFinite(scored.training.session.latestReward)).toBe(true);
    expect(scored.training.scoredTrials).toBeGreaterThan(0);
    await page.getByTestId("start-stop").click();
    await page.getByTestId("autotune-toggle").click();
    await expect(page.getByTestId("autotune-toggle")).toHaveText("Enable Auto-tune");
  });

  test("a user can inspect and safely control the Auto-tune session", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto("/test");
    await page.getByTestId("autotune-tab").click();

    await expect(page.getByRole("heading", { name: "Auto-tune diagnostics" })).toBeVisible();
    expect((await testBenchState(page)).training.session.latestReward).toBeNull();
    await expect(page.getByText("No scored reward yet")).toBeVisible();
    await expect(page.getByText("Current candidate")).toBeVisible();
    await expect(page.getByText("Applied to Live View")).toBeVisible();

    await page.getByRole("button", { name: "Advanced diagnostics" }).click();
    await expect(page.getByText("Per-dimension evidence")).toBeVisible();
    await page.getByText("Reward and calibration interpretation").scrollIntoViewIfNeeded();
    await expect(page.getByText("Reward and calibration interpretation")).toBeVisible();
    await page.getByRole("button", { name: "Advanced diagnostics" }).click();

    const enable = page.getByTestId("autotune-toggle");
    await enable.click();
    await expect(enable).toHaveText("Disable Auto-tune");
    await page.getByTestId("start-stop").evaluate((button) => button.click());
    await expect(page.getByTestId("training-pause")).toHaveText("Pause Training");
    await page.getByTestId("training-pause").click();
    await expect(page.getByTestId("training-pause")).toHaveText("Resume Training");

    const reset = page.getByRole("button", { name: "Reset learned policy" });
    await reset.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).press("Enter");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(reset).toBeFocused();
    await reset.click();
    await page.getByRole("button", { name: "Confirm reset" }).click();
    const resetState = await testBenchState(page);
    expect(resetState.training.session.latestReward).toBeNull();
    expect(resetState.training.scoredTrials).toBe(0);
    expect(resetState.training.session.strictBestApplication).toBeNull();
    await expect(reset).toBeFocused();
  });

  test("a user can distinguish Auto-tune candidates from scored trials while Live View stays independent", async ({ page }) => {
    await page.goto("/test");
    await page.getByTestId("autotune-tab").click();
    await expect(page.getByText("Iterations per trial", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Enable Auto-tune", exact: true }).click();
    await expect(page.getByTestId("start-stop")).toHaveText("Start Layout");
    const ready = await testBenchState(page);
    expect(ready.training.session.autoTune.enabled).toBe(true);
    expect(ready.training.session.execution.state).toBe("idle");

    await page.getByTestId("episode-length").fill("1");
    await page.getByTestId("start-stop").click();
    await expect.poll(async () => {
      const state = await testBenchState(page);
      return state.live.ticks > 0 && (state.training.calibrationSteps > 0 || state.training.scoredTrials > 0);
    }, { timeout: 10_000 }).toBe(true);
    const running = await testBenchState(page);
    expect(running.graph.environmentsDistinct).toBe(true);
    expect(running.graph.liveIdentity).not.toBe(running.graph.trialIdentity);
    await page.getByTestId("autotune-toggle").click();
    expect((await testBenchState(page)).training.session.autoTune.enabled).toBe(false);
    await page.getByRole("button", { name: "Live View", exact: true }).click();
    await expect(page.getByText("Live View")).toBeVisible();
  });

  test("a user can persist manual iterations per tick and cannot edit it during Auto-tune", async ({ page }) => {
    await page.goto("/test");
    const iterations = page.getByTestId("manual-iterations-per-tick");
    await expect(iterations).toHaveValue("1");
    await expect(iterations).toHaveAttribute("max", "3");
    await iterations.fill("3");
    await iterations.press("Tab");
    await expect(iterations).toHaveValue("3");

    await page.reload();
    await expect(page.getByTestId("manual-iterations-per-tick")).toHaveValue("3");
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem("rugby-graph-settings") ?? "{}");
      localStorage.setItem("rugby-graph-settings", JSON.stringify({ ...settings, manualIterationsPerTick: 7 }));
    });
    await page.reload();
    await expect(page.getByTestId("manual-iterations-per-tick")).toHaveValue("3");
    await page.getByTestId("autotune-tab").click();
    await page.getByTestId("autotune-toggle").click();
    await expect(page.getByTestId("manual-iterations-per-tick")).toHaveCount(0);
  });

  test("a user can use the test bench view toggles and return home", async ({ page }) => {
    await page.goto("/test");
    await page.getByRole("checkbox", { name: /Grid/ }).uncheck();
    await page.getByRole("checkbox", { name: /Trails/ }).uncheck();
    await expect(page.getByRole("checkbox", { name: /Grid/ })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Trails/ })).not.toBeChecked();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
