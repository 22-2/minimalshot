import { describe, expect, it } from "vitest";

import { isMeaningfulSelection, rectFromPoints, toImagePixels } from "../../src/lib/region";

describe("rectFromPoints", () => {
  it("normalizes drags in any direction", () => {
    expect(rectFromPoints({ x: 50, y: 40 }, { x: 10, y: 100 })).toEqual({
      x: 10,
      y: 40,
      width: 40,
      height: 60,
    });
  });
});

describe("toImagePixels", () => {
  it("scales CSS pixels to physical pixels", () => {
    expect(toImagePixels({ x: 10, y: 20, width: 30, height: 40 }, 1.5, 1.5)).toEqual({
      x: 15,
      y: 30,
      width: 45,
      height: 60,
    });
  });

  it("keeps the far edge aligned when rounding", () => {
    const rect = toImagePixels({ x: 1, y: 1, width: 1, height: 1 }, 1.25, 1.25);
    expect(rect.x + rect.width).toBe(Math.round(2 * 1.25));
  });
});

describe("isMeaningfulSelection", () => {
  it("ignores clicks without drag", () => {
    expect(isMeaningfulSelection({ x: 0, y: 0, width: 1, height: 50 })).toBe(false);
    expect(isMeaningfulSelection({ x: 0, y: 0, width: 2, height: 2 })).toBe(true);
  });
});
