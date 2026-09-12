import type Graph from "graphology";
import {
  PersistentForceAtlas2,
  type PositionSnapshot,
} from "./graph/PersistentForceAtlas2";
import type { RenderScheduler } from "./graph/RenderScheduler";
import {
  createAllTimeLayoutTopology,
  createTemporalSupergraph,
} from "./graph/TemporalSupergraph";
import { MatchTimeline } from "./temporal/MatchTimeline";
import { TemporalIndex } from "./temporal/TemporalIndex";
import type { DatasetLike } from "./temporal/types";

export type TimelineLayout = Readonly<{
  identity: number;
  topologyReloads: number;
  start: () => void;
  kill: () => void;
  subscribe?: (listener: (snapshot: PositionSnapshot) => void) => () => void;
}>;

export class TimelineController {
  readonly timeline: MatchTimeline;
  readonly temporalIndex: TemporalIndex;
  readonly graph: Graph;
  readonly layout: TimelineLayout;
  private scheduler: Pick<RenderScheduler, "invalidate" | "requestSeek"> | null = null;
  private frame: number | null = null;
  private lastFrame = 0;
  private playing = false;
  private speed = 1;
  private playbackEnd: number | null = null;
  private seekRequestCount = 0;
  private seekApplyCount = 0;

  constructor(dataset: DatasetLike, private readonly onChange: (time: number) => void = () => {}, private readonly onPlayingChange: (playing: boolean) => void = () => {}, initialPosition: "min" | "max" = "min", createLayout: (graph: Graph) => TimelineLayout = (graph) => new PersistentForceAtlas2(graph)) {
    this.timeline = MatchTimeline.fromDataset(dataset);
    this.temporalIndex = new TemporalIndex(this.timeline);
    this.graph = createTemporalSupergraph(dataset, this.temporalIndex).graph;
    this.layout = createLayout(
      createAllTimeLayoutTopology(dataset, this.temporalIndex).graph,
    );
    this.applySeek(initialPosition === "max" ? this.timeline.dateMax ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY);
    // ForceAtlas2 cannot move a zero- or one-node graph. Avoid starting its
    // worker, which would otherwise continuously publish identical positions.
    if (this.graph.order > 1) this.layout.start();
  }

  get currentTime(): number { return this.temporalIndex.currentTime; }
  get activeNodeCount(): number { return this.temporalIndex.activeNodeCount; }
  get activeEdgeCount(): number { return this.temporalIndex.activeEdgeCount; }
  get seekRequests(): number { return this.seekRequestCount; }
  get seekApplies(): number { return this.seekApplyCount; }
  attachRenderScheduler(scheduler: Pick<RenderScheduler, "invalidate" | "requestSeek">): void {
    this.scheduler = scheduler;
  }
  requestSeek(time: number): void {
    this.seekRequestCount += 1;
    if (this.scheduler) {
      this.scheduler.requestSeek(time);
      return;
    }
    this.seekApplyCount += 1;
    this.applySeek(time);
  }
  seek(time: number): void {
    this.applySeek(time);
    this.scheduler?.invalidate("timeline");
  }
  applySeek(time: number): void {
    this.temporalIndex.seek(time);
    this.onChange(this.currentTime);
  }
  applyScheduledSeek(time: number): void {
    this.seekApplyCount += 1;
    this.applySeek(time);
  }
  /** Seek an existing simulation to either UI initial state without replacing it. */
  reset(position: "min" | "max"): void {
    this.pause();
    this.seek(position === "max" ? this.timeline.dateMax ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY);
  }
  setSpeed(speed: number): void { this.speed = Math.max(0.01, speed); }
  play(endTime: number | null = this.timeline.dateMax): void {
    if (this.playing) return;
    this.playbackEnd = endTime;
    this.playing = true;
    this.onPlayingChange(true);
    this.lastFrame = performance.now();
    this.frame = requestAnimationFrame((time) => this.tick(time));
  }
  pause(): void { const wasPlaying = this.playing; this.playing = false; if (this.frame !== null) cancelAnimationFrame(this.frame); this.frame = null; if (wasPlaying) this.onPlayingChange(false); }
  isPlaying(): boolean { return this.playing; }
  dispose(): void { this.pause(); this.layout.kill(); this.scheduler = null; }

  private tick(now: number): void {
    if (!this.playing) return;
    const max = this.playbackEnd;
    if (max == null) return this.pause();
    const current = this.currentTime === Number.NEGATIVE_INFINITY ? this.timeline.dateMin ?? max : this.currentTime;
    // A speed of 1 advances one calendar day in 400 ms.
    const target = Math.min(max, current + (now - this.lastFrame) * 216_000 * this.speed);
    this.lastFrame = now;
    this.seek(target);
    if (target >= max) this.pause(); else this.frame = requestAnimationFrame((time) => this.tick(time));
  }
}
