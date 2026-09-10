import { expect, test } from "@playwright/test";
import { DiscreteBanditOptimizer, DIM_DEFS } from "../src/graph/rl-bandit";

const initial = {
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

test("bandit action sequences are deterministic and exclude enforced FA2 dimensions", () => {
  expect(DIM_DEFS.map((dim) => dim.key)).not.toContain("scalingRatio");
  expect(DIM_DEFS.map((dim) => dim.key)).not.toContain("adjustSizes");
  const first = new DiscreteBanditOptimizer({ calibrationSteps: 0 });
  const second = new DiscreteBanditOptimizer({ calibrationSteps: 0 });
  first.start(initial);
  second.start(initial);
  const actions = Array.from({ length: 8 }, () => first.chooseArm(null));
  const repeat = Array.from({ length: 8 }, () => second.chooseArm(null));
  expect(actions).toEqual(repeat);
  expect(actions.every((action) => action.scalingRatio === 1 && action.adjustSizes)).toBe(true);
});

test("bandit emits no strict-best before calibration or for non-finite rewards", () => {
  const bandit = new DiscreteBanditOptimizer({ calibrationSteps: 1 });
  bandit.start(initial);

  expect(bandit.recordEpisode(0.5)).toBeNull();
  bandit.observe({ timestamp: 0, meanDisplacement: 0, maxDisplacement: 0, stdDisplacement: 0, kineticEnergy: 0, nodeCount: 3 });

  expect(bandit.recordEpisode(Number.NaN)).toBeNull();
  expect(bandit.recordEpisode(Number.POSITIVE_INFINITY)).toBeNull();
  expect(bandit.recordEpisode(Number.NEGATIVE_INFINITY)).toBeNull();
  expect(bandit.snapshot()).toMatchObject({ episode: 0, bestReward: 0 });
});

test("bandit emits one strict-best event for a finite calibrated improvement", () => {
  const bandit = new DiscreteBanditOptimizer({ calibrationSteps: 0 });
  bandit.start(initial);

  const first = bandit.recordEpisode(0.5);

  expect(first?.reward).toBe(0.5);
  expect(first?.params).toEqual(initial);
  expect(bandit.recordEpisode(0.5)).toBeNull();
  expect(bandit.recordEpisode(0.4)).toBeNull();
  expect(bandit.snapshot()).toMatchObject({ episode: 3, bestReward: 0.5 });
});

test("bandit preserves locked parameters and resets its strict-best policy on start", () => {
  const bandit = new DiscreteBanditOptimizer({ calibrationSteps: 0 });
  const locked = new Set<keyof typeof initial>(["gravity", "linLogMode"]);
  bandit.start(initial, locked);

  expect(bandit.chooseArm(null)).toMatchObject({ gravity: 0.1, linLogMode: false });
  expect(bandit.recordEpisode(0.5)?.params).toMatchObject({ gravity: 0.1, linLogMode: false });

  const resetInitial = { ...initial, gravity: 0.3, linLogMode: true };
  bandit.start(resetInitial, locked);

  expect(bandit.chooseArm(null)).toMatchObject({ gravity: 0.3, linLogMode: true });
  expect(bandit.recordEpisode(0.5)?.params).toMatchObject({ gravity: 0.3, linLogMode: true });
});
