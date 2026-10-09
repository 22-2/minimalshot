import { describe, expect, it } from "vitest";

import { resolveView } from "../../src/lib/route";

describe("resolveView", () => {
  it("maps window labels to views", () => {
    expect(resolveView("viewer-12")).toBe("viewer");
    expect(resolveView("region")).toBe("region");
    expect(resolveView("settings")).toBe("settings");
    expect(resolveView("about")).toBe("about");
  });
});
