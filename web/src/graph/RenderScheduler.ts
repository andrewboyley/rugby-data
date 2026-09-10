import type { SceneRendererPort } from "../scene/scene";

export type RenderDirtyFlag = "timeline" | "scene" | "layout" | "camera" | "overlays";

export type RenderWork = Readonly<{
  now: number;
  seekTime: number | null;
  dirty: ReadonlySet<RenderDirtyFlag>;
}>;

type FrameClock = Readonly<{
  schedule(callback: (now: number) => void): number;
  cancel(handle: number): void;
}>;

export type RenderSchedulerOptions = Readonly<{
  renderer: Pick<SceneRendererPort, "render">;
  process(work: RenderWork): void;
  clock?: FrameClock;
}>;

const animationFrameClock: FrameClock = {
  schedule: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** Coalesces scene work and is the sole caller of the renderer's render method. */
export class RenderScheduler {
  private readonly clock: FrameClock;
  private readonly dirty = new Set<RenderDirtyFlag>();
  private frame: number | null = null;
  private pendingSeekTime: number | null = null;

  constructor(private readonly options: RenderSchedulerOptions) {
    this.clock = options.clock ?? animationFrameClock;
  }

  requestSeek(time: number): void {
    this.pendingSeekTime = time;
    this.dirty.add("timeline");
    this.schedule();
  }

  invalidate(...flags: readonly RenderDirtyFlag[]): void {
    for (const flag of flags) this.dirty.add(flag);
    this.schedule();
  }

  dispose(): void {
    if (this.frame !== null) this.clock.cancel(this.frame);
    this.frame = null;
    this.pendingSeekTime = null;
    this.dirty.clear();
  }

  private schedule(): void {
    if (this.frame !== null) return;
    this.frame = this.clock.schedule((now) => this.renderFrame(now));
  }

  private renderFrame(now: number): void {
    this.frame = null;
    const work: RenderWork = Object.freeze({
      now,
      seekTime: this.pendingSeekTime,
      dirty: new Set(this.dirty),
    });
    this.pendingSeekTime = null;
    this.dirty.clear();
    this.options.process(work);
    this.options.renderer.render();
  }
}
