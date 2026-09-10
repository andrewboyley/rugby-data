import { expect, test } from "@playwright/test";
import {
  selectRendererAdapter,
} from "../src/graph/renderer-policy";

test("renderer policy selects the baseline adapter until advanced rendering is verified", () => {
  const baselineRenderer = Symbol("baseline");
  const advancedRenderer = Symbol("advanced");

  expect(selectRendererAdapter({ advancedAdapterVerified: false }, baselineRenderer, advancedRenderer)).toBe(
    baselineRenderer,
  );
  expect(selectRendererAdapter({ advancedAdapterVerified: true }, baselineRenderer, null)).toBe(baselineRenderer);
  expect(selectRendererAdapter({ advancedAdapterVerified: true }, baselineRenderer, advancedRenderer)).toBe(
    advancedRenderer,
  );
});
