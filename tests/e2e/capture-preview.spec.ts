import { expect, test } from "@playwright/test";

import { calls, installTauriMock } from "./tauri-mock";

test("shows the image, opens it on click and cancels dismissal", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 264, height: 180 });
  await page.clock.install();
  await installTauriMock(page, { label: "capture-preview-1" });
  await page.goto("/");
  const preview = page.getByRole("button", { name: "撮影した画像を開く" });
  await expect(preview.locator("img")).toBeVisible();
  await expect(preview).toContainText("画像をコピーしました");
  await expect.poll(async () => (await calls(page)).some((call) => call.cmd === "show_capture_preview")).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("preview.png") });
  await preview.click();
  await expect.poll(async () => (await calls(page)).some((call) => call.cmd === "open_capture_preview")).toBe(true);
  await page.clock.fastForward(5000);
  expect((await calls(page)).some((call) => call.cmd === "plugin:window|close")).toBe(false);
});

test("fades and closes after a short preview", async ({ page }) => {
  await page.clock.install();
  await installTauriMock(page, { label: "capture-preview-2" });
  await page.goto("/");
  const preview = page.getByRole("button", { name: "撮影した画像を開く" });
  await expect.poll(async () => (await calls(page)).some((call) => call.cmd === "show_capture_preview")).toBe(true);
  await page.clock.fastForward(3100);
  await expect(preview).toHaveAttribute("data-fading", "true");
  await page.clock.fastForward(800);
  await expect.poll(async () => (await calls(page)).some((call) => call.cmd === "plugin:window|close")).toBe(true);
});

test("closes the preview with Ctrl+W", async ({ page }) => {
  await installTauriMock(page, { label: "capture-preview-ctrl-w" });
  await page.goto("/");
  await expect(page.locator(".capture-preview img")).toBeVisible();
  await page.keyboard.press("Control+w");
  await expect.poll(async () => (await calls(page)).some((call) => call.cmd === "plugin:window|close")).toBe(true);
});


test("shows completed save and copy results, including after delayed updates", async ({ page }) => {
  await installTauriMock(page, { label: "capture-preview-3", previewState: { id: 3, saved: false, copied: null, done: false, failed: false } });
  await page.goto("/");
  const preview = page.getByRole("button", { name: "撮影した画像を開く" });
  await expect(preview).toContainText("自動処理中…");
  await page.evaluate(() => (window as unknown as { __emit: (event: string, payload: unknown) => void }).__emit("capture-preview-actions", { id: 3, saved: true, copied: "path", done: true, failed: false }));
  await expect(preview).toContainText("保存しました");
  await expect(preview).toContainText("パスをコピーしました");
});

test("shows when neither action was performed", async ({ page }) => {
  await installTauriMock(page, { label: "capture-preview-4", previewState: { id: 4, saved: false, copied: null, done: true, failed: false } });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "撮影した画像を開く" })).toContainText("保存・コピーなし");
});

test("keeps a small image at its size with the status overlaid inside the card", async ({ page }) => {
  await page.setViewportSize({ width: 224, height: 144 });
  await installTauriMock(page, { label: "capture-preview-5", previewImageSize: { width: 100, height: 100 } });
  await page.goto("/");

  const preview = page.getByRole("button", { name: "撮影した画像を開く" });
  const image = await preview.locator("img").boundingBox();
  const status = await preview.locator(".capture-preview-status").boundingBox();
  expect(image).not.toBeNull();
  expect(status).not.toBeNull();
  expect(image!.width).toBe(100);
  expect(image!.height).toBe(100);
  const card = await preview.locator(".capture-preview-image").boundingBox();
  expect(status!.y + status!.height).toBeLessThanOrEqual(card!.y + card!.height + 0.5);
  expect(status!.x).toBeGreaterThanOrEqual(card!.x);
  await expect(preview.locator(".capture-preview-status")).toContainText("画像をコピーしました");
});

test("fits a wide image without changing its aspect ratio", async ({ page }) => {
  await page.setViewportSize({ width: 288, height: 173 });
  await installTauriMock(page, { label: "capture-preview-6", previewImageSize: { width: 528, height: 297 } });
  await page.goto("/");

  const image = await page.locator(".capture-preview img").boundingBox();
  expect(image).not.toBeNull();
  expect(image!.width).toBeCloseTo(264, 0);
  expect(image!.height).toBeCloseTo(148.5, 0);
});
