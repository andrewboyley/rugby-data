import { expect, test } from "@playwright/test";
import { RenderScheduler, type RenderWork } from "../src/graph/RenderScheduler";

type ScheduledFrame = Readonly<{ callback: (now: number) => void }>;

function createClock(): {
  frames: ScheduledFrame[];
  clock: { schedule(callback: (now: number) => void): number; cancel(handle: number): void };
} {
  const frames: ScheduledFrame[] = [];
  return {
    frames,
    clock: {
      schedule: (callback) => {
        frames.push({ callback });
        return frames.length;
      },
      cancel: (handle) => {
        frames.splice(handle - 1, 1);
      },
    },
  };
}

test("coalesces rapid seeks into newest command and renders once per frame", () => {
  const { clock, frames } = createClock();
  const work: RenderWork[] = [];
  let renders = 0;
  const scheduler = new RenderScheduler({
    clock,
    process: (frame) => work.push(frame),
    renderer: { render: () => { renders += 1; } },
  });

  scheduler.requestSeek(100);
  scheduler.requestSeek(200);
  scheduler.requestSeek(300);
  scheduler.invalidate("scene", "layout");

  expect(frames).toHaveLength(1);
  frames[0]!.callback(16);

  expect(renders).toBe(1);
  expect(work).toHaveLength(1);
  expect(work[0]!.seekTime).toBe(300);
  expect(work[0]!.dirty).toEqual(new Set(["timeline", "scene", "layout"]));
});

test("carries all dirty flags into one frame and schedules follow-up work separately", () => {
  const { clock, frames } = createClock();
  const work: RenderWork[] = [];
  let renders = 0;
  let scheduler: RenderScheduler;
  scheduler = new RenderScheduler({
    clock,
    process: (frame) => {
      work.push(frame);
      if (work.length === 1) scheduler.invalidate("scene");
    },
    renderer: { render: () => { renders += 1; } },
  });

  scheduler.invalidate("scene", "layout", "camera", "overlays");
  frames[0]!.callback(16);

  expect(renders).toBe(1);
  expect(work[0]!.dirty).toEqual(new Set(["scene", "layout", "camera", "overlays"]));
  expect(frames).toHaveLength(2);

  frames[1]!.callback(32);
  expect(renders).toBe(2);
  expect(work[1]!.dirty).toEqual(new Set(["scene"]));
});

test("cancels pending work on disposal", () => {
  const { clock, frames } = createClock();
  let renders = 0;
  const scheduler = new RenderScheduler({
    clock,
    process: () => {},
    renderer: { render: () => { renders += 1; } },
  });

  scheduler.requestSeek(100);
  scheduler.dispose();

  expect(frames).toHaveLength(0);
  expect(renders).toBe(0);
});
