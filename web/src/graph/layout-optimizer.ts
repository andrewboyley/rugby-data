// Real-time FA2 hyperparameter optimizer (coordinate ascent with rollback eval).
//
// ForceAtlas2 only exposes a fixed set of tunable settings, so "changing FA2 to
// maximise a heuristic" means online-tuning those settings against a live
// aesthetic score. Each layout chunk is one observation; the optimizer proposes
// a candidate parameter set, runs it for N chunks (rollback: positions are saved
// first and restored on rejection), and keeps it if its EMA heuristic score
// beats the incumbent.

import type { LayoutTickStats } from "./layout";
export type { LayoutTickStats } from "./layout";

export interface FA2Params {
	gravity: number;
	slowDown: number;
	scalingRatio: number;
	strongGravityMode: boolean;
	barnesHutOptimize: boolean;
	barnesHutTheta: number;
	edgeWeightInfluence: number;
	outboundAttractionDistribution: boolean;
	linLogMode: boolean;
	adjustSizes: boolean;
}

export interface HeuristicWeights {
	angle: number;
	minAngle: number;
	cross: number;
	cv: number;
	aspect: number;
	motion: number;
	center: number;
}

export const defaultWeights = (): HeuristicWeights => ({
	angle: 0.8,
	minAngle: 1.0,
	cross: 2.0,
	cv: 1.0,
	aspect: 0.5,
	motion: 0.6,
	center: 0.8,
});

const clamp01 = (v: number) => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

/** Coerce null/undefined/NaN/Infinity to 0 so a bad stat can never poison the
 *  running feature statistics. */
const safe = (v: number | null | undefined): number =>
	typeof v === "number" && Number.isFinite(v) ? v : 0;

/** Raw (un-normalised) input features for the heuristic. Values are oriented so
 *  that a higher value means a better layout for the features whose sign is +1
 *  (and a worse layout for `kinetic`, whose sign is -1). Actual [0,1]
 *  normalisation is done online by FeatureNormalizer from seen data, so these
 *  need not be bounded — e.g. `spread` is a raw extent/edge-length ratio.
 *  Signs encode what a "good" graph is: a feature whose high value means a
 *  better layout is rewarded (+1); one whose high value means a worse layout
 *  (e.g. kinetic energy = residual motion) is penalised (-1). */
export type HeuristicFeatures = {
	/** Mean angular resolution over nodes — how evenly incident edges fan out. */
	angle: number;
	/** Smallest crossing angle — how acute the sharpest edge intersection is. */
	minAngle: number;
	/** Number of edge crossings. */
	cross: number;
	/** Coefficient of variation of edge lengths. */
	cv: number;
	/** |aspectRatio − 1| — how far the bounding box is from square. */
	aspect: number;
	/** Mean node displacement relative to mean edge length — how much residual motion remains. */
	motion: number;
	/** Mean node distance to the origin, relative to mean edge length. */
	center: number;
};

export const FEATURE_KEYS: (keyof HeuristicFeatures)[] = [
	"angle",
	"minAngle",
	"cross",
	"cv",
	"aspect",
	"motion",
	"center",
];

export const FEATURE_SIGN: Record<keyof HeuristicFeatures, 1 | -1> = {
	angle: 1,
	minAngle: 1,
	cross: -1,
	cv: -1,
	aspect: -1,
	motion: -1,
	center: -1,
};

export const FEATURE_LABEL: Record<keyof HeuristicFeatures, string> = {
	angle: "Angular Resolution",
	minAngle: "Crossing Angle",
	cross: "Edge Crossings",
	cv: "Edge Length Uniformity",
	aspect: "Aspect Ratio",
	motion: "Residual Motion",
	center: "Centrality",
};

/** Short abbreviations shown in the weight editor rows (tooltip uses FEATURE_LABEL). */
export const FEATURE_SHORT: Record<keyof HeuristicFeatures, string> = {
	angle: "Angle",
	minAngle: "Min∠",
	cross: "Cross",
	cv: "CV",
	aspect: "Aspect",
	motion: "Motion",
	center: "Center",
};

