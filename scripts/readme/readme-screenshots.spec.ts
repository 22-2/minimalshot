import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { defaultConfig } from "../../tests/unit/fixtures";
import { installTauriMock } from "../../tests/e2e/tauri-mock";

const outputDirectory = resolve(process.env.README_SHOT_DIR ?? join(tmpdir(), "minimalshot-readme-screenshots"));

async function capturePage(page: Page, filename: string) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const path = join(outputDirectory, filename);
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
  console.log(path);
}

test.beforeAll(async () => { await mkdir(outputDirectory, { recursive: true }); });

test("capture settings and compact hotkey editor", async ({ page }) => {
  const config = defaultConfig();
  config.hotkeys.region = ["Ctrl+PrintScreen", "Ctrl+A", "Ctrl+X", "Ctrl+V", "Ctrl+B", "Ctrl+Shift+Z"];
  config.capture.region = { auto_save: true, auto_copy: "image", open_viewer: false };
  await installTauriMock(page, { label: "settings", config });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "キャプチャ", exact: true })).toBeVisible();
  await capturePage(page, "settings-capture.png");
  await page.getByRole("button", { name: "領域をキャプチャ", exact: true }).click();
  await expect(page.getByRole("region", { name: "領域をキャプチャ", exact: true })).toBeVisible();
  await capturePage(page, "settings-capture-editor.png");
  await page.setViewportSize({ width: 395, height: 600 });
  await capturePage(page, "settings-capture-editor-compact.png");
  await page.getByRole("button", { name: "領域をキャプチャ", exact: true }).click();
  await capturePage(page, "settings-capture-compact.png");
});

test("external tools and their in-window editor", async ({ page }) => {
  await installTauriMock(page, { label: "settings", config: defaultConfig() });
  await page.goto("/");
  await page.getByRole("tab", { name: "外部ツール", exact: true }).click();
  await expect(page.getByRole("button", { name: "ペイント", exact: true })).toBeVisible();
  await capturePage(page, "settings-tools.png");
  await page.getByRole("button", { name: "文字認識してメモ帳で開く", exact: true }).click();
  await expect(page.getByLabel("コマンド", { exact: true })).toHaveValue("powershell.exe");
  await capturePage(page, "settings-tool-editor.png");
});

test("data backup and viewer settings", async ({ page }) => {
  await installTauriMock(page, { label: "settings", config: defaultConfig() });
  await page.goto("/");
  await page.getByRole("tab", { name: "データ", exact: true }).click();
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeVisible();
  await capturePage(page, "settings-data.png");
  await page.getByRole("tab", { name: "ビューア", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "初期表示" })).toBeVisible();
  await capturePage(page, "settings-viewer.png");
});

test("viewer and image context menu", async ({ page }) => {
  await installTauriMock(page, { label: "viewer-1", config: defaultConfig() });
  await page.goto("/");
  await expect(page.locator(".viewer-image")).toBeVisible();
  await capturePage(page, "viewer.png");
  await page.locator(".viewer-stage").click({ button: "right", position: { x: 340, y: 140 } });
  await expect(page.getByRole("menu")).toBeVisible();
  await capturePage(page, "viewer-menu.png");
});
