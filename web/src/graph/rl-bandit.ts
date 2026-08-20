// Contextual linear bandit (LinUCB) for ForceAtlas2 layout optimisation.
//
// Action space = one multi-armed LinUCB model per FA2 parameter. Each dim has
// a small discrete set of levels; the agent scores each level against the
// current graph state (context vector) and picks the argmax of
//   score(level) = theta_level · context + alpha · sqrt(contextᵀ A⁻¹ context)
// then runs ForceAtlas2 for a fixed budget of iterations (one "episode"),
// measures the aesthetic heuristic reward, and updates each chosen level's
// ridge regression (joint credit: every sampled level shares the episode).
//
// Exponential forgetting (lambda < 1) is applied to every A/b update so the
// models track the non-stationary reward distribution — the optimal params
// drift as the layout itself converges — instead of assuming fixed arm means.
//
// Locks: `start(initial, locked)` — dims in the locked set are excluded from
// optimisation entirely; their value comes from the anchor passed to
// `chooseArm(context, anchor)` (the page passes its current slider state).
//
// Context: normalised layout features from the last tick ([cv, aspect, motion,
// center] by the page). The bias term is appended inside the arm, so d = 1 +
// context dimensions. Before calibration the context is all-zero, which
// degrades to ordinary (context-free) ridge regression — graceful.

import type { LayoutTickStats } from "./layout";
import {
	FeatureNormalizer,
	type FA2Params,
	type HeuristicWeights,
	type HeuristicFeatures,
	defaultWeights,
	FEATURE_SIGN,
	rawFeatures,
	computeHeuristic,
} from "./layout-optimizer";

export type Sign = 1 | -1;

/** One optimisable FA2 dim: its discrete level set. Booleans get 2 levels. */
export interface DimDef {
	key: keyof FA2Params;
	label: string;
	levels: (number | boolean)[];
}

// Level sets mirror the sidebar sliders' ranges. Barnes-Hut theta follows the
// FA2 guidance (higher = faster but coarser approximation, lower = slower and
// more accurate): the graphology implementation's default is 0.5 and its slider
// caps at 1.0, so cover [0.1, 1.0] densely around the default.
export const DIM_DEFS: DimDef[] = [
	{ key: "scalingRatio", label: "Scaling", levels: [2, 5, 10, 20, 40, 60, 80, 100] },
	{ key: "gravity", label: "Gravity", levels: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10] },
	{ key: "slowDown", label: "SlowDown", levels: [0.1, 1, 5, 10, 25, 50] },
	{ key: "barnesHutTheta", label: "BH Theta", levels: [0.1, 0.2, 0.4, 0.5, 0.8, 1] },
	{ key: "edgeWeightInfluence", label: "Edge Wt", levels: [0, 0.5, 1, 2, 3, 5] },
	{ key: "strongGravityMode", label: "Strong Gravity", levels: [false, true] },
	{ key: "barnesHutOptimize", label: "BH Optimize", levels: [false, true] },
	{ key: "outboundAttractionDistribution", label: "Outbound", levels: [false, true] },
	{ key: "linLogMode", label: "LinLog", levels: [false, true] },
	{ key: "adjustSizes", label: "Adjust Sizes", levels: [false, true] },
];

