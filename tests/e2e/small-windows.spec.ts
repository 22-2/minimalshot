import { expect, test, type Locator, type Page } from "@playwright/test";

import { calls, commandNames, installTauriMock } from "./tauri-mock";

const sizes = [
  { width: 395, height: 480 }, // 報告された狭いビューア
  { width: 320, height: 240 },
  { width: 240, height: 160 }, // ネイティブウィンドウの最小サイズ
];

/** visible だけでは画面外へ押し出されたボタンも通るので、全体の座標を検証する。 */
async function insideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function noHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    frame: document.querySelector(".frame")?.getBoundingClientRect().width,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  if (dimensions.frame) expect(dimensions.frame).toBeLessThanOrEqual(dimensions.viewport);
}

for (const size of sizes) {
  test(`viewer keeps all window controls usable at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await installTauriMock(page, { label: "viewer-1" });
    await page.goto("/");
    await expect(page.locator(".viewer-image")).toBeVisible();
    await noHorizontalOverflow(page);

    for (const [name, cmd] of [
      ["最小化", "plugin:window|minimize"],
      ["最大化", "plugin:window|toggle_maximize"],
      ["閉じる", "plugin:window|close"],
    ]) {
      const button = page.getByRole("button", { name, exact: true });
      await insideViewport(page, button);
      await button.click();
      await expect.poll(() => commandNames(page)).toContain(cmd);
    }

    const openWith = page.getByRole("button", { name: "外部ツールで開く", exact: true });
    await insideViewport(page, openWith);
    await openWith.click();
    await insideViewport(page, page.getByRole("menu"));
    await page.getByRole("menuitem", { name: "GIMP", exact: true }).click();
    await expect.poll(async () => (await calls(page)).find((call) => call.cmd === "open_shot_with")?.args)
      .toEqual({ tool: 1 });

    // 高さが足りないメニューもスクロールして最後の項目を選べる。
    await page.locator(".viewer-stage").click({ button: "right", position: { x: 20, y: 20 } });
    await insideViewport(page, page.getByRole("menu"));
    await page.getByRole("menuitem", { name: "設定", exact: true }).click();
    await expect.poll(() => commandNames(page)).toContain("open_settings");
    await page.locator(".viewer-stage").click({ button: "right", position: { x: size.width - 20, y: 20 } });
    await insideViewport(page, page.getByRole("menu"));
  });

  test(`settings can edit and save without horizontal scrolling at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await installTauriMock(page, { label: "settings" });
    await page.goto("/");
    await expect(page.getByLabel("ファイル名")).toHaveValue("%Y-%m/%Y-%m-%d_%H-%M-%S.png");
    await noHorizontalOverflow(page);
    await insideViewport(page, page.getByRole("button", { name: "閉じる", exact: true }));

    await page.getByLabel("ファイル名").fill("%Y/%m/%d.png");
    await insideViewport(page, page.getByLabel("ファイル名"));
    await page.getByRole("button", { name: "ツールを追加", exact: true }).click();
    const command = page.getByLabel("コマンド", { exact: true }).last();
    await command.fill("C:\\Program Files\\Example\\tool.exe");
    await insideViewport(page, command);
    const bodyDimensions = await page.locator(".settings-body").evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(bodyDimensions.scroll).toBeLessThanOrEqual(bodyDimensions.client);
    const save = page.getByRole("button", { name: "設定を保存", exact: true });
    await insideViewport(page, save);
    await save.click();
    await expect.poll(async () => (await calls(page)).find((call) => call.cmd === "save_config")?.args.config)
      .toMatchObject({ storage: { format: "%Y/%m/%d.png" } });
    // 保存結果の通知が出ても保存ボタンを押し出さない。
    await insideViewport(page, save);
    await noHorizontalOverflow(page);
  });
}

test("window controls stay inside the viewer after repeatedly resizing", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await installTauriMock(page, { label: "viewer-1" });
  await page.goto("/");
  await expect(page.locator(".viewer-image")).toBeVisible();
  for (const width of [421, 420, 395, 240, 800]) {
    await page.setViewportSize({ width, height: 240 });
    await noHorizontalOverflow(page);
    await insideViewport(page, page.getByRole("button", { name: "閉じる", exact: true }));
    await insideViewport(page, page.getByRole("button", { name: "外部ツールで開く", exact: true }));
    await insideViewport(page, page.locator(".viewer-stage"));
  }
});

test("long external tool names fit a narrow dropdown and remain selectable", async ({ page }) => {
  const name = "とても長い外部ツールの名前".repeat(10);
  await page.setViewportSize({ width: 240, height: 160 });
  await installTauriMock(page, {
    label: "viewer-1",
    config: { external: { tools: [{ name, command: "tool.exe", args: "", hide_console: false, copy_stdout: false }] } },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "外部ツールで開く", exact: true }).click();
  await insideViewport(page, page.getByRole("menu"));
  await page.getByRole("menuitem", { name, exact: true }).click();
  await expect.poll(() => commandNames(page)).toContain("open_shot_with");
});

test("close confirmation fits a narrow, short viewer and can be confirmed", async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 160 });
  await installTauriMock(page, { label: "viewer-1", config: { viewer: { confirm_on_close: true, always_on_top: false, layout: "source" } } });
  await page.goto("/");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await insideViewport(page, dialog);
  const confirm = dialog.getByRole("button", { name: "閉じる", exact: true });
  await confirm.scrollIntoViewIfNeeded();
  await insideViewport(page, confirm);
  await confirm.click();
  await expect.poll(() => commandNames(page)).toContain("plugin:window|close");
});

test("region instructions wrap inside a small screen and Escape still cancels", async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 160 });
  await installTauriMock(page, { label: "region" });
  await page.goto("/");
  await expect(page.locator(".region-image")).toBeVisible();
  await insideViewport(page, page.locator(".region-hint"));
  await noHorizontalOverflow(page);
  await page.keyboard.press("Escape");
  await expect.poll(() => commandNames(page)).toContain("cancel_region");
});
