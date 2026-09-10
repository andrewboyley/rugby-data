import type { FA2Params, FA2ParamKey } from "./graph/layout-optimizer";
import type { StrictBestApplicationRecord, TrainingSessionSnapshot } from "./graph/training-session";
import type { EdgeDisplayData, NodeDisplayData } from "sigma/types";

export type TestBenchPosition = Readonly<{ readonly x: number; readonly y: number }>;

export type TestBenchApplication = Readonly<{
  readonly record: StrictBestApplicationRecord;
  readonly liveSettings: FA2Params;
  readonly resetPositions: Readonly<Record<string, TestBenchPosition>>;
  readonly resetMetricCount: number;
  readonly resetTrailSegments: number;
}>;

export type TestBenchState = Readonly<{
  readonly live: Readonly<{
    readonly settings: FA2Params;
    readonly ticks: number;
    readonly positions: Readonly<Record<string, TestBenchPosition>>;
    readonly trailSegments: number;
  }>;
  readonly training: Readonly<{
    readonly session: TrainingSessionSnapshot;
    readonly calibrationSteps: number;
    readonly scoredTrials: number;
  }>;
  readonly locks: readonly FA2ParamKey[];
  readonly policyResetGeneration: number;
  readonly strictBestApplication: TestBenchApplication | null;
  readonly graph: Readonly<{
    readonly liveIdentity: string | null;
    readonly trialIdentity: string | null;
    readonly environmentsDistinct: boolean;
  }>;
}>;

export type TestBenchVisuals = Readonly<{
  readonly nodes: readonly Readonly<{
    readonly attributes: Readonly<Record<string, unknown>>;
    readonly display: NodeDisplayData | null;
  }>[];
  readonly edges: readonly Readonly<{
    readonly attributes: Readonly<Record<string, unknown>>;
    readonly display: EdgeDisplayData | null;
  }>[];
  readonly trailSegments: number;
}>;

export interface RugbyTestBench {
  state(): TestBenchState;
  visuals(): TestBenchVisuals;
}

declare global {
  interface Window {
    __rugbyTestBench?: RugbyTestBench;
    __sigmaV4Compatibility?: {
      selected(): string | null;
      state(node: string): { selected?: boolean };
      nodeViewport(node: string): { x: number; y: number };
      dispose(): void;
    };
  }
}
