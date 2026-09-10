import { expect, test } from "@playwright/test";
import type { FA2Params } from "../src/graph/layout-optimizer";
import { TrainingSessionModel } from "../src/graph/training-session";

const initialParams: FA2Params = {
  gravity: 0.1,
  slowDown: 1,
  scalingRatio: 1,
  strongGravityMode: true,
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,
  edgeWeightInfluence: 1,
  outboundAttractionDistribution: true,
  linLogMode: false,
  adjustSizes: true,
};

test("enabled active training pauses without implicitly stopping caller-owned live state", () => {
  const liveState = { running: true };
  const session = new TrainingSessionModel({
    initialParams,
    policy: { reset: () => undefined },
  });

  session.enableAutoTune();
  session.startTraining();
  session.pauseTraining();

  expect(session.snapshot()).toMatchObject({
    autoTune: { enabled: true },
    execution: { state: "paused" },
  });
  expect(liveState).toEqual({ running: true });
});

test("paused training resumes without resetting the policy", () => {
  let policyResets = 0;
  const session = new TrainingSessionModel({
    initialParams,
    policy: { reset: () => { policyResets++; } },
  });

  session.enableAutoTune();
  session.startTraining();
  session.pauseTraining();
  session.resumeTraining();

  expect(session.snapshot()).toMatchObject({
    execution: { state: "active" },
    policy: { resets: 0 },
  });
  expect(policyResets).toBe(0);
});

test("confirmed reset resets policy state without mutating caller-owned live settings", () => {
  const liveSettings = { gravity: 4, slowDown: 9 };
  const resetCalls: FA2Params[] = [];
  const session = new TrainingSessionModel({
    initialParams,
    policy: { reset: (params) => { resetCalls.push(params); } },
  });

  session.enableAutoTune();
  session.startTraining();
  session.confirmReset();

  expect(resetCalls).toEqual([initialParams]);
  expect(liveSettings).toEqual({ gravity: 4, slowDown: 9 });
  expect(session.snapshot()).toMatchObject({
    autoTune: { enabled: false },
    execution: { state: "idle" },
    policy: { resets: 1 },
    recentRewards: [],
    strictBestApplication: null,
  });
});

test("strict-best application records finite serializable evidence with a monotonic sequence", () => {
  const session = new TrainingSessionModel({ initialParams, policy: { reset: () => undefined } });

  const first = session.recordStrictBestApplication({ params: initialParams, reward: 0.4 }, "2026-08-22T12:00:00.000Z");
  const second = session.recordStrictBestApplication({ params: { ...initialParams, gravity: 0.3 }, reward: 0.8 }, "2026-08-22T12:00:01.000Z", initialParams);

  expect(first).toEqual({ sequence: 1, reward: 0.4, params: initialParams, appliedSettings: initialParams, settingsChangeSummary: [], timestamp: "2026-08-22T12:00:00.000Z" });
  expect(second).toEqual({ sequence: 2, reward: 0.8, params: { ...initialParams, gravity: 0.3 }, appliedSettings: { ...initialParams, gravity: 0.3 }, settingsChangeSummary: ["gravity"], timestamp: "2026-08-22T12:00:01.000Z" });
  expect(JSON.parse(JSON.stringify(session.snapshot())).strictBestApplication).toEqual(second);
});

test("non-finite strict-best events do not create application evidence", () => {
  const session = new TrainingSessionModel({ initialParams, policy: { reset: () => undefined } });

  const application = session.recordStrictBestApplication({ params: initialParams, reward: Number.NaN }, "2026-08-22T12:00:00.000Z");

  expect(application).toBeNull();
  expect(session.snapshot().strictBestApplication).toBeNull();
});

test("policy reset does not reuse strict-best application sequences", () => {
  const session = new TrainingSessionModel({ initialParams, policy: { reset: () => undefined } });

  session.recordStrictBestApplication({ params: initialParams, reward: 0.4 }, "2026-08-22T12:00:00.000Z");
  session.confirmReset();
  const application = session.recordStrictBestApplication({ params: initialParams, reward: 0.8 }, "2026-08-22T12:00:01.000Z");

  expect(application?.sequence).toBe(2);
});

test("unscored trials leave rewards absent", () => {
  const session = new TrainingSessionModel({ initialParams, policy: { reset: () => undefined } });

  session.recordTrial(null);

  expect(session.snapshot().recentRewards).toEqual([]);
  expect(session.snapshot().latestReward).toBeNull();
});

test("scored-trial snapshot retains only the bounded recent history", () => {
  const session = new TrainingSessionModel({ initialParams, policy: { reset: () => undefined } });

  for (let rewardValue = 0; rewardValue < 12; rewardValue++) session.recordTrial(rewardValue);

  expect(session.snapshot().recentRewards).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});
