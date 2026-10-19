import { describe, expect, it } from "vitest";

import capability from "../../src-tauri/capabilities/default.json";

describe("Editor window permissions", () => {
  it("is covered by the default capability", () => {
    expect(capability.windows).toContain("editor-*");
  });
});

describe("About window permissions", () => {
  it("allows its custom title bar to drag and close the window", () => {
    expect(capability.windows).toContain("about");
    expect(capability.permissions).toEqual(expect.arrayContaining([
      "core:window:allow-start-dragging",
      "core:window:allow-close",
    ]));
  });
});
