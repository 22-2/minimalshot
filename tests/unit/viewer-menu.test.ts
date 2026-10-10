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
  setPinned: vi.fn(),
  actualSize: vi.fn(),
});

const ids = (entries: MenuEntry[]) => entries.map((e) => e.id);
const tools = [{ name: "ペイント", command: "mspaint.exe", args: '"${file}"', hide_console: false, copy_stdout: false }];
const subEntries = (menu: MenuEntry[]) => {
  const sub = menu.find((e) => e.id === "open-with");
  return sub?.type === "sub" ? sub.entries : [];
};
const quickActions = (menu: MenuEntry[]) => {
  const row = menu.find((entry) => entry.id === "quick-actions");
  return row?.type === "icon-row" ? row.entries : [];
};

describe("viewerMenu", () => {
  it("hides saved-only actions until the shot is saved", () => {
    const menu = viewerMenu({ saved: false, pinned: false, tools }, actions());
    expect(ids(menu)).toEqual([
      "quick-actions",
      "sep-quick",
      "save",
      "save-as",
      "open-with",
      "sep-view",
      "actual-size",
      "pin",
      "settings",
    ]);
    expect(quickActions(menu)).toMatchObject([
      { id: "copy-image" },
      { id: "copy-path", disabled: true },
      { id: "delete", disabled: true },
    ]);
  });

  it("adds delete and reveal once saved", () => {
    const menu = viewerMenu({ saved: true, pinned: false, tools }, actions());
    expect(ids(menu)).toEqual([
      "quick-actions",
      "sep-quick",
      "save",
      "save-as",
      "open-with",
      "reveal",
      "sep-view",
      "actual-size",
      "pin",
      "settings",
    ]);
    expect(quickActions(menu)[2]).toMatchObject({ danger: true, disabled: false });
  });

  it("reflects and toggles always-on-top", () => {
    const handlers = actions();
    const pin = viewerMenu({ saved: false, pinned: true, tools }, handlers).find((e) => e.id === "pin");
    expect(pin).toMatchObject({ type: "check", checked: true });
    if (pin?.type === "check") pin.onCheckedChange(false);
    expect(handlers.setPinned).toHaveBeenCalledWith(false);
  });

  it("returns to the source image size", () => {
    const handlers = actions();
    const actualSize = viewerMenu({ saved: false, pinned: false, tools }, handlers).find((entry) => entry.id === "actual-size");
    if (actualSize?.type === "item") actualSize.onSelect();
    expect(handlers.actualSize).toHaveBeenCalled();
  });

  it("lists registered tools in the submenu", () => {
    const handlers = actions();
    const [first] = subEntries(viewerMenu({ saved: false, pinned: false, tools }, handlers));
    expect(first).toMatchObject({ label: "ペイント" });
    if (first.type === "item") first.onSelect();
    expect(handlers.openWith).toHaveBeenCalledWith(0);
  });

  it("points to settings when no tools are registered", () => {
    const handlers = actions();
    const [only] = subEntries(viewerMenu({ saved: false, pinned: false, tools: [] }, handlers));
    expect(only).toMatchObject({ id: "no-tools" });
    if (only.type === "item") only.onSelect();
    expect(handlers.openSettings).toHaveBeenCalled();
  });
});
