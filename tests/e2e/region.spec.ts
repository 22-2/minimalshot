import { expect, test } from "@playwright/test";

import { calls, commandNames, installTauriMock } from "./tauri-mock";

test.describe("region selection", () => {
  test("sends the dragged rectangle in image pixels", async ({ page }) => {
    await installTauriMock(page, { label: "region" });
    await page.goto("/");
    await expect(page.locator(".region-image")).toBeVisible();
    await expect(page.getByText("ドラッグで範囲を選択")).toBeVisible();
    // 最初に見える画像は事前描画用の場合がある。撮影セッションの表示完了を待つ。
    await expect.poll(() => commandNames(page)).toContain("show_window");

    await page.mouse.move(300, 200);
    await page.mouse.down();
    await page.mouse.move(100, 50, { steps: 4 });
    await expect(page.getByTestId("region-selection")).toContainText("200 × 150");
    await page.mouse.up();

    await expect.poll(() => commandNames(page)).toContain("finish_region");
    const finish = (await calls(page)).find((c) => c.cmd === "finish_region");
    expect(finish?.args.rect).toEqual({ x: 100, y: 50, width: 200, height: 150 });
  });

  test("ignores a click without dragging", async ({ page }) => {
    await installTauriMock(page, { label: "region" });
    await page.goto("/");
    await expect(page.locator(".region-image")).toBeVisible();

    await page.mouse.click(400, 300);
    expect(await commandNames(page)).not.toContain("finish_region");
  });

  test("cancels with Escape", async ({ page }) => {
    await installTauriMock(page, { label: "region" });
    await page.goto("/");
    await expect(page.locator(".region-image")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect.poll(() => commandNames(page)).toContain("cancel_region");
  });
});
