import { expect, test } from "@playwright/test";

async function openMainGraph(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByTestId("main-graph")).toBeVisible();
  await expect(page.locator('[data-testid="main-graph"] canvas').first()).toBeVisible({ timeout: 30_000 });
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

test("Given the main page loads, When the graph is ready, Then it contains useful initial population", async ({ page }) => {
  await openMainGraph(page);

  await expect(page.getByTestId("main-graph")).toHaveAttribute("data-node-count", /[1-9]/);
  await expect(page.getByTestId("main-graph")).toHaveAttribute("data-edge-count", /[1-9]/);
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

  await page.getByRole("button", { name: "Fit graph" }).click();
  await expect(autoFit).toBeChecked();
  await expect(errors.filter((error) => !error.includes("Failed to load resource: the server responded with a status of 404"))).toEqual([]);
});

test("header timeline toggle opens and closes the timeline", async ({ page }) => {
  await openMainGraph(page);
  const toggle = page.getByRole("button", { name: "Timeline", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("timeline-panel")).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId("timeline-panel")).toBeHidden();
});
