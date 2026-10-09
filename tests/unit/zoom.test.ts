import { describe, expect, it } from "vitest";

import { approach, clampView, fitView, isSettled, MAX_SCALE, wheelFactor, zoomAt } from "../../src/lib/zoom";

const stage = { width: 400, height: 300 };

describe("fitView", () => {
  it("never upscales small images and centers them", () => {
    expect(fitView({ width: 200, height: 100 }, stage)).toEqual({ scale: 1, x: 100, y: 100 });
  });

  it("shrinks large images to fit", () => {
    expect(fitView({ width: 800, height: 300 }, stage)).toEqual({ scale: 0.5, x: 0, y: 75 });
  });
});

describe("zoomAt", () => {
  it("keeps the pixel under the cursor in place", () => {
    const view = { scale: 1, x: 10, y: 20 };
    const at = { x: 110, y: 70 };
    const zoomed = zoomAt(view, 2, at);
    const before = { x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale };
    const after = { x: (at.x - zoomed.x) / zoomed.scale, y: (at.y - zoomed.y) / zoomed.scale };
    expect(after).toEqual(before);
  });

  it("clamps to the maximum scale", () => {
    expect(zoomAt({ scale: 30, x: 0, y: 0 }, 10, { x: 0, y: 0 }).scale).toBe(MAX_SCALE);
  });

  it("zooms in and out symmetrically", () => {
    expect(wheelFactor(-100) * wheelFactor(100)).toBeCloseTo(1);
    expect(wheelFactor(-100)).toBeGreaterThan(1);
  });
});

describe("clampView", () => {
  it("centers an axis that fits and stops gaps on one that overflows", () => {
    const view = clampView({ scale: 2, x: 50, y: 999 }, { width: 400, height: 100 }, stage);
    expect(view).toEqual({ scale: 2, x: 0, y: 50 });
  });
});

describe("approach", () => {
  it("converges regardless of frame timing", () => {
    const start = { scale: 1, x: 0, y: 0 };
    const goal = { scale: 4, x: -100, y: -50 };
    let fast = start;
    for (let i = 0; i < 30; i++) fast = approach(fast, goal, 8);
    const slow = approach(approach(start, goal, 120), goal, 120);
    expect(fast.scale).toBeCloseTo(slow.scale, 5);
    expect(isSettled(approach(start, goal, 1000), goal)).toBe(true);
  });
});
