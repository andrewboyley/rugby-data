import type { FA2Params } from "./layout-optimizer";
import type { StrictBestEvent } from "./rl-bandit";

const MAX_RECORDED_REWARDS = 10;

export type TrainingExecutionState = "idle" | "active" | "paused";

export type StrictBestApplicationRecord = {
  readonly sequence: number;
  readonly reward: number;
  readonly params: FA2Params;
  readonly appliedSettings: FA2Params;
  readonly settingsChangeSummary: readonly string[];
  readonly timestamp: string;
};

export type TrainingSessionSnapshot = {
  readonly autoTune: { readonly enabled: boolean };
  readonly execution: { readonly state: TrainingExecutionState };
  readonly policy: { readonly resets: number };
  readonly latestReward: number | null;
  readonly recentRewards: readonly number[];
  readonly strictBestApplication: StrictBestApplicationRecord | null;
};

export interface TrainingPolicy {
  reset(initial: FA2Params, locked: Set<keyof FA2Params>): void;
}

export type TrainingSessionOptions = {
  readonly initialParams: FA2Params;
  readonly lockedParams?: ReadonlySet<keyof FA2Params>;
  readonly policy: TrainingPolicy;
};

export class TrainingSessionModel {
  private readonly initialParams: FA2Params;
  private readonly lockedParams: ReadonlySet<keyof FA2Params>;
  private readonly policy: TrainingPolicy;
  private autoTuneEnabled = false;
  private executionState: TrainingExecutionState = "idle";
  private policyResets = 0;
  private sequence = 0;
  private latestScoredReward: number | null = null;
  private recentScoredRewards: number[] = [];
  private latestApplication: StrictBestApplicationRecord | null = null;

  constructor(options: TrainingSessionOptions) {
    this.initialParams = { ...options.initialParams };
    this.lockedParams = new Set(options.lockedParams);
    this.policy = options.policy;
  }

  enableAutoTune(): void {
    this.autoTuneEnabled = true;
  }

  disableAutoTune(): void {
    this.autoTuneEnabled = false;
    this.executionState = "idle";
  }

  startTraining(): void {
    if (this.autoTuneEnabled) this.executionState = "active";
  }

  pauseTraining(): void {
    if (this.executionState === "active") this.executionState = "paused";
  }

  resumeTraining(): void {
    if (this.autoTuneEnabled && this.executionState === "paused") this.executionState = "active";
  }

  recordTrial(reward: number | null): void {
    if (reward === null || !Number.isFinite(reward)) return;
    this.latestScoredReward = reward;
    this.recentScoredRewards = [...this.recentScoredRewards, reward].slice(-MAX_RECORDED_REWARDS);
  }

  recordStrictBestApplication(event: StrictBestEvent, timestamp: string, previousSettings: FA2Params = event.params): StrictBestApplicationRecord | null {
    if (!Number.isFinite(event.reward)) return null;
    this.sequence += 1;
    const settingsChangeSummary = (Object.keys(event.params) as Array<keyof FA2Params>).filter((key) => event.params[key] !== previousSettings[key]).map((key) => String(key));
    this.latestApplication = {
      sequence: this.sequence,
      reward: event.reward,
      params: { ...event.params },
      appliedSettings: { ...event.params },
      settingsChangeSummary,
      timestamp,
    };
    return this.cloneApplication(this.latestApplication);
  }

  confirmReset(): void {
    this.policy.reset({ ...this.initialParams }, new Set(this.lockedParams));
    this.autoTuneEnabled = false;
    this.executionState = "idle";
    this.policyResets += 1;
    this.latestScoredReward = null;
    this.recentScoredRewards = [];
    this.latestApplication = null;
  }

  snapshot(): TrainingSessionSnapshot {
    return {
      autoTune: { enabled: this.autoTuneEnabled },
      execution: { state: this.executionState },
      policy: { resets: this.policyResets },
      latestReward: this.latestScoredReward,
      recentRewards: [...this.recentScoredRewards],
      strictBestApplication: this.latestApplication === null ? null : this.cloneApplication(this.latestApplication),
    };
  }

  private cloneApplication(application: StrictBestApplicationRecord): StrictBestApplicationRecord {
    return { ...application, params: { ...application.params }, appliedSettings: { ...application.appliedSettings }, settingsChangeSummary: [...application.settingsChangeSummary] };
  }
}
