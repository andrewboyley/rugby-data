import type Sigma from "sigma";
import type Graph from "graphology";
import { PersistentForceAtlas2 } from "./graph/PersistentForceAtlas2";
import { createTemporalSupergraph } from "./graph/TemporalSupergraph";
import { MatchTimeline } from "./temporal/MatchTimeline";
import { TemporalIndex } from "./temporal/TemporalIndex";
import type { DatasetLike } from "./temporal/types";

export type TimelineLayout = Readonly<{
  identity: number;
  topologyReloads: number;
  start: () => void;
  kill: () => void;
}>;

export class TimelineController {
  readonly timeline: MatchTimeline;
  readonly temporalIndex: TemporalIndex;
  readonly graph: Graph;
  readonly layout: TimelineLayout;
  private renderer: Sigma | null = null;
  private frame: number | null = null;
  private lastFrame = 0;
  private playing = false;
  private speed = 1;
  private playbackEnd: number | null = null;
  private seekFrame: number | null = null;
  private pendingSeekTime: number | null = null;
  private seekRequestCount = 0;
  private seekApplyCount = 0;

  constructor(dataset: DatasetLike, private readonly onChange: (time: number) => void = () => {}, private readonly onPlayingChange: (playing: boolean) => void = () => {}, initialPosition: "min" | "max" = "min", createLayout: (graph: Graph) => TimelineLayout = (graph) => new PersistentForceAtlas2(graph)) {
    this.timeline = MatchTimeline.fromDataset(dataset);
    this.temporalIndex = new TemporalIndex(this.timeline);
    this.graph = createTemporalSupergraph(dataset, this.temporalIndex).graph;
    this.layout = createLayout(this.graph);
    this.seek(initialPosition === "max" ? this.timeline.dateMax ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY);
    this.layout.start();
  }

  get currentTime(): number { return this.temporalIndex.currentTime; }
  get activeNodeCount(): number { return this.temporalIndex.activeNodeCount; }
  get activeEdgeCount(): number { return this.temporalIndex.activeEdgeCount; }
  get seekRequests(): number { return this.seekRequestCount; }
  get seekApplies(): number { return this.seekApplyCount; }
  attachRenderer(renderer: Sigma): void { this.renderer = renderer; }
  requestSeek(time: number): void {
    this.seekRequestCount += 1;
    this.pendingSeekTime = time;
    if (this.seekFrame !== null) return;
    this.seekFrame = requestAnimationFrame(() => {
      this.seekFrame = null;
      const pendingTime = this.pendingSeekTime;
      this.pendingSeekTime = null;
      if (pendingTime === null) return;
      this.seekApplyCount += 1;
      this.seek(pendingTime);
    });
  }
  seek(time: number): void {
    this.cancelPendingSeek();
    this.temporalIndex.seek(time);
    this.renderer?.refresh();
    this.onChange(this.currentTime);
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
  dispose(): void { this.pause(); this.cancelPendingSeek(); this.layout.kill(); this.renderer = null; }

  private cancelPendingSeek(): void {
    if (this.seekFrame !== null) cancelAnimationFrame(this.seekFrame);
    this.seekFrame = null;
    this.pendingSeekTime = null;
  }

  private tick(now: number): void {
    if (!this.playing) return;
    const max = this.playbackEnd;
    if (max == null) return this.pause();
    const current = this.currentTime === Number.NEGATIVE_INFINITY ? this.timeline.dateMin ?? max : this.currentTime;
    const target = Math.min(max, current + (now - this.lastFrame) * 86_400 * this.speed);
    this.lastFrame = now;
    this.seek(target);
    if (target >= max) this.pause(); else this.frame = requestAnimationFrame((time) => this.tick(time));
  }
}