/** Feature name, LaTeX-style formulation, and effect on the graph — shown in
 *  weight tooltips. Independent of weight sign. `meanEdge =
 *  totalEdgeLength / nodeCount`, angles in degrees. */
export const FEATURE_DETAIL: Record<keyof HeuristicFeatures, { latex: string; effect: string }> = {
	angle: {
		latex: "\\mathrm{clamp}_{01}\\!\\left(\\frac{\\text{angularRes}}{180}\\right)",
		effect: "Higher = wider angular gaps between edges at each node, so the graph reads as cleaner and less congested. Rewarded.",
	},
	minAngle: {
		latex: "\\mathrm{clamp}_{01}\\!\\left(\\frac{\\text{minCross}}{180}\\right)",
		effect: "Higher = the sharpest edge crossing anywhere is wider, removing near-overlaps that look like a single thick line. Rewarded.",
	},
	cross: {
		latex: "\\text{edgeCrossings}",
		effect: "Higher = more edges intersect, so the drawing is harder to trace. Penalised.",
	},
	cv: {
		latex: "\\text{edgeLengthCV}",
		effect: "Higher = edge lengths vary more, giving the graph an irregular appearance. Penalised.",
	},
	aspect: {
		latex: "\\left|\\text{aspectRatio} - 1\\right|",
		effect: "Higher = the bounding box deviates further from square, so the drawing looks stretched or squashed. Penalised.",
	},
	motion: {
		latex: "\\mathrm{clamp}_{01}\\!\\left(\\frac{\\text{meanDisplacement}}{\\text{meanEdge}}\\right)",
		effect: "Higher = nodes are still moving, so candidates get compared mid-convergence. Penalised — the tuner favours low-motion candidates.",
	},
	center: {
		latex: "\\frac{\\text{meanDistToOrigin}}{\\text{meanEdge}}",
		effect: "Higher = nodes sit further from the origin, so the graph drifts off-centre. Penalised — pulls the layout toward 0,0.",
	},
};

/** Raw input features for the heuristic. Every feature is invariant under a
 *  uniform rescaling of coordinates (crosses, angles, CV and ratios) so the
 *  agent cannot game the score by just cranking scalingRatio/gravity — it has
 *  to actually improve the layout. Actual [0,1] normalisation is done online
 *  by FeatureNormalizer from seen data, so these need not be bounded. */
export function rawFeatures(stat: LayoutTickStats): HeuristicFeatures {
	const meanEdge = safe(stat.totalEdgeLength) / Math.max(1, safe(stat.nodeCount));
	return {
		angle: clamp01(safe(stat.angularResolution) / 180),
		minAngle: clamp01(safe(stat.minCrossingAngle) / 180),
		cross: safe(stat.edgeCrossings),
		cv: safe(stat.edgeLengthCV),
		aspect: Math.abs(safe(stat.aspectRatio) - 1),
		motion: clamp01(safe(stat.meanDisplacement) / Math.max(1e-6, meanEdge)),
		center: clamp01(safe(stat.centerDistRatio ?? 0)),
	};
}

/** Online per-feature normaliser: Welford running mean/variance, frozen after a
 *  warmup of `warmupChunks` observations. Maps a raw feature vector to [0,1] via
 *  a z-score squashed through a logistic, so every feature is centred and
 *  scaled by its own observed variance. */
export class FeatureNormalizer {
	private n = 0;
	private mean: Record<string, number> = {};
	private m2: Record<string, number> = {};
	private frozen = false;
	private warmup: number;

	constructor(warmupChunks = 60) {
		this.warmup = warmupChunks;
		for (const k of FEATURE_KEYS) {
			this.mean[k] = 0;
			this.m2[k] = 0;
		}
	}

