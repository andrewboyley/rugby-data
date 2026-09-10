import { expect, test } from "@playwright/test";

test("Sigma v4 compatibility spike supports renderer APIs and cleanup", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/sigma-v4-spike");
  await expect(page.getByTestId("sigma-v4-spike")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1);

  const selected = await page.evaluate(() => {
    const compatibility = window.__sigmaV4Compatibility;
    if (!compatibility) throw new Error("Sigma v4 compatibility harness is unavailable.");
    return compatibility;
  });
  expect(selected).toBeTruthy();

  const first = await page.evaluate(() => window.__sigmaV4Compatibility?.nodeViewport("first"));
  expect(first).toBeTruthy();
  await page.mouse.click(first!.x, first!.y);
  await expect.poll(() => page.evaluate(() => window.__sigmaV4Compatibility?.selected())).not.toBeNull();
  expect(await page.evaluate(() => {
    const compatibility = window.__sigmaV4Compatibility;
    const node = compatibility?.selected();
    return node ? compatibility.state(node).selected : false;
  })).toBe(true);

  await page.evaluate(() => window.__sigmaV4Compatibility?.dispose());
  expect(await page.evaluate(() => sessionStorage.getItem("sigma-v4-spike-disposed"))).toBe("true");
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(errors.filter((error) => /sigma|webgl/i.test(error))).toEqual([]);
});