/** Index of the level closest to `v` (booleans compare as 0/1). */
function nearestLevelIndex(levels: (number | boolean)[], v: number | boolean | undefined): number {
	if (v === undefined) return 0;
	let best = 0;
	let bestD = Infinity;
	for (let i = 0; i < levels.length; i++) {
		const d = Math.abs(Number(levels[i]) - Number(v));
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}

// ---- Contextual linear arm (ridge regression with forgetting) ----

/** UCB exploration bonus multiplier. Higher = more exploration. */
const ALPHA = 4;
/** Epsilon for epsilon-greedy exploration (fraction of episodes to pick random level). */
const EPSILON = 0.15;
/** Per-update forgetting factor: A ← λA + xxᵀ, b ← λb + r·x. */
const FORGET = 0.98;

function zeros(n: number): number[] {
	return new Array(n).fill(0);
}

function identity(n: number): number[][] {
	const m = zeros(n).map(() => zeros(n));
	for (let i = 0; i < n; i++) m[i][i] = 1;
	return m;
}

function dot(a: number[], b: number[]): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

function matVec(m: number[][], v: number[]): number[] {
	return m.map((row) => dot(row, v));
}

class LinUCBArm {
	private Ainv: number[][];
	private b: number[];
	count = 0;
	totalReward = 0;
	constructor(d: number) {
		this.Ainv = identity(d);
		this.b = zeros(d);
	}
	/** Empirical mean reward (for best-level / UI display). */
	get mean(): number {
		return this.count ? this.totalReward / this.count : 0;
	}
	/** Count-based uncertainty (UI display; choice-time UCB is context-aware). */
	get uncertainty(): number {
		return this.count ? 1 / Math.sqrt(this.count + 1) : 1;
	}
	/** theta · x with theta = A⁻¹ b (posterior predictive mean). */
	predict(x: number[]): number {
		return dot(matVec(this.Ainv, this.b), x);
	}
	/** alpha · sqrt(xᵀ A⁻¹ x): UCB exploration radius. */
	ucb(x: number[], alpha = ALPHA): number {
		const Ax = matVec(this.Ainv, x);
		return alpha * Math.sqrt(Math.max(0, dot(x, Ax)));
	}
	/** Ridge update with forgetting (Sherman-Morrison on the inverse). */
	update(x: number[], r: number): void {
		const Ax = matVec(this.Ainv, x);
		const xAx = dot(x, Ax);
		const invDenom = 1 / (FORGET + xAx);
		this.Ainv = this.Ainv.map((row, i) =>
			row.map((v, j) => (v - Ax[i] * Ax[j] * invDenom) / FORGET),
		);
		this.b = this.b.map((bi, i) => bi * FORGET + r * x[i]);
		this.count++;
		this.totalReward += r;
	}
}

// Re-export feature helpers the page consumed from the bandit module.
export { defaultWeights, FEATURE_SIGN } from "./layout-optimizer";
export { FEATURE_LABEL, FEATURE_SHORT, FEATURE_KEYS } from "./layout-optimizer";
export type { FA2Params, HeuristicWeights, HeuristicFeatures };

export interface DimStat {
	mean: number;
	uncertainty: number;
	count: number;
	meanReward: number;
}

export interface DimSnapshot {
	key: keyof FA2Params;
	label: string;
	levels: (number | boolean)[];
	/** Level index chosen for the current episode. */
	currentLevel: number;
	/** Level index with the highest posterior success-rate mean. */
	bestLevel: number;
	stats: DimStat[];
}

/** One evaluated episode: the parameter combination and its scored reward. */
export interface LeaderboardEntry {
	params: FA2Params;
	reward: number;
	episode: number;
}

export interface BanditSnapshot {
	running: boolean;
	episode: number;
	bestReward: number;
	currentReward: number;
	avgReward: number;
	explorationPct: number;
	exploitationPct: number;
	currentParams: FA2Params;
	bestParams: FA2Params;
	lastImprovement: number;
	rewardHistory: number[];
	/** One entry per UNLOCKED dim (locked dims have no model). */
	dims: DimSnapshot[];
	/** Every evaluated episode's params + reward (the page ranks these). */
	leaderboard: LeaderboardEntry[];
}

export interface DiscreteBanditOpts {
	weights?: HeuristicWeights;
	signs?: Record<keyof HeuristicFeatures, Sign>;
}

/** Fallback anchor: DIM_DEFS first levels, used before any chooseArm call. */
function defaultAnchor(): FA2Params {
	const p = {} as Record<keyof FA2Params, number | boolean>;
	for (const d of DIM_DEFS) p[d.key] = d.levels[0];
	return p as FA2Params;
}

export class DiscreteBanditOptimizer {
	private weights: HeuristicWeights = defaultWeights();
	private signs: Record<keyof HeuristicFeatures, Sign> = { ...FEATURE_SIGN };
	private readonly normalizer = new FeatureNormalizer(60);
	/** Per dim: one LinUCB arm per level. */
	private arms = new Map<keyof FA2Params, LinUCBArm[]>();
	private locked: Set<keyof FA2Params> = new Set();
	/** Fallback / locked-dim values (updated by the last chooseArm anchor). */
	private anchor: FA2Params = defaultAnchor();
	private currentLevels: Partial<Record<keyof FA2Params, number>> = {};
	private bestLevels: Partial<Record<keyof FA2Params, number>> = {};
	private running = false;
	private episode = 0;
	private incumbentReward = -Infinity;
	private bestReward = -Infinity;
	private bestRewardParams: FA2Params | null = null; // params that achieved bestReward
	private rewardHistory: number[] = [];
	private leaderboard: LeaderboardEntry[] = [];
	private exploreCount = 0;
	private totalPicks = 0;
	/** Number of context dimensions (bias is added internally). */
	private contextDim = 0;
	/** contextDim used when the current arm models were seeded (retarget). */
	private lastContextDim = 0;

	constructor(_opts: DiscreteBanditOpts = {}) {}

	setWeights(w: HeuristicWeights): void {
		this.weights = w;
	}
	setSigns(s: Record<keyof HeuristicFeatures, Sign>): void {
		this.signs = s;
	}

	isCalibrated(): boolean {
		return this.normalizer.calibrated;
	}

	/** Feed a layout tick into the (display) feature normaliser. */
	observe(stat: LayoutTickStats): void {
		this.normalizer.observe(rawFeatures(stat));
	}

	/** Normalised feature view for UI display. */
	featureView(stat: LayoutTickStats): HeuristicFeatures {
		return this.normalizer.normalize(rawFeatures(stat));
	}

	/** Continuous aesthetic reward (signed heuristic over normalised features). */
	reward(stat: LayoutTickStats): number {
		const f = this.normalizer.normalize(rawFeatures(stat));
		return computeHeuristic(f, this.weights, this.signs);
	}

	/** (Re)initialise the bandit. `locked` dims are excluded from optimisation;
	 *  unlocked dims seed their first pick near the current value of `initial`.
	 *  `contextDim` = number of context features the page will feed to
	 *  chooseArm/recordEpisode (bias dimension is added internally). */
	start(initial: FA2Params, locked: Set<keyof FA2Params> = new Set(), contextDim = 0): void {
		this.running = true;
		this.episode = 0;
		this.locked = new Set(locked);
		this.anchor = { ...initial };
		this.contextDim = Math.max(0, Math.floor(contextDim));
		this.lastContextDim = this.contextDim;
		this.arms.clear();
		this.currentLevels = {};
		this.bestLevels = {};
		const d = this.contextDim + 1; // + bias
		for (const dim of DIM_DEFS) {
			if (this.locked.has(dim.key)) continue;
			this.arms.set(dim.key, dim.levels.map(() => new LinUCBArm(d)));
			const idx = nearestLevelIndex(dim.levels, initial[dim.key]);
			this.currentLevels[dim.key] = idx;
			this.bestLevels[dim.key] = idx;
		}
		this.incumbentReward = -Infinity;
		this.bestReward = -Infinity;
		this.bestRewardParams = null;
		this.rewardHistory = [];
		this.leaderboard = [];
		this.exploreCount = 0;
		this.totalPicks = 0;
	}

	/** Mid-run objective change (weights/signs/locks edited while running):
	 *  keep the learned ridge models (Ainv/b — the contextual θ per level),
	 *  forget only the heuristic-scored memory (arm reward stats, best and
	 *  incumbent rewards, episode reward history). Newly unlocked dims get
	 *  fresh arms seeded near `initial`; re-locked dims drop out of the
	 *  active set. The episode counter keeps counting — only the "best so
	 *  far" memory restarts from this change onwards. */
	retarget(initial: FA2Params, locked: Set<keyof FA2Params> = new Set(), contextDim = 0): void {
		this.locked = new Set(locked);
		this.anchor = { ...initial };
		this.contextDim = Math.max(0, Math.floor(contextDim));
		if (this.contextDim !== this.lastContextDim) {
			// Seeded arm models would have the wrong dimension: rebuild them.
			this.arms.clear();
		}
		this.lastContextDim = this.contextDim;
		const d = this.contextDim + 1;
		this.currentLevels = {};
		this.bestLevels = {};
		for (const dim of DIM_DEFS) {
			if (this.locked.has(dim.key)) continue;
			let arms = this.arms.get(dim.key);
			if (!arms) {
				arms = dim.levels.map(() => new LinUCBArm(d));
				this.arms.set(dim.key, arms);
			}
			for (const a of arms) {
				a.count = 0;
				a.totalReward = 0;
			}
			const idx = nearestLevelIndex(dim.levels, initial[dim.key]);
			this.currentLevels[dim.key] = idx;
			this.bestLevels[dim.key] = idx;
		}
		this.incumbentReward = -Infinity;
		this.bestReward = -Infinity;
		this.bestRewardParams = null;
		this.rewardHistory = [];
		this.leaderboard = [];
	}

	stop(): void {
		this.running = false;
	}

	/** Update the set of locked parameters at runtime. Resets step sizes for newly unlocked dims. */
	setLockedParams(locked: Set<keyof FA2Params>): void {
		this.locked.clear();
		for (const k of locked) this.locked.add(k);
		// Re-initialize arms for newly unlocked dims
		for (const dim of DIM_DEFS) {
			if (!this.locked.has(dim.key) && !this.arms.has(dim.key)) {
				const d = this.contextDim + 1;
				this.arms.set(dim.key, dim.levels.map(() => new LinUCBArm(d)));
				this.currentLevels[dim.key] = 0;
				this.bestLevels[dim.key] = 0;
			}
		}
	}

	/** Manually set a single incumbent parameter (used for locked params that the user edits during optimisation). */
	setIncumbentParam(key: keyof FA2Params, value: number | boolean): void {
		(this.anchor as Record<keyof FA2Params, number | boolean>)[key] = value;
		// If the param is locked, update the anchor so chooseArm uses the new value
		if (this.locked.has(key)) {
			(this.anchor as Record<keyof FA2Params, number | boolean>)[key] = value;
		}
	}

	/** Score one level per unlocked dim against the current graph context;
	 *  locked dims take the anchor (current slider) values. `context` is the
	 *  normalised feature vector (null → bias-only, context-free). */
	chooseArm(context: number[] | null, anchor?: Partial<FA2Params>): FA2Params {
		if (anchor) this.anchor = { ...this.anchor, ...anchor };
		const ctx = this.withBias(context);
		const params = { ...this.anchor } as FA2Params;
		let explored = 0;
		let total = 0;
		for (const dim of DIM_DEFS) {
			if (this.locked.has(dim.key)) continue;
			const arms = this.arms.get(dim.key)!;
			let bestIdx = 0;
			let bestScore = -Infinity;
			let empIdx = 0;
			let empMean = -Infinity;
			for (let i = 0; i < arms.length; i++) {
				const score = arms[i].predict(ctx) + arms[i].ucb(ctx);
				if (score > bestScore) {
					bestScore = score;
					bestIdx = i;
				}
				if (arms[i].mean > empMean) {
					empMean = arms[i].mean;
					empIdx = i;
				}
			}
			// Epsilon-greedy: occasionally pick a random level to ensure exploration
			let epsilonExplored = false;
			if (Math.random() < EPSILON) {
				bestIdx = Math.floor(Math.random() * arms.length);
				epsilonExplored = true;
			}
			// Count exploration: UCB picked non-empirical, or epsilon forced random
			const isExplored = bestIdx !== empIdx || epsilonExplored;
			if (isExplored) explored++;
			total++;
			this.currentLevels[dim.key] = bestIdx;
			(params as Record<keyof FA2Params, number | boolean>)[dim.key] = dim.levels[bestIdx];
		}
		this.totalPicks += total;
		this.exploreCount += explored;
		return params;
	}

	/** Fold a completed episode's reward into every sampled level's ridge
	 *  regression, using the same context the arm was chosen under. */
	recordEpisode(reward: number, context: number[] | null = null): void {
		const ctx = this.withBias(context);
		const improved = isNaN(this.incumbentReward) || reward > this.incumbentReward;
		for (const dim of DIM_DEFS) {
			if (this.locked.has(dim.key)) continue;
			const li = this.currentLevels[dim.key];
			if (li === undefined) continue;
			this.arms.get(dim.key)![li].update(ctx, reward);
		}
		this.rewardHistory.push(reward);
		this.leaderboard.push({ params: this.buildParams(this.currentLevels), reward, episode: this.episode });
		if (improved) {
			this.incumbentReward = reward;
			if (reward > this.bestReward) {
				this.bestReward = reward;
				this.bestRewardParams = this.buildParams(this.currentLevels);
			}
		}
		this.episode++;
	}

	/** Append the bias term; null/short context degrades to zeros + bias. */
	private withBias(context: number[] | null): number[] {
		const x = context ? context.slice(0, this.contextDim) : [];
		while (x.length < this.contextDim) x.push(0);
		x.push(1);
		return x;
	}

	private bestLevelsNow(): Partial<Record<keyof FA2Params, number>> {
		const out: Partial<Record<keyof FA2Params, number>> = {};
		for (const dim of DIM_DEFS) {
			if (this.locked.has(dim.key)) continue;
			const arms = this.arms.get(dim.key)!;
			let best = 0;
			let bestMean = -Infinity;
			for (let i = 0; i < arms.length; i++) {
				if (arms[i].mean > bestMean) {
					bestMean = arms[i].mean;
					best = i;
				}
			}
			out[dim.key] = best;
		}
		return out;
	}

	private buildParams(levels: Partial<Record<keyof FA2Params, number>>): FA2Params {
		const params = { ...this.anchor } as FA2Params;
		for (const dim of DIM_DEFS) {
			const li = levels[dim.key];
			if (li === undefined) continue;
			(params as Record<keyof FA2Params, number | boolean>)[dim.key] = dim.levels[li];
		}
		return params;
	}

	snapshot(): BanditSnapshot {
		const hist = this.rewardHistory;
		const avg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
		const explorePct = this.totalPicks ? (this.exploreCount / this.totalPicks) * 100 : 0;
		const bestLevels = this.bestLevelsNow();
		this.bestLevels = bestLevels;
		const dims: DimSnapshot[] = [];
		for (const dim of DIM_DEFS) {
			if (this.locked.has(dim.key)) continue;
			const arms = this.arms.get(dim.key)!;
			dims.push({
				key: dim.key,
				label: dim.label,
				levels: dim.levels,
				currentLevel: this.currentLevels[dim.key] ?? 0,
				bestLevel: bestLevels[dim.key] ?? 0,
				stats: arms.map((a) => ({
					mean: a.mean,
					uncertainty: a.uncertainty,
					count: a.count,
					meanReward: a.count ? a.totalReward / a.count : 0,
				})),
			});
		}
		const cur = hist.length ? hist[hist.length - 1] : NaN;
		const prev = hist.length >= 2 ? hist[hist.length - 2] : NaN;
		return {
			running: this.running,
			episode: this.episode,
			bestReward: this.bestReward === -Infinity ? 0 : this.bestReward,
			currentReward: isNaN(cur) ? 0 : cur,
			avgReward: avg,
			explorationPct: explorePct,
			exploitationPct: 100 - explorePct,
			currentParams: this.buildParams(this.currentLevels),
			bestParams: this.bestRewardParams ?? this.buildParams(this.currentLevels),
			lastImprovement: isNaN(cur) || isNaN(prev) ? 0 : cur - prev,
			rewardHistory: hist,
			dims,
			leaderboard: this.leaderboard.slice(),
		};
	}
}
