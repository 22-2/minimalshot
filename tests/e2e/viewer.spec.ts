import { expect, test } from "@playwright/test";

import { calls, commandNames, installTauriMock } from "./tauri-mock";

test.describe("viewer", () => {
  test("shows the capture with a thin custom title bar", async ({ page }) => {
    await installTauriMock(page, { label: "viewer-1" });
    await page.goto("/");

    await expect(page.locator(".viewer-image")).toBeVisible();
    await expect(page.locator(".titlebar")).toContainText("640 × 360");
    await expect(page.locator(".titlebar")).toHaveCSS("height", "24px");
    for (const name of ["最小化", "最大化", "閉じる"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
  });

  test("enables path copy only after saving", async ({ page }) => {
    await installTauriMock(page, { label: "viewer-1" });
    await page.goto("/");

    const copyPath = page.getByRole("button", { name: "保存するとパスをコピーできます" });
    await expect(copyPath).toBeDisabled();

    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".toolbar-status")).toHaveText("保存しました");
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();

    await page.getByRole("button", { name: "パスをコピー" }).click();
    await expect(page.locator(".toolbar-status")).toHaveText("パスをコピーしました");
    expect(await commandNames(page)).toEqual(expect.arrayContaining(["save_shot", "copy_shot_path"]));
  });

  test("copies the image and opens the external editor", async ({ page }) => {
    await installTauriMock(page, { label: "viewer-1" });
    await page.goto("/");

    await page.getByRole("button", { name: "画像をコピー" }).click();
    await expect(page.locator(".toolbar-status")).toHaveText("画像をコピーしました");
    await page.getByRole("button", { name: "外部ツールで開く" }).click();
    await expect(page.locator(".toolbar-status")).toHaveText("外部ツールで開きました");
  });

  test("shows backend errors in the toolbar", async ({ page }) => {
    await installTauriMock(page, {
      label: "viewer-1",
      failures: { open_shot_in_editor: "mspaint.exe を起動できません" },
    });
    await page.goto("/");

    await page.getByRole("button", { name: "外部ツールで開く" }).click();
    const status = page.locator(".toolbar-status");
    await expect(status).toHaveText("mspaint.exe を起動できません");
    await expect(status).toHaveAttribute("data-tone", "error");
  });

  test("toggles always-on-top", async ({ page }) => {
    await installTauriMock(page, { label: "viewer-1" });
    await page.goto("/");

    await page.getByRole("button", { name: "最前面に固定" }).click();
    await expect(page.getByRole("button", { name: "最前面の固定を解除" })).toHaveAttribute("aria-pressed", "true");
  });

  test("drags the window from anywhere on the image", async ({ page }) => {
    await installTauriMock(page, { label: "viewer-1" });
    await page.goto("/");

    await expect(page.locator(".viewer-image")).toBeVisible();
    await page.locator(".viewer-stage").click({ position: { x: 5, y: 5 } });
    await expect.poll(() => commandNames(page)).toContain("plugin:window|start_dragging");
  });

  test("asks before closing when configured", async ({ page }) => {
    await installTauriMock(page, {
      label: "viewer-1",
      config: { viewer: { always_on_top: false, confirm_on_close: true } },
    });
    await page.goto("/");
    await expect(page.locator(".viewer-image")).toBeVisible();

    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("保存していない画像は失われます。");

    await dialog.getByRole("button", { name: "キャンセル" }).click();
    await expect(dialog).toBeHidden();
    expect(await commandNames(page)).not.toContain("plugin:window|close");

    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "閉じる" }).click();
    await expect.poll(() => commandNames(page)).toContain("plugin:window|close");
  });

  test("closes immediately by default", async ({ page }) => {
    await installTauriMock(page, { label: "viewer-1" });
    await page.goto("/");
    await expect(page.locator(".viewer-image")).toBeVisible();

    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect.poll(() => commandNames(page)).toContain("plugin:window|close");
    expect((await calls(page)).some((c) => c.cmd === "plugin:window|close")).toBe(true);
  });

  test("loads the image once instead of refetching on every render", async ({ page }) => {
    await installTauriMock(page, { label: "viewer-1" });
    await page.goto("/");
    await expect(page.locator(".viewer-image")).toBeVisible();
    await page.getByRole("button", { name: "画像をコピー" }).click();
    await page.waitForTimeout(1000);

    // 開発時の StrictMode では effect が2回走るので、2回までは正常
    const fetches = (await commandNames(page)).filter((cmd) => cmd === "shot_png");
    expect(fetches.length).toBeLessThanOrEqual(2);
  });

  test("closes with Escape", async ({ page }) => {
    await installTauriMock(page, { label: "viewer-1" });
    await page.goto("/");
    await expect(page.locator(".viewer-image")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect.poll(() => commandNames(page)).toContain("plugin:window|close");
  });

  test("Escape asks first when confirmation is on", async ({ page }) => {
    await installTauriMock(page, {
      label: "viewer-1",
      config: { viewer: { always_on_top: false, confirm_on_close: true } },
    });
    await page.goto("/");
    await expect(page.locator(".viewer-image")).toBeVisible();
    await page.waitForTimeout(200);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeHidden();
    expect(await commandNames(page)).not.toContain("plugin:window|close");
  });

  test("zooms smoothly with the wheel and fits again on double-click", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 500 });
    await installTauriMock(page, { label: "viewer-1" });
    await page.goto("/");
    const title = page.locator(".titlebar");
    await expect(title).toContainText("100%");

    const stage = page.locator(".viewer-stage");
    const box = (await stage.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await expect(title).not.toContainText(" 100%");
    await expect
      .poll(async () => (await page.locator(".viewer-image").boundingBox())!.width)
      .toBeGreaterThan(640 * 1.5);

    // 拡大中のドラッグはウィンドウ移動ではなくパンになる
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 3 });
    await page.mouse.up();
    expect(await commandNames(page)).not.toContain("plugin:window|start_dragging");

    await stage.dblclick();
    await expect(title).toContainText("100%");
    await expect.poll(async () => Math.round((await page.locator(".viewer-image").boundingBox())!.width)).toBe(640);
  });
});
