import { expect, test } from "@playwright/test";

import { commandNames, installTauriMock } from "./tauri-mock";

test("editor loads the capture into Excalidraw", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 720 });
  await installTauriMock(page, {
    label: "editor-1",
    editorSession: { id: 1, width: 640, height: 360 },
  });
  await page.goto("/");

  await expect(page.locator(".titlebar-title")).toHaveText("Excalidrawで編集");
  await expect(page.locator(".editor-stage .excalidraw")).toBeVisible();
  await expect(page.locator(".editor-stage canvas").first()).toBeVisible();
  await expect(page.locator(".editor-placeholder")).toHaveCount(0);
  await expect.poll(() => commandNames(page)).toEqual(expect.arrayContaining(["editor_session", "editor_png"]));

  // モック画像の青がそのままの色で、余白を残してフィット表示されている。
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".editor-stage canvas.static");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] !== 58 || pixels[index + 1] !== 110 || pixels[index + 2] !== 165) continue;
      const pixel = index / 4;
      const x = pixel % canvas.width;
      const y = Math.floor(pixel / canvas.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return maxX - minX > 600 && minX > 0 && minY > 0 && maxX < canvas.width - 1 && maxY < canvas.height - 1;
  })).toBe(true);

  // 素のホイールはスクロールではなくカーソル中心のズームになる。
  const zoomPercent = async () => Number.parseInt(await page.locator(".zoom-actions").innerText(), 10);
  const before = await zoomPercent();
  await page.mouse.move(480, 360);
  await page.mouse.wheel(0, -120);
  await expect.poll(zoomPercent).toBeGreaterThan(before);
});
