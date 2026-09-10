import { expect, test } from "@playwright/test";

const PRODUCTION_NODES = 3_483;
const PRODUCTION_MATCHES = 300;
const ROSTER_SIZE = 34;

const productionFixture = {
  games: Array.from({ length: PRODUCTION_MATCHES }, (_, game) => ({
    eventId: game + 1,
    date: `2020-${String((game % 12) + 1).padStart(2, "0")}-${String((game % 28) + 1).padStart(2, "0")}T12:00:00Z`,
    competitors: [{ teamId: 39, roster: Array.from({ length: ROSTER_SIZE }, (_, player) => ({ playerId: (game * 97 + player * 131) % PRODUCTION_NODES })) }],
  })),
  players: Object.fromEntries(Array.from({ length: PRODUCTION_NODES }, (_, player) => [String(player), `Player ${player}`])),
  teams: { "39": "Production team" },
};

type Baseline = Record<string, { frameP95Ms: number; frameMaxMs: number }> & {
  loadMs: number;
  longTasks: Array<{ duration: number; startTime: number }>;
};

test.use({ trace: "on" });

test("captures production-shaped temporal viewer baseline", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    const longTasks: Array<{ duration: number; startTime: number }> = [];
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) longTasks.push({ duration: entry.duration, startTime: entry.startTime });
    }).observe({ type: "longtask", buffered: true });
    Object.assign(window, { __temporalBaselineLongTasks: longTasks });
  });
  await page.route("**/data/dataset.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(productionFixture) }));

  const startedAt = Date.now();
  await page.goto("/");
  await expect(page.getByTestId("main-graph")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByTestId("timeline-panel")).toBeVisible();
  const baseline: Baseline = {
    loadMs: Date.now() - startedAt,
    longTasks: [],
  };

  const measureFrames = async (name: string) => {
    baseline[name] = await page.evaluate(async () => {
      const frames: number[] = [];
      let previous = performance.now();
      for (let index = 0; index < 8; index += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = performance.now();
        frames.push(now - previous);
        previous = now;
      }
      const sorted = [...frames].sort((left, right) => left - right);
      return { frameP95Ms: sorted[Math.floor(sorted.length * 0.95)]!, frameMaxMs: sorted.at(-1)! };
    });
  };

  await measureFrames("load");
  const graph = page.getByTestId("main-graph");
  const box = await graph.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2 + 40);
  await page.mouse.up();
  await measureFrames("pan");

  await page.getByLabel("Selected player").selectOption("1");
  await measureFrames("selection");
  await page.getByRole("slider", { name: "Timeline date" }).evaluate((element) => {
    const input = element as HTMLInputElement;
    for (const value of ["1", "10", "50", "100", "299"]) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await measureFrames("rapidScrub");
  await page.getByLabel("Timeline speed").selectOption("4");
  await page.getByRole("button", { name: "Play" }).click();
  await measureFrames("playback");
  if (await page.getByRole("button", { name: "Pause" }).isVisible()) {
    await page.getByRole("button", { name: "Pause" }).click();
  }
  await measureFrames("continuousLayout");

  baseline.longTasks = await page.evaluate(() => (window as Window & { __temporalBaselineLongTasks: Baseline["longTasks"] }).__temporalBaselineLongTasks);
  await testInfo.attach("temporal-baseline.json", { body: JSON.stringify(baseline, null, 2), contentType: "application/json" });
  console.log("TEMPORAL_BASELINE", JSON.stringify(baseline));
  expect(baseline.loadMs).toBeGreaterThan(0);
  expect(Object.keys(baseline)).toEqual(expect.arrayContaining(["load", "pan", "selection", "rapidScrub", "playback", "continuousLayout"]));
});
