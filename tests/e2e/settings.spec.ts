import { expect, test } from "@playwright/test";

import { calls, installTauriMock } from "./tauri-mock";

test.describe("settings", () => {
  test("opens the config folder without saving or discarding edits", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");

    await page.getByRole("tab", { name: "保存先" }).click();
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

    await page.getByRole("tab", { name: "保存先" }).click();
    await expect(page.getByLabel("ファイル名")).toHaveValue("%Y-%m/%Y-%m-%d_%H-%M-%S.png");
    await page.getByLabel("ファイル名").fill("%Y/%m%d-%H%M%S.png");
    await page.getByRole("tab", { name: "ビューア" }).click();
    await page.getByRole("switch", { name: "常に最前面に表示" }).click();
    await page.getByRole("combobox", { name: "初期表示" }).click();
    await page.getByRole("option", { name: "16:9 の窓に余白付きで開く" }).click();
    await page.getByRole("tab", { name: "アクション" }).click();
    await page.getByRole("region", { name: "ウィンドウをキャプチャ" }).getByRole("combobox", { name: "クリップボードへコピー" }).click();
    await page.getByRole("option", { name: "しない" }).click();
    await page.getByRole("button", { name: "設定を保存" }).click();

    await expect(page.getByText("設定を保存しました")).toBeVisible();
    const save = (await calls(page)).find((c) => c.cmd === "save_config");
    expect(save?.args.config).toMatchObject({
      storage: { format: "%Y/%m%d-%H%M%S.png" },
      viewer: { always_on_top: true, layout: "framed" },
      capture: { auto_copy: "image", window: { auto_copy: "none" } },
    });
  });

  test("records a shortcut and assigns an automatic tool to one capture mode", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");

    await page.getByRole("button", { name: "領域をキャプチャ: ショートカットを追加" }).click();
    await page.keyboard.press("Control+Shift+KeyZ");
    await expect(page.getByText("Ctrl + Shift + Z")).toBeVisible();
    await page.getByRole("tab", { name: "アクション" }).click();
    await page.getByRole("region", { name: "領域をキャプチャ" }).getByRole("button", { name: "ペイント" }).click();
    await page.getByRole("button", { name: "設定を保存" }).click();

    await expect(page.getByText("設定を保存しました")).toBeVisible();
    const save = (await calls(page)).find((c) => c.cmd === "save_config");
    expect(save?.args.config).toMatchObject({
      hotkeys: { region: ["Ctrl+PrintScreen", "Ctrl+Shift+Z"] },
      capture: { region: { auto_tools: ["ペイント"] } },
    });
  });

  test("shows the running app version in About", async ({ page }) => {
    await installTauriMock(page, { label: "about" });
    await page.goto("/");

    await expect(page.getByText("バージョン 0.0.9")).toBeVisible();
    const buildAt = process.env.VITE_DEV_BUILD_AT;
    const buildTime = page.locator(".about-body time");
    if (buildAt || process.env.VERSION === "v0.0.0-dev") {
      const stampedAt = await buildTime.getAttribute("datetime");
      expect(stampedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/);
      if (buildAt) expect(stampedAt).toBe(buildAt);
      await expect(buildTime).toHaveText(new Date(stampedAt!).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false }));
    } else {
      await expect(buildTime).toHaveCount(0);
    }
    await expect(page.locator(".titlebar-title")).toHaveAttribute("data-tauri-drag-region");
    await page.getByRole("button", { name: "閉じる" }).click();
    await expect.poll(async () => (await calls(page)).map((call) => call.cmd)).toContain("plugin:window|close");
    expect((await calls(page)).map((call) => call.cmd)).toContain("app_version");
  });

  test("uses only the dark palette", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");

    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(22, 23, 26)");
  });
});
