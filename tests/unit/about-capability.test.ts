import { describe, expect, it } from "vitest";

import capability from "../../src-tauri/capabilities/default.json";

describe("About window permissions", () => {
  it("allows its custom title bar to drag and close the window", () => {
    expect(capability.windows).toContain("about");
    expect(capability.permissions).toEqual(expect.arrayContaining([
      "core:window:allow-start-dragging",
      "core:window:allow-close",
    ]));
  });
});
