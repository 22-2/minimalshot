import { expect, test, type Page } from "@playwright/test";

import { commandNames, installTauriMock } from "./tauri-mock";

// Tauri/Wry の WebView と同じく、グローバルホットキーからの自動再生を許可する。
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"], executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } });

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const audio = { notes: 0, states: [] as string[] };
    Object.assign(window, { __audio: audio });
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = createOscillator.call(this);
      const start = oscillator.start.bind(oscillator);
      oscillator.start = (when) => {
        audio.notes++;
        audio.states.push(this.state);
        start(when);
      };
      return oscillator;
    };
  });
}

async function notes(page: Page) {
  return page.evaluate(() => (window as unknown as { __audio: { notes: number; states: string[] } }).__audio);
}

test("capture plays one common completion sound without a webview gesture", async ({ page }) => {
  await observeAudio(page);
  await installTauriMock(page, { label: "viewer-10", viewerSession: null });
  await page.goto("/");
  await expect.poll(() => commandNames(page)).toContain("viewer_session");
  expect((await notes(page)).notes).toBe(0);
  await page.evaluate(() => (window as unknown as { __emit: (event: string, payload: number) => void }).__emit("viewer-load", 42));
  await expect.poll(() => notes(page)).toEqual({ notes: 2, states: ["running", "running"] });
  await page.evaluate(() => (window as unknown as { __emit: (event: string, payload: number) => void }).__emit("viewer-load", 42));
  await page.locator(".viewer-stage").click({ button: "right" });
  await page.keyboard.press("Escape");
  expect((await notes(page)).notes).toBe(2);
});

test("failed image loads do not play the completion sound", async ({ page }) => {
  await observeAudio(page);
  await installTauriMock(page, { label: "viewer-1", failures: { shot_png: "画像取得失敗" } });
  await page.goto("/");
  await expect(page.getByText("画像取得失敗")).toBeVisible();
  expect((await notes(page)).notes).toBe(0);
});

test("reduced motion mutes the completion sound", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await observeAudio(page);
  await installTauriMock(page, { label: "viewer-1" });
  await page.goto("/");
  await expect.poll(() => commandNames(page)).toContain("show_window");
  expect((await notes(page)).notes).toBe(0);
});

test("settings operations stay silent", async ({ page }) => {
  await observeAudio(page);
  await installTauriMock(page, { label: "settings" });
  await page.goto("/");
  await page.getByRole("tab", { name: "ビューア", exact: true }).click();
  await page.getByRole("switch", { name: "常に最前面に表示", exact: true }).click();
  expect((await notes(page)).notes).toBe(0);
});