	get calibrated(): boolean {
		return this.frozen;
	}

	reset(warmupChunks = this.warmup): void {
		this.n = 0;
		this.frozen = false;
		this.warmup = warmupChunks;
		for (const k of FEATURE_KEYS) {
			this.mean[k] = 0;
			this.m2[k] = 0;
		}
	}

	observe(f: HeuristicFeatures): void {
		if (this.frozen) return;
		this.n++;
		for (const k of FEATURE_KEYS) {
			const x = f[k];
			const delta = x - this.mean[k];
			this.mean[k] += delta / this.n;
			this.m2[k] += delta * (x - this.mean[k]);
		}
		if (this.n >= this.warmup) this.frozen = true;
	}

	normalize(f: HeuristicFeatures): HeuristicFeatures {
		const out = {} as HeuristicFeatures;
		for (const k of FEATURE_KEYS) {
			const variance = this.n > 1 ? this.m2[k] / (this.n - 1) : 1;
			const sd = Math.sqrt(Math.max(variance, 1e-9));
			const z = (f[k] - this.mean[k]) / sd;
			const v = 1 / (1 + Math.exp(-z));
			out[k] = Number.isFinite(v) ? v : 0.5;
		}
		return out;
	}
}

/** Composite aesthetic score; each normalised feature is [0,1] * weight * sign,
 *  summed. `signs` is mutable so the UI can flip a feature between reward and
 *  penalise. */
export function computeHeuristic(
	f: HeuristicFeatures,
	w: HeuristicWeights,
	signs: Record<keyof HeuristicFeatures, 1 | -1> = FEATURE_SIGN,
): number {
	let score = 0;
	for (const k of FEATURE_KEYS) {
		const wk = Number.isFinite(w[k]) ? w[k] : 0;
		const fk = Number.isFinite(f[k]) ? f[k] : 0;
		score += signs[k] * wk * fk;
	}
	return Number.isFinite(score) ? score : 0;
}

interface ContDim {
	key: keyof FA2Params;
	min: number;
	max: number;
	initStep: number;
}
const CONT_DIMS: ContDim[] = [
	{ key: "gravity", min: 0.01, max: 10, initStep: 0.5 },
	{ key: "slowDown", min: 0.1, max: 50, initStep: 0.5 },
	{ key: "scalingRatio", min: 1, max: 100, initStep: 5 },
	{ key: "barnesHutTheta", min: 0.1, max: 1, initStep: 0.1 },
	{ key: "edgeWeightInfluence", min: 0, max: 5, initStep: 0.25 },
];
const BOOL_KEYS = [
	"strongGravityMode",
	"barnesHutOptimize",
	"outboundAttractionDistribution",
	"linLogMode",
	"adjustSizes",
] as const;
type BoolKey = (typeof BOOL_KEYS)[number];

type Dim = ContDim | BoolKey;

interface SaveRestore {
	save(): Map<string, { x: number; y: number }>;
	restore(s: Map<string, { x: number; y: number }>): void;
}

export interface OptimizerEvalView {
	dimKey: string;
	dir: "+" | "-" | "flip";
	candidate: FA2Params;
	candidateScore: number;
	chunksLeft: number;
	chunksPerEval: number;
}

export interface OptimizerSnapshot {
	running: boolean;
	converged: boolean;
	incumbent: FA2Params;
	incumbentScore: number;
	best: FA2Params;
	bestScore: number;
	eval: OptimizerEvalView | null;
	/** Mean heuristic score of the most recently completed episode. */
	lastEpisodeMean: number;
	steps: Record<string, number>;
}

const contInit = (key: string): number => CONT_DIMS.find((d) => d.key === key)?.initStep ?? 1;

