import { describe, expect, it } from "vitest";

import { actualSizeView, approach, clampView, fitView, initialView, isSettled, MAX_SCALE, wheelFactor, zoomAt } from "../../src/lib/zoom";

const stage = { width: 400, height: 300 };

describe("fitView", () => {
  it("never upscales small images and centers them", () => {
    expect(fitView({ width: 200, height: 100 }, stage)).toEqual({ scale: 1, x: 100, y: 100 });
  });

  it("shrinks large images to fit", () => {
    expect(fitView({ width: 800, height: 300 }, stage)).toEqual({ scale: 0.5, x: 0, y: 75 });
  });
});

describe("initial and actual size", () => {
  it("opens an image at 66% with space around it", () => {
    expect(initialView({ width: 200, height: 100 }, stage)).toEqual({ scale: 0.66, x: 134, y: 117 });
  });

  it("fits large captures initially but restores 100% on request", () => {
    const image = { width: 800, height: 300 };
    expect(initialView(image, stage)).toEqual({ scale: 0.45, x: 20, y: 82.5 });
    expect(actualSizeView(image, stage)).toEqual({ scale: 1, x: -200, y: 0 });
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
  const image = { width: 400, height: 100 };

  it("leaves views inside the allowed range untouched", () => {
    const view = { scale: 2, x: -200, y: 60 };
    expect(clampView(view, image, stage)).toEqual(view);
  });

  it("lets an overflowing axis pan a little past the image edge", () => {
    // 幅 800 の画像を幅 400 のステージで見ている。余白は 400 * 0.25 = 100
    expect(clampView({ scale: 2, x: 999, y: 50 }, image, stage).x).toBe(100);
    expect(clampView({ scale: 2, x: -999, y: 50 }, image, stage).x).toBe(-500);
  });

  it("lets a fitting axis move around its centered position", () => {
    // 高さ 200 の画像を高さ 300 のステージで見ている。中央は 50、余白は 75
    expect(clampView({ scale: 2, x: 0, y: 999 }, image, stage).y).toBe(125);
    expect(clampView({ scale: 2, x: 0, y: -999 }, image, stage).y).toBe(-25);
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
