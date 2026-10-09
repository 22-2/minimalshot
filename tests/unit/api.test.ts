import { describe, expect, it } from "vitest";

import { toBytes } from "../../src/lib/api";

describe("toBytes", () => {
  it("accepts every shape the IPC layer may return", () => {
    const expected = new Uint8Array([137, 80, 78, 71]);
    expect(toBytes(expected.buffer.slice(0))).toEqual(expected);
    expect(toBytes(new Uint8Array(expected))).toEqual(expected);
    expect(toBytes([137, 80, 78, 71])).toEqual(expected);
  });
});
