import { expect, test } from "@playwright/test";

import { calls, installTauriMock } from "./tauri-mock";

test.describe("settings", () => {
  test("keeps navigation labels fully visible with wider fallback fonts", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");
    await page.addStyleTag({ content: ":root { --font-ui: monospace; }" });
    await page.evaluate(() => document.fonts.ready);

    const labels = page.locator(".settings-nav-label");
    await expect(labels).toHaveCount(8);
    for (const label of await labels.all()) {
      await expect(label).toBeVisible();
      expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await label.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(24);
    }
    expect(await page.locator(".settings-body").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("navigation-fallback-font.png"), animations: "disabled" });
  });

  test("toggles capture settings from the full row without checkboxes", async ({ page }, testInfo) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "領域をキャプチャ", exact: true });
    await expect(page.locator(".setting-disclosure")).toHaveCount(5);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("capture-modes.png") });
    const box = (await trigger.boundingBox())!;
    await trigger.click({ position: { x: box.width - 8, y: box.height / 2 } });
    const panel = page.getByRole("region", { name: "領域をキャプチャ", exact: true });
    await expect(panel).toBeVisible();
    await panel.getByRole("combobox", { name: "クリップボードへコピー" }).click();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(0);
    await panel.getByRole("button", { name: "領域をキャプチャ: ショートカットを追加", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("キーを押してください")).toHaveCount(0);
    await panel.getByRole("switch", { name: "撮影後にウィンドウを開かない" }).click();
    await trigger.focus();
    await page.keyboard.press("Space");
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator(".setting-row svg")).toHaveCount(5);
    await expect(page.locator(".setting-row .lucide-settings")).toHaveCount(0);
    expect((await calls(page)).filter((call) => ["open_settings", "capture"].includes(call.cmd))).toHaveLength(0);
  });

  test("deleting an external tool closes its editor and focuses Add", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");
    await page.getByRole("tab", { name: "外部ツール", exact: true }).click();
    await expect(page.locator(".setting-row .summary-effects")).toHaveCount(0);
    await expect(page.locator(".setting-row .summary-chip")).toHaveCount(0);
    const trigger = page.getByRole("button", { name: "ペイント", exact: true });
    await trigger.click();
    await page.getByRole("button", { name: "このツールを削除", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ツールを追加", exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: "GIMP", exact: true })).toBeVisible();
  });

  test("toggles tools independently and edits disabled tools in a modal", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");
    await page.getByRole("tab", { name: "外部ツール", exact: true }).click();
    const checkbox = page.getByRole("checkbox", { name: "ペイントを有効にする", exact: true });
    const trigger = page.getByRole("button", { name: "ペイント", exact: true });
    await checkbox.uncheck();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toHaveCSS("color", "rgb(154, 158, 168)");
    await expect.poll(async () => (await calls(page)).filter((call) => call.cmd === "save_config").at(-1)?.args.config)
      .toMatchObject({ external: { tools: [{ name: "ペイント", command: "mspaint.exe", enabled: false }, { name: "GIMP" }] } });
    await page.screenshot({ path: testInfo.outputPath("disabled-tool.png") });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "ペイント", exact: true });
    await expect(dialog.getByLabel("名前", { exact: true })).toBeFocused();
    await dialog.getByLabel("コマンド", { exact: true }).fill("paint.net");
    await expect.poll(async () => (await calls(page)).filter((call) => call.cmd === "save_config").at(-1)?.args.config)
      .toMatchObject({ external: { tools: [{ enabled: false, command: "paint.net" }, { name: "GIMP" }] } });
    for (let index = 0; index < 10; index++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath("tool-modal.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await checkbox.check();
    await expect.poll(async () => (await calls(page)).filter((call) => call.cmd === "save_config").at(-1)?.args.config)
      .toMatchObject({ external: { tools: [{ enabled: true, command: "paint.net" }, { name: "GIMP" }] } });
  });

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
      const row = page.locator(".setting-row").filter({ has: page.getByRole("heading", { name: "領域をキャプチャ", exact: true }) });
      const header = row.getByRole("button", { name: "領域をキャプチャ", exact: true });
      await expect(page.locator(".setting-row kbd")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "全画面をキャプチャ", exact: true })).toBeVisible();
      const title = await row.locator(".setting-row-title").boundingBox();
      const headerBox = (await header.boundingBox())!;
      const chevron = (await row.locator(".setting-row-chevron").boundingBox())!;
      expect(chevron.x - title!.x - title!.width).toBeLessThanOrEqual(5);
      expect(chevron.x).toBeGreaterThanOrEqual(title!.x + title!.width - 1);
      await expect(row.locator("svg")).toHaveCount(1);
      await expect(row.getByRole("checkbox")).toHaveCount(0);
      expect(headerBox.width).toBeGreaterThan((await row.boundingBox())!.width / 2);
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
        expect(inputBox.height).toBeLessThan(110);
      }
      expect(addBox.x + addBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width);
      expect(await page.locator(".settings-content").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("shortcut-layout.png") });
    });
  }

  test("configures shortcuts and actions for the entire desktop", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");
    await page.getByRole("button", { name: "全画面をキャプチャ", exact: true }).click();
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

  for (const width of [800, 240]) {
    test(`clipboard import only offers shortcuts and auto-save at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 700 });
      await installTauriMock(page, { label: "settings" });
      await page.goto("/");
      const groups = page.locator(".setting-row-list");
      await expect(groups).toHaveCount(2);
      await expect(groups.nth(0).locator(".setting-disclosure")).toHaveCount(4);
      await expect(groups.nth(1).locator(".setting-disclosure")).toHaveCount(1);
      const firstGroup = (await groups.nth(0).boundingBox())!;
      const secondGroup = (await groups.nth(1).boundingBox())!;
      expect(secondGroup.y - firstGroup.y - firstGroup.height).toBeGreaterThanOrEqual(24);
      await page.getByRole("button", { name: "クリップボードの画像を開く", exact: true }).click();
      const panel = page.getByRole("region", { name: "クリップボードの画像を開く", exact: true });
      await expect(panel.getByRole("combobox")).toHaveCount(0);
      await expect(panel.getByRole("switch")).toHaveCount(1);
      await expect(panel.locator(".setting-item")).toHaveCount(2);
      await expect(panel.getByRole("switch", { name: "自動で画像を保存する" })).not.toBeChecked();
      await panel.getByRole("button", { name: "クリップボードの画像を開く: ショートカットを追加", exact: true }).click();
      await page.keyboard.press("Control+Alt+KeyV");
      await panel.getByRole("switch", { name: "自動で画像を保存する" }).click();
      await expect.poll(async () => (await calls(page)).filter((call) => call.cmd === "save_config").at(-1)?.args.config)
        .toMatchObject({ hotkeys: { clipboard: ["Ctrl+Alt+V"] }, capture: { clipboard: { auto_save: true } } });
      const saved = (await calls(page)).filter((call) => call.cmd === "save_config").at(-1)?.args.config as { capture: { clipboard: unknown } };
      expect(saved.capture.clipboard).toEqual({ auto_save: true });
      expect(await page.locator(".settings-content").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("clipboard-settings.png") });
    });
  }

  test("clipboard auto-save does not inherit the screen capture setting", async ({ page }) => {
    await installTauriMock(page, { label: "settings", config: { capture: { auto_save: true, auto_copy: "path", open_viewer: false } } });
    await page.goto("/");
    await page.getByRole("button", { name: "クリップボードの画像を開く", exact: true }).click();
    const panel = page.getByRole("region", { name: "クリップボードの画像を開く", exact: true });
    await expect(panel.getByRole("switch", { name: "自動で画像を保存する" })).not.toBeChecked();
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

  test("opens the save folder from the storage tab", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");
    await page.getByRole("tab", { name: "保存先" }).click();
    await page.getByRole("button", { name: "保存フォルダを開く" }).click();

    await expect(page.getByText("保存フォルダを開きました")).toBeVisible();
    const commands = (await calls(page)).map((call) => call.cmd);
    expect(commands).toContain("open_save_folder");
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
    await installTauriMock(page, {
      label: "settings",
      config: {
        viewer: {
          always_on_top: false,
          confirm_on_close: false,
          layout: "source",
          remembered_size: { width: 700, height: 500 },
        },
      },
    });
    await page.goto("/");

    await page.getByRole("tab", { name: "保存先" }).click();
    await expect(page.getByLabel("ファイル名")).toHaveValue("%Y-%m/%Y-%m-%d_%H-%M-%S.png");
    await page.getByLabel("ファイル名").fill("%Y/%m%d-%H%M%S.png");
    await page.getByRole("tab", { name: "ビューア" }).click();
    await page.getByRole("switch", { name: "常に最前面に表示" }).click();
    await page.getByRole("combobox", { name: "初期表示" }).click();
    await page.getByRole("option", { name: "前回の大きさで開く" }).click();
    await page.getByRole("tab", { name: "キャプチャ" }).click();
    await page.getByRole("button", { name: "アクティブなウィンドウをキャプチャ" }).click();
    await page.getByRole("region", { name: "アクティブなウィンドウをキャプチャ" }).getByRole("combobox", { name: "クリップボードへコピー" }).click();
    await page.getByRole("option", { name: "しない" }).click();

    // 保存ボタンは無く、変更が止まると自動で保存する
    await expect(page.getByText("設定を保存しました")).toBeVisible();
    await expect.poll(async () => (await calls(page)).filter((c) => c.cmd === "save_config").at(-1)?.args.config).toMatchObject({
      storage: { format: "%Y/%m%d-%H%M%S.png" },
      viewer: {
        always_on_top: true,
        layout: "remember",
        remembered_size: { width: 700, height: 500 },
      },
      capture: { auto_copy: "image", window: { auto_copy: "none" } },
    });
  });

  test("records a shortcut and turns on saving for one capture mode", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");

    await page.getByRole("button", { name: "領域をキャプチャ" }).click();
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
