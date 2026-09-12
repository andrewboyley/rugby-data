import { expect, test } from "@playwright/test";

type CameraState = { x: number; y: number; ratio: number };
type GridMetrics = {
  origin: { x: number; y: number };
  cell: { width: number; height: number };
  extent: { width: number; height: number };
};

const emptyDataset = { games: [], players: {}, teams: {} };

async function openMainGraph(page: import("@playwright/test").Page) {
  await page.route("**/data/dataset.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(emptyDataset) }));
  await page.goto("/#dataset=/data/dataset.json");
  await expect(page.getByTestId("main-graph")).toBeVisible();
  await expect(page.locator('[data-testid="main-graph"] canvas').first()).toBeVisible({ timeout: 30_000 });
}

async function cameraState(graph: import("@playwright/test").Locator): Promise<CameraState> {
  return JSON.parse((await graph.getAttribute("data-camera-state")) ?? "{}");
}

async function gridMetrics(canvas: import("@playwright/test").Locator): Promise<GridMetrics> {
  return canvas.evaluate((element) => ({
    origin: JSON.parse(element.dataset.gridOrigin ?? "{}"),
    cell: JSON.parse(element.dataset.gridCellSize ?? "{}"),
    extent: JSON.parse(element.dataset.gridExtent ?? "{}"),
  }));
}

async function dragGraph(
  page: import("@playwright/test").Page,
  box: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await page.mouse.up();
}

test("main graph controls are accessible and grid is wired", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await openMainGraph(page);

  const autoFit = page.getByRole("checkbox", { name: "Auto-fit" });
  const grid = page.getByRole("checkbox", { name: "Grid" });
  const trails = page.getByRole("checkbox", { name: "Trails" });
  await expect(page.getByPlaceholder("Search players, matches, teams…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fit graph" })).toBeHidden();
  await expect(autoFit).toBeChecked();
  await expect(grid).toBeChecked();
  await expect(trails).toBeVisible();

  await grid.uncheck();
  await expect(grid).not.toBeChecked();
  await expect(page.getByTestId("main-graph")).toHaveAttribute("data-grid-enabled", "false");
  await grid.check();
  await expect(page.getByTestId("main-graph")).toHaveAttribute("data-grid-enabled", "true");

  await expect(errors.filter((error) => !error.includes("Failed to load resource: the server responded with a status of 404"))).toEqual([]);
});

test("Escape dismisses unified search results", async ({ page }) => {
  await openMainGraph(page);
  const search = page.getByPlaceholder("Search players, matches, teams…");
  const results = page.getByTestId("unified-search-results");

  await search.fill("Ireland");
  await expect(results).toBeVisible();
  await search.press("Escape");
  await expect(results).toBeHidden();
  await expect(search).not.toBeFocused();
});

