import { describe, expect, it } from "vitest";

import ja from "../../src/locales/ja.json";
import { t } from "../../src/i18n";

function leaves(node: unknown, prefix = ""): [string, unknown][] {
  if (typeof node !== "object" || node === null) return [[prefix, node]];
  return Object.entries(node).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
}

describe("i18n", () => {
  it("resolves nested keys", () => {
    expect(t("viewer.save")).toBe("保存");
  });

  it("has only non-empty strings", () => {
    for (const [key, value] of leaves(ja)) {
      expect(typeof value, key).toBe("string");
      expect((value as string).length, key).toBeGreaterThan(0);
    }
  });
});
