import { expect, test } from "@playwright/test";

import { calls, commandNames, installTauriMock } from "./tauri-mock";

test.describe("region selection", () => {
  test("fades the guides after showing and still accepts a drag during the fade", async ({ page }) => {
    await installTauriMock(page, { label: "region", holdFirst: ["show_window"] });
    await page.goto("/");
    await expect.poll(() => commandNames(page)).toContain("show_window");
    const guides = page.locator(".region-guides");
    await expect(guides).toHaveCSS("opacity", "0");
    await expect(page.locator(".region-image")).toHaveCSS("opacity", "1");
    // 長いフェードで中間状態を検証し、待機中にも選択できることを確認する。
    await page.addStyleTag({ content: ":root { --duration-overlay: 10s; }" });
    await page.evaluate(() => {
      (window as unknown as { __release: (cmd: string) => void }).__release("show_window");
    });
    await page.waitForFunction(() => {
      const opacity = Number(getComputedStyle(document.querySelector(".region-guides")!).opacity);
      return opacity > 0 && opacity < 1;
    });
    await page.mouse.move(100, 50);
    await page.mouse.down();
    await page.mouse.move(300, 200);
    await expect(page.getByTestId("region-selection")).toContainText("200 × 150");
    await page.mouse.up();
    await expect.poll(() => commandNames(page)).toContain("finish_region");
    await expect(guides).toHaveCSS("opacity", "0");
  });

  test("replays the fade on reuse and ignores a canceled presentation", async ({ page }) => {
    await installTauriMock(page, { label: "region", holdFirst: ["show_window"] });
    await page.goto("/");
    await expect.poll(() => commandNames(page)).toContain("show_window");
    await page.keyboard.press("Escape");
    await expect.poll(() => commandNames(page)).toContain("cancel_region");
    await page.evaluate(() => {
      (window as unknown as { __release: (cmd: string) => void }).__release("show_window");
    });
    await expect(page.locator(".region")).toHaveAttribute("data-presented", "false");
    await expect(page.locator(".region-guides")).toHaveCSS("opacity", "0");

    for (const session of [2, 3]) {
      await page.evaluate((id) => {
        (window as unknown as { __emit: (event: string, payload: number) => void }).__emit("region-load", id);
      }, session);
      await expect(page.locator(".region")).toHaveAttribute("data-presented", "true");
      await expect(page.locator(".region-guides")).toHaveCSS("opacity", "1");
      await page.keyboard.press("Escape");
      await expect(page.locator(".region-guides")).toHaveCSS("opacity", "0");
    }
  });

  test("uses a shorter fade when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installTauriMock(page, { label: "region" });
    await page.goto("/");
    await expect(page.locator(".region")).toHaveAttribute("data-presented", "true");
    await expect(page.locator(".region-guides")).toHaveCSS("transition-duration", "0.1s");
    await expect(page.locator(".region-guides")).toHaveCSS("opacity", "1");
  });

  test("selects across a wide desktop and converts the preview to physical pixels", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 600 });
    await installTauriMock(page, { label: "region", regionImageSize: { width: 3200, height: 1200 } });
    await page.goto("/");
    await expect.poll(() => commandNames(page)).toContain("show_window");
    await page.mouse.move(600, 100);
    await page.mouse.down();
    await page.mouse.move(1200, 500, { steps: 4 });
    await expect(page.getByTestId("region-selection")).toContainText("1200 × 800");
    await page.mouse.up();
    await expect.poll(async () => (await calls(page)).find((c) => c.cmd === "finish_region")?.args.rect)
      .toEqual({ x: 1200, y: 200, width: 1200, height: 800 });
  });

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