function blankParams(): FA2Params {
	return {
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
}

const clone = (p: FA2Params): FA2Params => ({ ...p });

export interface OptimizerOptions {
	chunksPerEval?: number;
	minStepFactor?: number;
	warmupChunks?: number;
	saveRestore: SaveRestore;
	lockedParams?: Set<keyof FA2Params>;
}

export class FA2Optimizer {
	private weights: HeuristicWeights = defaultWeights();
	private signs: Record<keyof HeuristicFeatures, 1 | -1> = { ...FEATURE_SIGN };
	private N: number;
	private readonly minStepFactor: number;
	private readonly warmupChunks: number;
	private readonly saveRestore: SaveRestore;
	private readonly lockedParams: Set<keyof FA2Params>;
	private normalizer: FeatureNormalizer;

	private running = false;
	private converged = false;
	private incumbent: FA2Params = blankParams();
	private incumbentTotal = NaN;
	private lastEpisodeMean = NaN;
	private best: FA2Params = blankParams();
	private bestScore = -Infinity;
	private steps: Record<string, number> = {};
	private dimState: Record<string, { dir: "+" | "-"; bothTried: boolean }> = {};
	private cursor = 0;
	private noImproveInSweep = true;
	private evalState: {
		dimKey: string;
		dir: "+" | "-" | "flip";
		candidate: FA2Params;
		saved: Map<string, { x: number; y: number }>;
		candidateTotal: number;
		chunksLeft: number;
		rebase?: boolean;
	} | null = null;

	// Set when an optimisation parameter changes mid-run; triggers a one-off
	// re-scoring of the incumbent under the new settings (see advance/finalizeEval).
	private pendingRebaseline = false;

	constructor(opts: OptimizerOptions) {
		this.N = opts.chunksPerEval ?? 5;
		this.minStepFactor = opts.minStepFactor ?? 1e-3;
		this.warmupChunks = opts.warmupChunks ?? 60;
		this.saveRestore = opts.saveRestore;
		this.lockedParams = opts.lockedParams ?? new Set();
		this.normalizer = new FeatureNormalizer(this.warmupChunks);
		for (const d of CONT_DIMS) this.steps[d.key] = d.initStep;
	}

	/** True once the normaliser has finished its warmup and frozen its stats. */
	isCalibrated(): boolean {
		return this.normalizer.calibrated;
	}

	/** Normalised feature view for UI display (does not affect calibration). */
	featureView(stat: LayoutTickStats): HeuristicFeatures {
		return this.normalizer.normalize(rawFeatures(stat));
	}

	/** Reset the tracked best params. Called whenever an optimisation
	 *  parameter (weights, signs, episode length, locked set) changes, since
	 *  the previous best score is no longer comparable under the new settings.
	 *  Seeds `best` with the current incumbent (so it stays non-zero) and
	 *  schedules a re-baseline that re-scores the incumbent under the new
	 *  settings, refreshing both `incumbentTotal` and `bestScore`. */
	private resetBestTracking(): void {
		this.best = clone(this.incumbent);
		this.bestScore = Number.isFinite(this.incumbentTotal) ? this.incumbentTotal : -Infinity;
		this.pendingRebaseline = true;
	}

	setWeights(w: HeuristicWeights): void {
		this.weights = w;
		this.resetBestTracking();
	}

	/** Flip/reward per-feature signs (the UI effect icon toggles these). */
	setSigns(s: Record<keyof HeuristicFeatures, 1 | -1>): void {
		this.signs = s;
		this.resetBestTracking();
	}

	/** Set the episode length: chunks run per candidate before it is scored
	 *  and (on rejection) rolled back. Adjustable at runtime. */
	setChunksPerEval(n: number): void {
		this.N = Math.max(1, Math.floor(n));
		this.resetBestTracking();
	}

	/** Manually set a single incumbent parameter (used for locked params that
	 *  the user edits during optimisation). The optimizer never perturbs locked
	 *  params, so this takes effect directly. Re-baselines best tracking since
	 *  the layout score has changed. */
	setIncumbentParam(key: keyof FA2Params, value: number | boolean): void {
		(this.incumbent as unknown as Record<string, number | boolean>)[key] = value;
		this.resetBestTracking();
	}

	/** Update the set of locked parameters at runtime. Resets step sizes for newly unlocked dims. */
	setLockedParams(locked: Set<keyof FA2Params>): void {
		this.lockedParams.clear();
		for (const k of locked) this.lockedParams.add(k);
		for (const d of CONT_DIMS) {
			if (!this.lockedParams.has(d.key)) this.steps[d.key] = d.initStep;
		}
		this.dimState = {};
		this.cursor = 0;
		this.resetBestTracking();
	}

	start(initial: FA2Params): void {
		this.running = true;
		this.converged = false;
		this.normalizer.reset(this.warmupChunks);
		this.incumbent = clone(initial);
		this.incumbentTotal = NaN;
		this.lastEpisodeMean = NaN;
		this.best = clone(initial);
		this.bestScore = -Infinity;
		for (const d of CONT_DIMS) {
			if (!this.lockedParams.has(d.key)) this.steps[d.key] = d.initStep;
		}
		this.dimState = {};
		this.cursor = 0;
		this.noImproveInSweep = true;
		this.evalState = null;
		this.pendingRebaseline = false;
	}

	stop(): void {
		this.running = false;
	}

	/** Returns the FA2 params to use for the upcoming chunk. Finalises the
	 *  previous eval (if complete) and begins the next one. Optimisation
	 *  continues across plateaus (see advanceCursor), so this never halts on
	 *  convergence. */
	advance(): FA2Params {
		if (!this.running) return this.incumbent;
		if (this.evalState && this.evalState.chunksLeft <= 0) {
			this.finalizeEval();
		}
		if (!this.evalState) {
			if (this.pendingRebaseline) {
				// Re-score the current incumbent under the (just-changed) settings
				// before resuming normal exploration, so best tracking stays live.
				this.pendingRebaseline = false;
				const saved = this.saveRestore.save();
				this.evalState = {
					dimKey: "",
					dir: "+",
					candidate: clone(this.incumbent),
					saved,
					candidateTotal: NaN,
					chunksLeft: this.N,
					rebase: true,
				};
			} else {
				this.beginEval();
			}
		}
		if (this.evalState) {
			this.evalState.chunksLeft--;
			return this.evalState.candidate;
		}
		return this.incumbent;
	}

	/** Fold a chunk's stat into the active eval's cumulative episode score. */
	recordChunk(stat: LayoutTickStats): void {
		if (!this.evalState) return;
		const raw = rawFeatures(stat);
		this.normalizer.observe(raw);
		const f = this.normalizer.normalize(raw);
		const h = computeHeuristic(f, this.weights, this.signs);
		this.evalState.candidateTotal = isNaN(this.evalState.candidateTotal)
			? h
			: this.evalState.candidateTotal + h;
	}

	private finalizeEval(): void {
		const e = this.evalState!;
		if (e.rebase) {
			// Refresh the incumbent's score (and the tracked best) under the new
			// settings. The param is unchanged; only its measured score updates.
			this.incumbentTotal = e.candidateTotal;
			this.best = clone(this.incumbent);
			this.bestScore = e.candidateTotal;
			this.lastEpisodeMean = e.candidateTotal / Math.max(1, this.N);
			this.evalState = null;
			return;
		}
		const improved = isNaN(this.incumbentTotal) || e.candidateTotal > this.incumbentTotal;
		this.lastEpisodeMean = e.candidateTotal / Math.max(1, this.N);
		const isCont = CONT_DIMS.some((d) => d.key === e.dimKey);
		if (improved) {
			this.incumbent = clone(e.candidate);
			this.incumbentTotal = e.candidateTotal;
			if (e.candidateTotal > this.bestScore) {
				this.best = clone(e.candidate);
				this.bestScore = e.candidateTotal;
			}
			this.noImproveInSweep = false;
			this.converged = false;
			if (isCont) this.steps[e.dimKey] = Math.min(this.steps[e.dimKey] * 1.2, contInit(e.dimKey) * 4);
			this.advanceCursor();
		} else {
			this.saveRestore.restore(e.saved);
			if (isCont) {
				const st = this.dimState[e.dimKey] ?? { dir: "+", bothTried: false };
				if (e.dir === "+" && !st.bothTried) {
					this.dimState[e.dimKey] = { dir: "-", bothTried: true };
				} else {
					this.steps[e.dimKey] = this.steps[e.dimKey] * 0.5;
					this.dimState[e.dimKey] = { dir: "+", bothTried: false };
					this.advanceCursor();
				}
			} else {
				this.advanceCursor();
			}
		}
		this.evalState = null;
	}

	private beginEval(): void {
		const dim = this.currentDim();
		const candidate = clone(this.incumbent);
		let dir: "+" | "-" | "flip";
		if (typeof dim === "string") {
			dir = "flip";
			(candidate as unknown as Record<string, unknown>)[dim] = !(this.incumbent as unknown as Record<string, unknown>)[dim];
		} else {
			const st = this.dimState[dim.key] ?? { dir: "+" as const, bothTried: false };
			dir = st.dir;
			const step = this.steps[dim.key];
			const raw = (this.incumbent as unknown as Record<string, number>)[dim.key] + (dir === "+" ? step : -step);
			(candidate as unknown as Record<string, number>)[dim.key] = Math.min(dim.max, Math.max(dim.min, raw));
		}
		const saved = this.saveRestore.save();
		this.evalState = {
			dimKey: typeof dim === "string" ? dim : dim.key,
			dir,
			candidate,
			saved,
			candidateTotal: NaN,
			chunksLeft: this.N,
		};
	}

	private currentDim(): Dim {
		const availableCont = CONT_DIMS.filter((d) => !this.lockedParams.has(d.key));
		const availableBool = BOOL_KEYS.filter((k) => !this.lockedParams.has(k));
		const total = availableCont.length + availableBool.length;
		if (total === 0) return CONT_DIMS[0];
		const i = this.cursor % total;
		return i < availableCont.length ? availableCont[i] : availableBool[i - availableCont.length];
	}

	private advanceCursor(): void {
		const availableCont = CONT_DIMS.filter((d) => !this.lockedParams.has(d.key));
		const availableBool = BOOL_KEYS.filter((k) => !this.lockedParams.has(k));
		const total = availableCont.length + availableBool.length;
		const prev = this.cursor;
		this.cursor = (this.cursor + 1) % total;
		if (this.cursor < prev) {
			const allExhausted = availableCont.every((d) => this.steps[d.key] <= contInit(d.key) * this.minStepFactor);
			if (this.noImproveInSweep && allExhausted) {
				this.converged = true;
				for (const d of availableCont) this.steps[d.key] = contInit(d.key);
				this.dimState = {};
			}
			this.noImproveInSweep = true;
		}
	}

	snapshot(): OptimizerSnapshot {
		return {
			running: this.running,
			converged: this.converged,
			incumbent: clone(this.incumbent),
			incumbentScore: isNaN(this.incumbentTotal) ? 0 : this.incumbentTotal,
			best: clone(this.best),
			bestScore: this.bestScore === -Infinity ? 0 : this.bestScore,
			eval: this.evalState
				? {
						dimKey: this.evalState.dimKey,
						dir: this.evalState.dir,
						candidate: clone(this.evalState.candidate),
						candidateScore: (() => {
							const c = isNaN(this.evalState!.candidateTotal) ? this.incumbentTotal : this.evalState!.candidateTotal;
							return isNaN(c) ? 0 : c;
						})(),
						chunksLeft: this.evalState.chunksLeft,
						chunksPerEval: this.N,
					}
				: null,
			lastEpisodeMean: this.lastEpisodeMean,
			steps: { ...this.steps },
		};
	}
}
