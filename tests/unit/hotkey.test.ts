import { describe, expect, it } from "vitest";

import { duplicatedHotkeys, hotkeyFromEvent, hotkeyIdentity } from "../../src/lib/hotkey";

const key = (code: string, key: string, mods: Partial<Record<"ctrlKey" | "shiftKey" | "altKey" | "metaKey", boolean>> = {}) => ({
  code,
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("hotkeyFromEvent", () => {
  it("formats modifiers in a fixed order and strips code prefixes", () => {
    expect(hotkeyFromEvent(key("KeyZ", "Z", { shiftKey: true, ctrlKey: true }))).toBe("Ctrl+Shift+Z");
    expect(hotkeyFromEvent(key("Digit1", "!", { altKey: true }))).toBe("Alt+1");
    expect(hotkeyFromEvent(key("PrintScreen", "PrintScreen", { metaKey: true }))).toBe("Win+PrintScreen");
  });

  it("waits for a non-modifier key combined with a modifier", () => {
    expect(hotkeyFromEvent(key("ControlLeft", "Control", { ctrlKey: true }))).toBeNull();
    expect(hotkeyFromEvent(key("PrintScreen", "PrintScreen"))).toBeNull();
  });
});

describe("hotkey identity", () => {
  it("ignores case, order, and aliases", () => {
    expect(hotkeyIdentity("shift+ctrl+z")).toBe(hotkeyIdentity("Ctrl+Shift+KeyZ"));
    expect(hotkeyIdentity("Win+S")).toBe(hotkeyIdentity("super+s"));
  });

  it("finds shortcuts assigned more than once", () => {
    const duplicates = duplicatedHotkeys([["Ctrl+PrintScreen", ""], ["ctrl+printscreen"], ["Shift+PrintScreen", ""]]);
    expect([...duplicates]).toEqual([hotkeyIdentity("Ctrl+PrintScreen")]);
  });
});
