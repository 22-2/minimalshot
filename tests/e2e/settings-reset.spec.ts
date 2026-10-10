import { expect, test } from "@playwright/test";

import { defaultConfig } from "../unit/fixtures";
import { calls, installTauriMock } from "./tauri-mock";

const changedConfig = () => ({
  hotkeys: { region: ["Ctrl+P"], window: [], fullscreen: [], desktop: ["Ctrl+Alt+P"] },
  capture: { auto_save: true, auto_copy: "none", region: { auto_copy: "path" } },
  storage: { directory: "D:/shots", format: "%Y.png" },
  viewer: { always_on_top: true, confirm_on_close: true, layout: "framed" },
  external: { tools: [{ name: "Custom", command: "custom.exe", args: "", hide_console: true, copy_stdout: true }] },
});

for (const [tab, sections] of [
  ["アクション", ["hotkeys", "capture"]],
  ["保存先", ["storage"]],
  ["ビューア", ["viewer"]],
  ["外部ツール", ["external"]],
] as const) {
  test(`resets only ${tab} and clears its modified indicators`, async ({ page }) => {
    const config = changedConfig();
    const defaults = defaultConfig();
    await installTauriMock(page, { label: "settings", config });
    await page.goto("/");
    await page.getByRole("tab", { name: tab, exact: true }).click();
    if (tab === "アクション") await page.getByRole("button", { name: /領域をキャプチャ$/ }).click();
    if (tab === "外部ツール") await page.getByRole("button", { name: /Custom/ }).click();
    await expect(page.locator(".setting-item[data-modified]").first()).toBeVisible();
    const reset = page.getByRole("button", { name: "このタブをデフォルトに戻す", exact: true });
    const folder = page.getByRole("button", { name: "設定フォルダを開く", exact: true });
    expect((await reset.boundingBox())!.y).toBeLessThan((await folder.boundingBox())!.y);
    await reset.click();
    const expected = { ...config, ...Object.fromEntries(sections.map((section) => [section, defaults[section]])) };
    await expect.poll(async () => (await calls(page)).filter((call) => call.cmd === "save_config").at(-1)?.args.config).toEqual(expected);
    await expect(page.locator(".setting-item[data-modified]")).toHaveCount(0);
  });
}

test("resets all settings from the dedicated tab", async ({ page }) => {
  await installTauriMock(page, { label: "settings", config: changedConfig() });
  await page.goto("/");
  await page.getByRole("tab", { name: "初期化", exact: true }).click();
  await expect(page.getByRole("button", { name: "このタブをデフォルトに戻す", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "すべてをデフォルトに戻す", exact: true }).click();
  await expect.poll(async () => (await calls(page)).filter((call) => call.cmd === "save_config").at(-1)?.args.config).toEqual(defaultConfig());
});

test("modified marker appears on edit and disappears when the value matches its default", async ({ page }, testInfo) => {
  await installTauriMock(page, { label: "settings" });
  await page.goto("/");
  await page.getByRole("tab", { name: "保存先", exact: true }).click();
  const filename = page.getByLabel("ファイル名", { exact: true });
  await expect(page.locator(".setting-item[data-modified]")).toHaveCount(0);
  await filename.fill("custom.png");
  await expect(page.locator(".setting-item[data-modified]")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("modified-setting.png") });
  await filename.fill(defaultConfig().storage.format);
  await expect(page.locator(".setting-item[data-modified]")).toHaveCount(0);
});

test("failed reset leaves edited values and reports the error", async ({ page }) => {
  await installTauriMock(page, { label: "settings" });
  await page.goto("/");
  await page.getByRole("tab", { name: "保存先", exact: true }).click();
  await page.getByLabel("ファイル名", { exact: true }).fill("custom.png");
  // 初期表示後の既定値取得だけを失敗させる。
  await page.evaluate(() => {
    const internal = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = internal.invoke;
    internal.invoke = (cmd, args) => cmd === "get_default_config" ? Promise.reject("既定値を取得できません") : invoke(cmd, args);
  });
  await page.getByRole("button", { name: "このタブをデフォルトに戻す", exact: true }).click();
  await expect(page.getByText("既定値を取得できません", { exact: true })).toBeVisible();
  await expect(page.getByLabel("ファイル名", { exact: true })).toHaveValue("custom.png");
});