test("main grid remains centered, square, and proportional through camera input", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await openMainGraph(page);
  const graph = page.getByTestId("main-graph");
  const gridCanvas = graph.locator("canvas").first();
  await expect(graph).toHaveAttribute("data-node-count", "0");
  await expect(graph).toHaveAttribute("data-edge-count", "0");
  await expect(graph).toHaveAttribute("data-camera-state", '{"x":0.5,"y":0.5,"angle":0,"ratio":1}');

  const beforeResize = await graph.evaluate((element) => {
    const canvas = element.querySelector("canvas");
    return { width: canvas?.width, height: canvas?.height };
  });
  await page.setViewportSize({ width: 1024, height: 720 });
  await expect.poll(() => graph.evaluate((element) => {
    const canvas = element.querySelector("canvas");
    return { width: canvas?.width, height: canvas?.height };
  })).not.toEqual(beforeResize);

  const box = await graph.boundingBox();
  expect(box).not.toBeNull();
  await expect(gridCanvas).toHaveAttribute("data-grid-origin", /./);
  const initialGrid = await gridMetrics(gridCanvas);
  expect(initialGrid.origin.x).toBeCloseTo(box!.width / 2, 0);
  expect(initialGrid.origin.y).toBeCloseTo(box!.height / 2, 0);
  expect(initialGrid.cell.width).toBeCloseTo(initialGrid.cell.height, 3);
  expect(Math.min(initialGrid.extent.width, initialGrid.extent.height)).toBeCloseTo(200, 3);

  const beforeWheel = await cameraState(graph);
  const gridBeforeWheel = await gridCanvas.evaluate((canvas) => canvas.toDataURL());
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -500);
  await expect.poll(() => cameraState(graph)).not.toEqual(beforeWheel);
  await expect.poll(() => gridCanvas.evaluate((canvas) => canvas.toDataURL())).not.toBe(gridBeforeWheel);

  const afterWheel = await cameraState(graph);
  const gridAfterWheel = await gridMetrics(gridCanvas);
  expect(Math.min(gridAfterWheel.extent.width, gridAfterWheel.extent.height)).toBeLessThan(200);
  const beforeFirstDrag = await gridMetrics(gridCanvas);
  await dragGraph(page, box!, 80, 40);
  await expect.poll(() => cameraState(graph)).not.toEqual(afterWheel);
  const afterFirstDrag = await cameraState(graph);
  const afterFirstGrid = await gridMetrics(gridCanvas);
  expect(afterFirstDrag.x).toBeLessThan(afterWheel.x);
  expect(afterFirstDrag.y).toBeGreaterThan(afterWheel.y);
  expect(Math.abs(afterFirstGrid.origin.x - beforeFirstDrag.origin.x - 80)).toBeLessThan(2);
  expect(Math.abs(afterFirstGrid.origin.y - beforeFirstDrag.origin.y - 40)).toBeLessThan(2);

  const beforeSecondDrag = await gridMetrics(gridCanvas);
  await dragGraph(page, box!, 80, 40);
  const afterSecondGrid = await gridMetrics(gridCanvas);
  expect(Math.abs(afterSecondGrid.origin.x - beforeSecondDrag.origin.x - 80)).toBeLessThan(2);
  expect(Math.abs(afterSecondGrid.origin.y - beforeSecondDrag.origin.y - 40)).toBeLessThan(2);

  await page.getByRole("button", { name: "Home" }).click();
  await page.waitForTimeout(75);
  await expect.poll(() => cameraState(graph)).not.toEqual(beforeWheel);
  await expect(graph).toHaveAttribute("data-camera-state", '{"x":0.5,"y":0.5,"angle":0,"ratio":1}');
  const homeGrid = await gridMetrics(gridCanvas);
  expect(homeGrid.origin.x).toBeCloseTo(box!.width / 2, 0);
  expect(homeGrid.origin.y).toBeCloseTo(box!.height / 2, 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => gridMetrics(gridCanvas)).not.toEqual(homeGrid);
  const narrowBox = await graph.boundingBox();
  expect(narrowBox).not.toBeNull();
  const narrowGrid = await gridMetrics(gridCanvas);
  expect(narrowGrid.origin.x).toBeCloseTo(narrowBox!.width / 2, 0);
  expect(narrowGrid.origin.y).toBeCloseTo(narrowBox!.height / 2, 0);
  expect(narrowGrid.cell.width).toBeCloseTo(narrowGrid.cell.height, 3);
  expect(Math.min(narrowGrid.extent.width, narrowGrid.extent.height)).toBeCloseTo(200, 3);

  await expect(errors.filter((error) => !error.includes("Failed to load resource: the server responded with a status of 404"))).toEqual([]);
});

test("main graph input changes the camera and disables auto-fit without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await openMainGraph(page);
  const graph = page.getByTestId("main-graph");
  const autoFit = page.getByRole("checkbox", { name: "Auto-fit" });
  const before = await graph.getAttribute("data-camera-state");

  const box = await graph.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -500);
  await expect(autoFit).not.toBeChecked();
  await expect(graph).not.toHaveAttribute("data-camera-state", before ?? "");

  const afterWheel = await graph.getAttribute("data-camera-state");
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2 + 40);
  await page.mouse.up();
  await expect(graph).not.toHaveAttribute("data-camera-state", afterWheel ?? "");

  await page.getByRole("button", { name: "Home" }).click();
  await expect(graph).toHaveAttribute("data-camera-state", before ?? "");

  await expect(errors.filter((error) => !error.includes("Failed to load resource: the server responded with a status of 404"))).toEqual([]);
});

test("timeline is unavailable when the graph has no matches", async ({ page }) => {
  await openMainGraph(page);
  const toggle = page.getByRole("button", { name: "Timeline", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeDisabled();
  await expect(page.getByTestId("timeline-panel")).toBeHidden();
});
