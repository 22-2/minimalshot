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

  // ダークテーマでも、モック画像の青が表示上ほぼ元の色で、初期倍率 65% で余白を残して表示されている。
  // Excalidraw は画像を描画時に反転して canvas に書き込み、CSS の反転で打ち消すので、
  // バッファ上の色は元の色ではない。同じフィルタを通した色を期待値にする。
  await expect.poll(() => page.evaluate(() => {
    const source = [58, 110, 165];
    const applyFilter = (rgb: number[], filter: string) => {
      const input = document.createElement("canvas");
      input.width = input.height = 1;
      const inputContext = input.getContext("2d")!;
      inputContext.fillStyle = `rgb(${rgb.join(",")})`;
      inputContext.fillRect(0, 0, 1, 1);
      const output = document.createElement("canvas");
      output.width = output.height = 1;
      const outputContext = output.getContext("2d")!;
      outputContext.filter = filter;
      outputContext.drawImage(input, 0, 0);
      return [...outputContext.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const buffered = applyFilter(source, "invert(100%) hue-rotate(180deg) saturate(1.25)");
    const displayed = applyFilter(buffered, "invert(93%) hue-rotate(180deg)");
    if (displayed.some((value, channel) => Math.abs(value - source[channel]) > 40)) return false;
    const canvas = document.querySelector<HTMLCanvasElement>(".editor-stage canvas.static");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] !== buffered[0] || pixels[index + 1] !== buffered[1] || pixels[index + 2] !== buffered[2]) continue;
      const pixel = index / 4;
      const x = pixel % canvas.width;
      const y = Math.floor(pixel / canvas.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return maxX - minX > 380 && maxX - minX < 450 && minX > 0 && minY > 0 && maxX < canvas.width - 1 && maxY < canvas.height - 1;
  })).toBe(true);

  // 素のホイールはスクロールではなくカーソル中心のズームになる。
  const zoomPercent = async () => Number.parseInt(await page.locator(".zoom-actions").innerText(), 10);
  const before = await zoomPercent();
  expect(before).toBe(65);
  await page.mouse.move(480, 360);
  await page.mouse.wheel(0, -120);
  await expect.poll(zoomPercent).toBeGreaterThan(before);
});
