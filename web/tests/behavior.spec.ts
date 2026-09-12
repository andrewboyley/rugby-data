import { test, expect } from '@playwright/test';
import type { TestBenchState } from "../src/test-bench";

async function testBenchState(page: import("@playwright/test").Page): Promise<TestBenchState> {
  const state = await page.evaluate(() => window.__rugbyTestBench?.state() ?? null);
  expect(state).not.toBeNull();
  if (state === null) throw new Error("The development test bench is unavailable.");
  return state;
}

test('test page explains how to recover when WebGL2 is unavailable', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId, ...arguments_) {
      if (contextId === 'webgl2') return null;
      return originalGetContext.call(this, contextId, ...arguments_);
    };
  });
  await page.goto('http://localhost:5173/test');

  await expect(page.getByRole('button', { name: 'Graph' })).toBeVisible();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(/WebGL2 is unavailable.*reload the page/i);
  expect(errors).not.toContain('Sigma: WebGL 2 is not supported by your browser.');
});


test('test page renders generated nodes and responds to camera input', async ({ page }) => {
  await page.goto('http://localhost:5173/test');
  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(page.getByTestId('graph-count')).toContainText(/Generated graph: [1-9]\d* nodes/);

  const graph = page.getByTestId('test-graph');
  const bounds = await graph.boundingBox();
  expect(bounds).not.toBeNull();
  const before = JSON.parse((await graph.getAttribute('data-camera-state')) ?? '{}');
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.wheel(0, -500);
  await expect.poll(async () => JSON.parse((await graph.getAttribute('data-camera-state')) ?? '{}')).not.toEqual(before);
  const afterWheel = JSON.parse((await graph.getAttribute('data-camera-state')) ?? '{}');

  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 80, bounds!.y + bounds!.height / 2 + 40);
  await page.mouse.up();
  await expect.poll(async () => JSON.parse((await graph.getAttribute('data-camera-state')) ?? '{}')).not.toEqual(afterWheel);
  const afterDrag = JSON.parse((await graph.getAttribute('data-camera-state')) ?? '{}');
  expect(afterDrag.x).toBeLessThan(afterWheel.x);
  expect(afterDrag.y).toBeGreaterThan(afterWheel.y);
  await expect(page.getByRole('checkbox', { name: 'Auto-fit' })).not.toBeChecked();

  await expect(graph).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(3);
});

test('test page generates, starts, stops, resets, and has no Sigma errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  await page.goto('http://localhost:5173/test');
  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(page.getByTestId('graph-count')).toContainText(/Generated graph: \d+ nodes/);
  await expect(page.locator('canvas')).toHaveCount(3);
  await page.getByRole('button', { name: 'ForceAtlas2' }).click();
  
  // Click Start Layout - this should initiate the force-directed layout
  await page.getByTestId('trails').check();
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('start-stop')).toHaveText('Stop Layout');
  await page.waitForTimeout(250);
  
  await expect.poll(() => page.evaluate(() => {
    const visualState = (window as Window & { __rugbyTestBench?: { visuals: () => { nodes: Array<{ attributes: { color?: string }; display?: { color?: string } }>; edges: Array<{ attributes: { color?: string }; display?: { color?: string } }>; trailSegments: number } } }).__rugbyTestBench?.visuals();
    if (!visualState || !visualState.nodes.length || !visualState.edges.length) return false;
    const rgba = (hex: string) => { const parts = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); return parts ? `rgba(${parseInt(parts[1], 16)},${parseInt(parts[2], 16)},${parseInt(parts[3], 16)},0.9)` : hex; };
    return visualState.nodes.every(({ attributes, display }) => display?.color === attributes.color) && visualState.edges.every(({ attributes, display }) => display?.color === rgba(attributes.color ?? "")) && visualState.trailSegments > 0;
  }), { timeout: 2_000 }).toBe(true);


  const sigmaErrors = errors.filter(e => e.includes('Sigma') || e.includes('Container'));
  console.log('All errors:', errors);
  console.log('Sigma errors:', sigmaErrors);
  
  // The button should change to "Stop Layout" after clicking start
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('start-stop')).toHaveText('Start Layout');
  await page.getByTestId('reset').click();
  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(page.getByTestId('graph-count')).toContainText('Generated graph:');
  
  expect(sigmaErrors.length).toBe(0);
});

test('test page persists graph settings and auto-tune reaches a valid state', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('http://localhost:5173/test');
  await page.getByRole('button', { name: 'Graph' }).click();
  await page.getByTestId('seed').fill('99');
  await expect(page.getByTestId('graph-count')).toContainText('Generated graph:');
  await page.reload();
  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(page.getByTestId('seed')).toHaveValue('99');
  await page.getByTestId('autotune-tab').click();
  await page.getByTestId('autotune-toggle').click();
  await expect(page.getByTestId('autotune-toggle')).toHaveText('Disable Auto-tune');
  await page.getByRole('button', { name: 'ForceAtlas2' }).click();
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('autotune-state')).toContainText(/Calibrating: \d+\/60 steps\. \d+ scored trials\.|Scored trials: \d+\./);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('autotune-state')).toContainText(/Calibrating: \d+\/60 steps\. \d+ scored trials\.|Scored trials: \d+\./);
  await page.getByTestId('start-stop').click();
  expect(errors.filter(error => /Sigma|Container/i.test(error))).toEqual([]);
});

