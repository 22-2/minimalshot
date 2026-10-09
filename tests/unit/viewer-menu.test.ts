import { describe, expect, it, vi } from "vitest";

import { viewerMenu, type MenuEntry, type ViewerActions } from "../../src/lib/viewerMenu";

const actions = (): ViewerActions => ({
  copyPath: vi.fn(),
  copyImage: vi.fn(),
  save: vi.fn(),
  saveAs: vi.fn(),
  deleteSaved: vi.fn(),
  openWith: vi.fn(),
  reveal: vi.fn(),
  openSettings: vi.fn(),
});

const ids = (entries: MenuEntry[]) => entries.map((e) => e.id);
const tools = [{ name: "ペイント", command: "mspaint.exe", args: '"${file}"' }];

describe("viewerMenu", () => {
  it("hides saved-only actions until the shot is saved", () => {
    const menu = viewerMenu({ saved: false, tools }, actions());
    expect(ids(menu.context)).toEqual([
      "copy-path",
      "copy-image",
      "save",
      "save-as",
      "sep-open",
      "open-with",
      "sep-settings",
      "settings",
    ]);
    expect(menu.copy[0]).toMatchObject({ id: "copy-path", disabled: true });
  });

  it("adds delete and reveal once saved", () => {
    const menu = viewerMenu({ saved: true, tools }, actions());
    expect(ids(menu.context)).toEqual([
      "copy-path",
      "copy-image",
      "save",
      "save-as",
      "delete",
      "sep-open",
      "open-with",
      "reveal",
      "sep-settings",
      "settings",
    ]);
    expect(menu.context.find((e) => e.id === "delete")).toMatchObject({ danger: true });
  });

  it("shares the tool entries between the submenu and the toolbar", () => {
    const handlers = actions();
    const menu = viewerMenu({ saved: false, tools }, handlers);
    const sub = menu.context.find((e) => e.id === "open-with");
    expect(sub).toMatchObject({ type: "sub", entries: menu.openWith });
    const first = menu.openWith[0];
    if (first.type === "item") first.onSelect();
    expect(handlers.openWith).toHaveBeenCalledWith(0);
  });

  it("points to settings when no tools are registered", () => {
    const handlers = actions();
    const [only] = viewerMenu({ saved: false, tools: [] }, handlers).openWith;
    expect(only).toMatchObject({ id: "no-tools" });
    if (only.type === "item") only.onSelect();
    expect(handlers.openSettings).toHaveBeenCalled();
  });
});
