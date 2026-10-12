import { expect, test } from "@playwright/test";

import { calls, installTauriMock } from "./tauri-mock";

test.describe("settings", () => {
  for (const width of [800, 395, 240]) {
    test(`wraps shortcuts compactly and keeps controls inside at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 700 });
      await installTauriMock(page, {
        label: "settings",
        config: {
          hotkeys: {
            region: ["Ctrl+PrintScreen", "Ctrl+A", "Ctrl+X", "Ctrl+V", "Ctrl+B", "Ctrl+Shift+Z"],
            window: ["Shift+PrintScreen"], fullscreen: ["Alt+PrintScreen"], desktop: [], clipboard: [],
          },
        },
      });
      await page.goto("/");
      const header = page.getByRole("button", { name: "領域をキャプチャ 画像をコピー", exact: true });
      await expect(page.locator(".setting-disclosure-heading kbd")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "全画面をキャプチャ 画像をコピー", exact: true })).toBeVisible();
      const icons = await header.locator(".summary-effects").boundingBox();
      const title = await header.locator(".setting-disclosure-title").boundingBox();
      expect(icons!.x).toBeGreaterThanOrEqual(title!.x + title!.width);
      const headerBox = (await header.boundingBox())!;
      expect(headerBox.x + headerBox.width - icons!.x - icons!.width).toBeLessThanOrEqual(16);
      if (width > 420) {
        const resetLabel = page.getByRole("button", { name: "このタブをデフォルトに戻す", exact: true }).locator(".settings-nav-label");
        expect(await resetLabel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await resetLabel.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(24);
      }
      await header.click();
      const panel = page.getByRole("region", { name: "領域をキャプチャ", exact: true });
      const chips = await panel.locator(".hotkey-chip").all();
      expect(chips).toHaveLength(6);
      const chipBoxes = await Promise.all(chips.map((chip) => chip.boundingBox()));
      const inputBox = (await panel.locator(".hotkey-input").boundingBox())!;
      const addBox = (await panel.getByRole("button", { name: "領域をキャプチャ: ショートカットを追加", exact: true }).boundingBox())!;
      for (const box of chipBoxes) {
        expect(box!.x).toBeGreaterThanOrEqual(inputBox.x);
        expect(box!.x + box!.width).toBeLessThanOrEqual(addBox.x);
      }
      if (width === 800) {
        expect(chipBoxes[1]!.y).toBe(chipBoxes[0]!.y);
        expect(inputBox.height).toBeLessThan(80);
      }
      expect(addBox.x + addBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width);
      expect(await page.locator(".settings-content").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("shortcut-layout.png") });
    });
  }

  test("configures shortcuts and actions for the entire desktop", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");
    await page.getByRole("button", { name: "全画面をキャプチャ 画像をコピー", exact: true }).click();
    const panel = page.getByRole("region", { name: "全画面をキャプチャ", exact: true });
    await expect(panel.getByText("未設定")).toBeVisible();
    await panel.getByRole("button", { name: "全画面をキャプチャ: ショートカットを追加", exact: true }).click();
    await page.keyboard.press("Control+Alt+KeyP");
    await panel.getByRole("switch", { name: "自動で画像を保存する" }).click();
    await expect.poll(async () => (await calls(page)).filter((call) => call.cmd === "save_config").at(-1)?.args.config).toMatchObject({
      hotkeys: { desktop: ["Ctrl+Alt+P"], fullscreen: ["Alt+PrintScreen"] },
      capture: { desktop: { auto_save: true, auto_copy: "image" } },
    });
  });

  test("configures clipboard import with no automatic save or copy by default", async ({ page }, testInfo) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");
    await page.getByRole("button", { name: "クリップボードの画像を開く", exact: true }).click();
    const panel = page.getByRole("region", { name: "クリップボードの画像を開く", exact: true });
    await expect(panel.getByRole("combobox", { name: "クリップボードへコピー" })).toHaveText("しない");
    await expect(panel.getByRole("switch", { name: "自動で画像を保存する" })).not.toBeChecked();
    await panel.getByRole("button", { name: "クリップボードの画像を開く: ショートカットを追加", exact: true }).click();
    await page.keyboard.press("Control+Alt+KeyV");
    await panel.getByRole("switch", { name: "自動で画像を保存する" }).click();
    await expect.poll(async () => (await calls(page)).filter((call) => call.cmd === "save_config").at(-1)?.args.config)
      .toMatchObject({ hotkeys: { clipboard: ["Ctrl+Alt+V"] }, capture: { clipboard: { auto_save: true, auto_copy: "none" } } });
    await page.screenshot({ path: testInfo.outputPath("clipboard-settings.png") });
  });

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
    await page.getByRole("button", { name: /^アクティブなウィンドウをキャプチャ / }).click();
    await page.getByRole("region", { name: "アクティブなウィンドウをキャプチャ" }).getByRole("combobox", { name: "クリップボードへコピー" }).click();
    await page.getByRole("option", { name: "しない" }).click();

    // 保存ボタンは無く、変更が止まると自動で保存する
    await expect(page.getByText("設定を保存しました")).toBeVisible();
    await expect.poll(async () => (await calls(page)).filter((c) => c.cmd === "save_config").at(-1)?.args.config).toMatchObject({
      storage: { format: "%Y/%m%d-%H%M%S.png" },
      viewer: { always_on_top: true, layout: "framed" },
      capture: { auto_copy: "image", window: { auto_copy: "none" } },
    });
  });

  test("records a shortcut and turns on saving for one capture mode", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");

    await page.getByRole("button", { name: /^領域をキャプチャ / }).click();
    await page.getByRole("button", { name: "領域をキャプチャ: ショートカットを追加" }).click();
    await page.keyboard.press("Control+Shift+KeyZ");
    await expect(page.getByText("Ctrl+Shift+Z")).toBeVisible();
    await page.getByRole("region", { name: "領域をキャプチャ" }).getByRole("switch", { name: "自動で画像を保存する" }).click();

    await expect.poll(async () => (await calls(page)).filter((c) => c.cmd === "save_config").at(-1)?.args.config).toMatchObject({
      hotkeys: { region: ["Ctrl+PrintScreen", "Ctrl+Shift+Z"] },
      capture: { region: { auto_save: true } },
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
