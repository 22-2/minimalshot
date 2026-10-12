import { expect, test } from "@playwright/test";

import { defaultConfig } from "../unit/fixtures";
import { calls, installTauriMock } from "./tauri-mock";

for (const width of [800, 395, 240]) {
  test(`data actions fit at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 600 });
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");
    await page.getByRole("tab", { name: "データ", exact: true }).click();
    for (const name of ["エクスポート", "インポート", "すべてをデフォルトに戻す"]) {
      const button = page.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(600);
    }
    expect(await page.locator(".settings-content").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.locator(".settings-content").evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath("data-settings.png") });
  });
}

test("exports the latest edited settings after flushing automatic saves", async ({ page }) => {
  await installTauriMock(page, { label: "settings" });
  await page.goto("/");
  await page.getByRole("tab", { name: "保存先", exact: true }).click();
  await page.getByLabel("ファイル名", { exact: true }).fill("backup.png");
  await page.getByRole("tab", { name: "データ", exact: true }).click();
  await expect(page.getByRole("tab", { name: "初期化", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "エクスポート", exact: true }).click();
  await expect(page.getByText("設定をエクスポートしました: D:/backup/MinimalShot-settings.toml")).toBeVisible();
  const commands = await calls(page);
  const exported = commands.find((call) => call.cmd === "export_config")!;
  expect(exported.args.config).toMatchObject({ storage: { format: "backup.png" } });
  expect(commands.findIndex((call) => call.cmd === "save_config")).toBeLessThan(commands.indexOf(exported));
});

test("imports settings and displays the restored values in every tab", async ({ page }) => {
  const config = defaultConfig();
  config.capture.region = { open_viewer: false, auto_save: true, auto_copy: "path" };
  config.hotkeys.region = ["Ctrl+Shift+Z"];
  config.storage.directory = "D:/復元した保存先";
  config.viewer.always_on_top = true;
  config.external.tools = [];
  await installTauriMock(page, { label: "settings", importConfig: config });
  await page.goto("/");
  await page.getByRole("tab", { name: "データ", exact: true }).click();
  await page.getByRole("button", { name: "インポート", exact: true }).click();
  await expect(page.getByText("設定をインポートしました", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "保存先", exact: true }).click();
  await expect(page.getByLabel("フォルダ", { exact: true })).toHaveValue(config.storage.directory);
  await page.getByRole("tab", { name: "ビューア", exact: true }).click();
  await expect(page.getByRole("switch", { name: "常に最前面に表示" })).toBeChecked();
  await page.getByRole("tab", { name: "外部ツール", exact: true }).click();
  await expect(page.getByText("ツールが登録されていません。", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "キャプチャ", exact: true }).click();
  await page.getByRole("button", { name: "領域をキャプチャ", exact: true }).click();
  await expect(page.getByText("Ctrl+Shift+Z", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "撮影後にウィンドウを開かない" })).toBeChecked();
  expect((await calls(page)).filter((call) => call.cmd === "save_config")).toHaveLength(0);
});

for (const operation of ["import", "export"] as const) {
  const label = operation === "import" ? "インポート" : "エクスポート";
  test(`cancelled ${operation} preserves the settings`, async ({ page }) => {
    await installTauriMock(page, { label: "settings", importConfig: null, exportPath: null });
    await page.goto("/");
    await page.getByRole("tab", { name: "データ", exact: true }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect.poll(async () => (await calls(page)).some((call) => call.cmd === `${operation}_config`)).toBe(true);
    await expect(page.getByRole("button", { name: label, exact: true })).toBeEnabled();
    await expect(page.getByText("変更は自動で保存されます", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "保存先", exact: true }).click();
    await expect(page.getByLabel("ファイル名", { exact: true })).toHaveValue(defaultConfig().storage.format);
    expect((await calls(page)).filter((call) => call.cmd === "save_config")).toHaveLength(0);
  });

  test(`failed ${operation} preserves edits and reports the problem`, async ({ page }) => {
    await installTauriMock(page, { label: "settings", failures: { [`${operation}_config`]: "ファイルを開けません" } });
    await page.goto("/");
    await page.getByRole("tab", { name: "保存先", exact: true }).click();
    await page.getByLabel("ファイル名", { exact: true }).fill("keep.png");
    await page.getByRole("tab", { name: "データ", exact: true }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByText(`設定を${label}できませんでした: ファイルを開けません`, { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "保存先", exact: true }).click();
    await expect(page.getByLabel("ファイル名", { exact: true })).toHaveValue("keep.png");
  });
}

test("disables data actions while the native file dialog is open", async ({ page }) => {
  await installTauriMock(page, { label: "settings", holdFirst: ["import_config"] });
  await page.goto("/");
  await page.getByRole("tab", { name: "データ", exact: true }).click();
  await page.getByRole("button", { name: "インポート", exact: true }).click();
  await expect(page.getByRole("button", { name: "エクスポート", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "すべてをデフォルトに戻す", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as unknown as { __release: (cmd: string) => void }).__release("import_config"));
  await expect(page.getByRole("button", { name: "インポート", exact: true })).toBeEnabled();
});
