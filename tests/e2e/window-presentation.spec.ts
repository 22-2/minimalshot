import { expect, test, type Page } from "@playwright/test";

import { commandNames, installTauriMock } from "./tauri-mock";

async function presentations(page: Page) {
  return page.evaluate(() => (window as unknown as {
    __presentations: { session: number | null; imagesReady: boolean; settingsReady: boolean }[];
  }).__presentations);
}

async function emit(page: Page, event: string, payload?: number | string) {
  await page.evaluate(({ event, payload }) => {
    (window as unknown as { __emit: (event: string, payload?: number | string) => void }).__emit(event, payload);
  }, { event, payload });
}

test("spare viewer waits for assignment and loads it only once", async ({ page }) => {
  await installTauriMock(page, { label: "viewer-10", viewerSession: null, delays: { shot_png: 100 } });
  await page.goto("/");
  await expect.poll(() => commandNames(page)).toContain("viewer_session");
  expect(await presentations(page)).toEqual([]);
  expect(await commandNames(page)).not.toContain("shot_png");
  expect(await commandNames(page)).not.toContain("shot_info");
  await emit(page, "viewer-load", 42);
  await emit(page, "viewer-load", 42);
  await expect.poll(() => presentations(page)).toContainEqual({ session: null, imagesReady: true, settingsReady: false });
  expect((await commandNames(page)).filter((cmd) => cmd === "shot_png")).toHaveLength(1);
  await emit(page, "shot-saved", "C:/Pictures/shot.png");
  await page.locator(".viewer-stage").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "パスのコピー" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await emit(page, "shot-error", "自動コピーに失敗しました");
  await expect(page.getByText("自動コピーに失敗しました")).toBeVisible();
});

test("prewarmed region stays hidden until a capture is assigned", async ({ page }) => {
  await installTauriMock(page, { label: "region", regionSession: null });
  await page.goto("/");
  await expect.poll(() => commandNames(page)).toContain("region_session");
  expect(await presentations(page)).toEqual([]);
  await expect(page.locator(".region-image")).toHaveJSProperty("naturalWidth", 1280);
  expect(await commandNames(page)).not.toContain("region_png");
  await emit(page, "region-load", 7);
  await expect.poll(() => presentations(page)).toContainEqual({ session: 7, imagesReady: true, settingsReady: false });
});

test("capture during region preparation keeps the live capture", async ({ page }) => {
  await installTauriMock(page, { label: "region", regionSession: null, delays: { prepare_region: 300 } });
  await page.goto("/");
  await expect.poll(() => commandNames(page)).toContain("prepare_region");
  await emit(page, "region-load", 8);
  await expect.poll(() => presentations(page)).toContainEqual({ session: 8, imagesReady: true, settingsReady: false });
  await expect.poll(() => commandNames(page)).toContain("region_session");
  expect((await commandNames(page)).filter((cmd) => cmd === "region_png")).toHaveLength(1);
  await expect(page.locator(".region-image")).toHaveCount(1);
});

test("viewer assignment during the initial query does not load twice", async ({ page }) => {
  await installTauriMock(page, { label: "viewer-2", viewerSession: null, delays: { viewer_session: 300 } });
  await page.goto("/");
  await expect.poll(() => commandNames(page)).toContain("viewer_session");
  await emit(page, "viewer-load", 9);
  await expect.poll(() => presentations(page)).toHaveLength(1);
  // 初期問い合わせの応答後にも、PNGの再取得を始めない。
  await expect.poll(() => commandNames(page)).toContain("plugin:window|is_always_on_top");
  await page.waitForTimeout(350);
  expect((await commandNames(page)).filter((cmd) => cmd === "shot_png")).toHaveLength(1);
});

for (const label of ["viewer-1", "region"]) {
  test(`${label} shows only after its image has loaded`, async ({ page }) => {
    await installTauriMock(page, { label, delays: { shot_png: 200, region_png: 200 } });
    await page.goto("/");
    await expect.poll(() => presentations(page)).toContainEqual({
      session: label === "region" ? 1 : null,
      imagesReady: true,
      settingsReady: false,
    });
    expect((await presentations(page)).every((frame) => frame.imagesReady)).toBe(true);
  });
}

test("uses a dark document background even before app JavaScript loads", async ({ page }) => {
  await page.route("**/src/main.tsx", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(22, 23, 26)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(22, 23, 26)");
});

test("settings reloads saved values when its reused window opens again", async ({ page }) => {
  await installTauriMock(page, { label: "settings", delays: { get_config: 100 } });
  await page.goto("/");
  await expect.poll(() => presentations(page)).toContainEqual({ session: null, imagesReady: false, settingsReady: true });
  const before = (await presentations(page)).length;
  await page.getByLabel("ファイル名").fill("unsaved.png");
  await emit(page, "settings-open");
  await expect(page.getByLabel("ファイル名")).toHaveValue("%Y-%m/%Y-%m-%d_%H-%M-%S.png");
  await expect.poll(async () => (await presentations(page)).length).toBeGreaterThan(before);
  expect((await presentations(page)).every((frame) => frame.settingsReady)).toBe(true);
});

test("region window discards canceled loads and shows the next capture", async ({ page }) => {
  await installTauriMock(page, { label: "region", delays: { region_png: 300 } });
  await page.goto("/");
  await expect.poll(() => commandNames(page)).toContain("region_png");
  await page.keyboard.press("Escape");
  await expect.poll(() => commandNames(page)).toContain("cancel_region");
  await emit(page, "region-load", 2);
  await expect.poll(() => presentations(page)).toContainEqual({ session: 2, imagesReady: true, settingsReady: false });
  expect((await presentations(page)).some((frame) => frame.session === 1)).toBe(false);
  await page.mouse.move(10, 10);
  await page.mouse.down();
  await page.mouse.move(110, 90);
  await page.mouse.up();
  await expect.poll(() => commandNames(page)).toContain("finish_region");
  await expect(page.locator(".region-image")).toHaveCount(0);
  await emit(page, "region-load", 3);
  await expect.poll(() => presentations(page)).toContainEqual({ session: 3, imagesReady: true, settingsReady: false });
});

test("viewer load failures still show a closable error window", async ({ page }) => {
  await installTauriMock(page, { label: "viewer-1", failures: { shot_png: "画像の読み込みに失敗" } });
  await page.goto("/");
  await expect.poll(() => commandNames(page)).toContain("show_window");
  await expect(page.getByText("画像の読み込みに失敗")).toBeVisible();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect.poll(() => commandNames(page)).toContain("plugin:window|close");
});