test('graph range drafts do not recreate environments until their debounced commit', async ({ page }) => {
  await page.goto('http://localhost:5173/test');
  await page.getByRole('button', { name: 'Graph' }).click();
  const nodeCount = page.getByTestId('node-count');
  const initialIdentity = (await testBenchState(page)).graph.liveIdentity;

  await nodeCount.evaluate((element) => {
    const input = element as HTMLInputElement;
    for (const value of ['60', '80', '100']) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  expect((await testBenchState(page)).graph.liveIdentity).toBe(initialIdentity);
  await page.waitForTimeout(250);
  expect((await testBenchState(page)).graph.liveIdentity).not.toBe(initialIdentity);
  await expect(page.getByTestId('graph-count')).toContainText('100 nodes');
});

test('iteration horizon and parameter edits safely restart an active test episode', async ({ page }) => {
  await page.goto('http://localhost:5173/test');
  await page.getByTestId('autotune-tab').click();
  await page.getByTestId('autotune-toggle').click();
  await page.getByRole('button', { name: 'ForceAtlas2' }).click();
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('start-stop')).toHaveText('Stop Layout');

  await page.getByTestId('autotune-tab').click();
  await page.getByTestId('episode-length').fill('2');
  await expect(page.getByTestId('episode-length')).toHaveValue('2');
  await page.getByTestId('autotune-toggle').click();
  await page.getByRole('button', { name: 'ForceAtlas2' }).click();
  const gravity = page.getByText('Gravity').locator('..');
  await gravity.getByRole('slider').fill('0.2');
  await expect(page.getByTestId('start-stop')).toHaveText('Stop Layout');
});

test('navigate back to main page', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  await page.goto('http://localhost:5173/test');
  await page.waitForTimeout(1000);
  
  await page.click('button[title="Back to main"]');
  await page.waitForTimeout(1000);
  
  const sigmaErrors = errors.filter(e => e.includes('Sigma') || e.includes('Container'));
  console.log('All errors on return:', errors);
  expect(sigmaErrors.length).toBe(0);
  
  await expect(page.locator('h1')).toContainText('Rugby co-occurrence graph');
});

test('training session keeps live and trial scheduling independent with auditable strict-best application', async ({ page }) => {
  await page.goto('http://localhost:5173/test');
  await page.getByRole('button', { name: 'ForceAtlas2' }).click();
  const locks = await page.getByTitle('Lock from optimizer').all();
  for (const lock of locks) await lock.click();
  await expect.poll(() => testBenchState(page).then((state) => state.locks.length)).toBe(8);
  const initialPositions = (await testBenchState(page)).live.positions;

  await page.getByTestId('autotune-tab').click();
  await page.getByTestId('episode-length').fill('1');
  await page.getByTestId('autotune-toggle').click();
  await page.getByRole('button', { name: 'ForceAtlas2' }).click();
  await page.getByTestId('start-stop').click();

  const beforeCalibration = await testBenchState(page);
  expect(beforeCalibration.training.session.latestReward).toBeNull();
  await expect(page.getByTestId('training-pause')).toHaveText('Pause Training');
  await page.getByTestId('training-pause').click();
  const pausedTraining = await testBenchState(page);
  expect(pausedTraining.training.session.execution.state).toBe('paused');
  const pausedTrainingTicks = pausedTraining.live.ticks;
  await expect.poll(() => testBenchState(page).then((state) => state.live.ticks)).toBeGreaterThan(pausedTrainingTicks);

  await page.getByTestId('training-pause').click();
  await expect.poll(async () => {
    const state = await testBenchState(page);
    return state.training.calibrationSteps >= 60 && state.training.session.latestReward !== null;
  }, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => {
    const state = await testBenchState(page);
    return state.strictBestApplication;
  }, { timeout: 10_000 }).not.toBeNull();
  const applicationState = await testBenchState(page);
  const application = applicationState.strictBestApplication;
  if (application === null) throw new Error("A strict-best application was not recorded.");
   expect(application.record.sequence).toBe(1);
   expect(application.record.params).toEqual(application.liveSettings);
   expect(application.record.appliedSettings).toEqual(application.liveSettings);
   expect(application.record.settingsChangeSummary).toEqual(expect.any(Array));
   expect(application.record.reward).toEqual(expect.any(Number));
   expect(Number.isFinite(application.record.reward)).toBe(true);
  expect(application.resetMetricCount).toBe(0);
  expect(application.resetTrailSegments).toBe(0);
  expect(applicationState.graph.environmentsDistinct).toBe(true);
  expect(application.resetPositions).toEqual(initialPositions);

  await page.getByTestId('start-stop').click();
  const pausedLive = await testBenchState(page);
  const pausedLiveTicks = pausedLive.live.ticks;
  const applicationSequence = pausedLive.strictBestApplication?.record.sequence;
  await expect.poll(async () => {
    const state = await testBenchState(page);
    return state.training.scoredTrials > pausedLive.training.scoredTrials;
  }, { timeout: 10_000 }).toBe(true);
  const nonBest = await testBenchState(page);
  expect(nonBest.live.ticks).toBe(pausedLiveTicks);
  expect(nonBest.strictBestApplication?.record.sequence).toBe(applicationSequence);

  await page.getByTestId('reset').click();
  const reset = await testBenchState(page);
  expect(reset.policyResetGeneration).toBe(1);
  expect(reset.training.session.execution.state).toBe('idle');
   expect(reset.training.session.autoTune.enabled).toBe(false);
   expect(reset.locks).toHaveLength(8);
   expect(reset.training.session.latestReward).toBeNull();
   expect(reset.training.scoredTrials).toBe(0);
   expect(reset.strictBestApplication).toBeNull();
   expect(reset.live.settings).toEqual(pausedLive.live.settings);
   expect(reset.live.positions).toEqual(initialPositions);
});
