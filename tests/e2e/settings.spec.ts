import { expect, test } from "@playwright/test";

import { calls, installTauriMock } from "./tauri-mock";

test.describe("settings", () => {
  test("edits in a focused modal and restores focus without opening another window", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "領域をキャプチャの設定", exact: true });
    await expect(page.locator(".setting-disclosure")).toHaveCount(0);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "領域をキャプチャ", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name: "クリップボードへコピー" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(0);
    await dialog.getByRole("button", { name: "領域をキャプチャ: ショートカットを追加", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("キーを押してください")).toHaveCount(0);
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await dialog.getByRole("switch", { name: "撮影後にウィンドウを開かない" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator(".setting-row svg")).toHaveCount(5);
    await expect(page.locator(".setting-row svg:not(.lucide-settings)")).toHaveCount(0);
    expect((await calls(page)).filter((call) => ["open_settings", "capture"].includes(call.cmd))).toHaveLength(0);
  });

  test("deleting an external tool closes its editor and focuses Add", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");
    await page.getByRole("tab", { name: "外部ツール", exact: true }).click();
    await expect(page.locator(".setting-row .summary-effects")).toHaveCount(0);
    await expect(page.locator(".setting-row .summary-chip").first()).toHaveText("mspaint.exe");
    const trigger = page.getByRole("button", { name: "ペイントの設定", exact: true });
    await trigger.click();
    await page.getByRole("button", { name: "このツールを削除", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ツールを追加", exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: "GIMPの設定", exact: true })).toBeVisible();
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
      const header = row.getByRole("button", { name: "領域をキャプチャの設定", exact: true });
      await expect(page.locator(".setting-row kbd")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "全画面をキャプチャの設定", exact: true })).toBeVisible();
      const title = await row.locator(".setting-row-title").boundingBox();
      const headerBox = (await header.boundingBox())!;
      expect(title!.x + title!.width).toBeLessThanOrEqual(headerBox.x);
      await expect(row.locator("svg")).toHaveCount(1);
      await expect(row.locator(".lucide-settings")).toBeVisible();
      expect((await row.boundingBox())!.x + (await row.boundingBox())!.width - headerBox.x - headerBox.width).toBeLessThanOrEqual(12);
      if (width > 420) {
        const resetLabel = page.getByRole("button", { name: "このタブをデフォルトに戻す", exact: true }).locator(".settings-nav-label");
        expect(await resetLabel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await resetLabel.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(24);
      }
      await header.click();
      const panel = page.getByRole("dialog", { name: "領域をキャプチャ", exact: true });
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
    await page.getByRole("button", { name: "全画面をキャプチャの設定", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "全画面をキャプチャ", exact: true });
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
    await page.getByRole("button", { name: "クリップボードの画像を開くの設定", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "クリップボードの画像を開く", exact: true });
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
    await page.getByRole("tab", { name: "キャプチャ" }).click();
    await page.getByRole("button", { name: "アクティブなウィンドウをキャプチャの設定" }).click();
    await page.getByRole("dialog", { name: "アクティブなウィンドウをキャプチャ" }).getByRole("combobox", { name: "クリップボードへコピー" }).click();
    await page.getByRole("option", { name: "しない" }).click();

    // 保存ボタンは無く、変更が止まると自動で保存する
    await expect(page.getByRole("dialog").getByText("設定を保存しました")).toBeVisible();
    await expect.poll(async () => (await calls(page)).filter((c) => c.cmd === "save_config").at(-1)?.args.config).toMatchObject({
      storage: { format: "%Y/%m%d-%H%M%S.png" },
      viewer: { always_on_top: true, layout: "framed" },
      capture: { auto_copy: "image", window: { auto_copy: "none" } },
    });
  });

  test("records a shortcut and turns on saving for one capture mode", async ({ page }) => {
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");

    await page.getByRole("button", { name: "領域をキャプチャの設定" }).click();
    await page.getByRole("button", { name: "領域をキャプチャ: ショートカットを追加" }).click();
    await page.keyboard.press("Control+Shift+KeyZ");
    await expect(page.getByText("Ctrl+Shift+Z")).toBeVisible();
    await page.getByRole("dialog", { name: "領域をキャプチャ" }).getByRole("switch", { name: "自動で画像を保存する" }).click();

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
