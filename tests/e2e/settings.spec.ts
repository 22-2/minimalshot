import { expect, test } from "@playwright/test";

import { calls, installTauriMock } from "./tauri-mock";

test.describe("settings", () => {
  test("opens the config folder without saving or discarding edits", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");

    await page.getByLabel("ファイル名").fill("unsaved.png");
    await page.getByRole("button", { name: "設定フォルダを開く" }).click();

    await expect(page.getByText("設定フォルダを開きました")).toBeVisible();
    await expect(page.getByLabel("ファイル名")).toHaveValue("unsaved.png");
    const commands = (await calls(page)).map((call) => call.cmd);
    expect(commands).toContain("open_config_folder");
    expect(commands).not.toContain("save_config");
  });

  test("reports a config folder launch failure", async ({ page }) => {
    await installTauriMock(page, {
      label: "settings",
      failures: { open_config_folder: "アクセスが拒否されました" },
    });
    await page.goto("/");
    await page.getByRole("button", { name: "設定フォルダを開く" }).click();

    await expect(page.getByText("設定フォルダを開けませんでした: アクセスが拒否されました")).toBeVisible();
  });

  test("edits and saves the configuration", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");

    await expect(page.getByLabel("ファイル名")).toHaveValue("%Y-%m/%Y-%m-%d_%H-%M-%S.png");
    await page.getByLabel("ファイル名").fill("%Y/%m%d-%H%M%S.png");
    await page.getByRole("switch", { name: "常に最前面に表示" }).click();
    await page.getByRole("radio", { name: "しない" }).click();
    await page.getByRole("button", { name: "設定を保存" }).click();

    await expect(page.getByText("設定を保存しました")).toBeVisible();
    const save = (await calls(page)).find((c) => c.cmd === "save_config");
    expect(save?.args.config).toMatchObject({
      storage: { format: "%Y/%m%d-%H%M%S.png" },
      viewer: { always_on_top: true },
      capture: { auto_copy: "none" },
    });
  });

  test("assigns multiple shortcuts and an automatic tool to one capture mode", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");

    await page.getByRole("button", { name: "領域: ショートカットを追加" }).click();
    await page.getByLabel("領域 2").fill("win+shift+z");
    await page.getByRole("switch", { name: "既定動作を使う" }).first().click();
    await page.getByRole("checkbox", { name: "ペイント" }).last().check();
    await page.getByRole("button", { name: "設定を保存" }).click();

    const save = (await calls(page)).find((c) => c.cmd === "save_config");
    expect(save?.args.config).toMatchObject({
      hotkeys: { region: ["Ctrl+PrintScreen", "win+shift+z"] },
      capture: { region: { auto_tools: ["ペイント"] } },
    });
  });

  test("shows the running app version in About", async ({ page }) => {
    await installTauriMock(page, { label: "about" });
    await page.goto("/");

    await expect(page.getByText("バージョン 0.0.9")).toBeVisible();
    expect((await calls(page)).map((call) => call.cmd)).toContain("app_version");
  });

  test("uses only the dark palette", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");

    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(22, 23, 26)");
  });
});
