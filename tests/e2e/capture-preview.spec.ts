import { expect, test } from "@playwright/test";

import { calls, installTauriMock } from "./tauri-mock";

test("shows the image, opens it on click and cancels dismissal", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 264, height: 180 });
  await page.clock.install();
  await installTauriMock(page, { label: "capture-preview-1" });
  await page.goto("/");
  const preview = page.getByRole("button", { name: "撮影した画像を開く" });
  await expect(preview.locator("img")).toBeVisible();
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
