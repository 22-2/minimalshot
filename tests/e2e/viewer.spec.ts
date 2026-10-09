import { expect, test, type Page } from "@playwright/test";

import { calls, commandNames, installTauriMock } from "./tauri-mock";

async function openViewer(page: Page, options: Parameters<typeof installTauriMock>[1] = { label: "viewer-1" }) {
  await installTauriMock(page, options);
  await page.goto("/");
  await expect(page.locator(".viewer-image")).toBeVisible();
}

/** 右クリックメニューから項目を選ぶ。 */
async function choose(page: Page, ...path: string[]) {
  await page.locator(".viewer-stage").click({ button: "right", position: { x: 40, y: 40 } });
  for (const [index, name] of path.entries()) {
    const item = page.getByRole("menuitem", { name, exact: true });
    if (index < path.length - 1) await item.hover();
    else await item.click();
  }
}

const toast = (page: Page) => page.locator(".viewer-toast");

test.describe("viewer", () => {
  test("shows the capture under a thin custom title bar with no bottom bar", async ({ page }) => {
    await openViewer(page);

    await expect(page.locator(".titlebar")).toContainText("640 × 360");
    await expect(page.locator(".titlebar")).toHaveCSS("height", "32px");
    for (const name of ["最小化", "最大化", "閉じる"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.locator("footer")).toHaveCount(0);
  });

  test("right-click menu lists every action in order", async ({ page }) => {
    await openViewer(page);

    await page.locator(".viewer-stage").click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText([
      "パスのコピー",
      "画像をコピー",
      "既定の場所に保存",
      "名前を付けて保存",
      "外部ツールで開く",
      "設定",
    ]);
    await expect(menu.getByRole("menuitemcheckbox")).toHaveText("常に最前面に表示");
    await expect(menu.getByRole("separator")).toHaveCount(2);
    await expect(menu).toHaveCSS("font-size", "12px");
  });

  test("copies the image and the path once saved", async ({ page }) => {
    await openViewer(page);

    await page.locator(".viewer-stage").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "パスのコピー" })).toHaveAttribute("data-disabled", "");
    await page.getByRole("menuitem", { name: "画像をコピー" }).click();
    await expect(toast(page)).toHaveText("画像をコピーしました");

    await choose(page, "既定の場所に保存");
    await expect(toast(page)).toHaveText("保存しました");
    await choose(page, "パスのコピー");
    await expect(toast(page)).toHaveText("パスをコピーしました");
    expect(await commandNames(page)).toEqual(expect.arrayContaining(["save_shot", "copy_shot_path"]));
  });

  test("the notice disappears after a moment", async ({ page }) => {
    await openViewer(page);
    await choose(page, "画像をコピー");
    await expect(toast(page)).toBeVisible();
    await expect(toast(page)).toBeHidden({ timeout: 4000 });
  });

  test("saves with a chosen name", async ({ page }) => {
    await openViewer(page);
    await choose(page, "名前を付けて保存");
    await expect(toast(page)).toHaveText("保存しました");
  });

  test("opens a registered tool from the submenu", async ({ page }) => {
    await openViewer(page);
    await choose(page, "外部ツールで開く", "GIMP");
    await expect(toast(page)).toHaveText("外部ツールで開きました");
    const call = (await calls(page)).find((c) => c.cmd === "open_shot_with");
    expect(call?.args).toEqual({ tool: 1 });
  });

  test("title bar button opens the same tool list", async ({ page }) => {
    await openViewer(page);
    const button = page.locator(".titlebar").getByRole("button", { name: "外部ツールで開く" });
    // ウィンドウ操作ボタンのすぐ左に並ぶ
    const minimize = (await page.getByRole("button", { name: "最小化" }).boundingBox())!;
    const box = (await button.boundingBox())!;
    expect(minimize.x - (box.x + box.width)).toBeLessThan(16);

    await button.click();
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["ペイント", "GIMP"]);
    await page.getByRole("menuitem", { name: "GIMP" }).click();
    const call = (await calls(page)).find((c) => c.cmd === "open_shot_with");
    expect(call?.args).toEqual({ tool: 1 });
  });

  test("tools that copy their output report it", async ({ page }) => {
    await openViewer(page, {
      label: "viewer-1",
      config: {
        external: {
          tools: [{ name: "OCR", command: "tesseract.exe", args: '"${file}" stdout', hide_console: true, copy_stdout: true }],
        },
      },
    });
    await choose(page, "外部ツールで開く", "OCR");
    await expect(toast(page)).toHaveText("出力をクリップボードにコピーしました");
  });

  test("shows backend errors as a notice", async ({ page }) => {
    await openViewer(page, { label: "viewer-1", failures: { open_shot_with: "ペイント を起動できません" } });
    await choose(page, "外部ツールで開く", "ペイント");
    await expect(toast(page)).toHaveText("ペイント を起動できません");
    await expect(toast(page)).toHaveAttribute("data-tone", "error");
  });

  test("saved shots can be revealed and deleted", async ({ page }) => {
    await openViewer(page);
    await choose(page, "既定の場所に保存");
    await expect(toast(page)).toHaveText("保存しました");

    await page.locator(".viewer-stage").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "既定の場所に保存" })).toHaveAttribute("data-disabled", "");
    await page.getByRole("menuitem", { name: "エクスプローラーで開く" }).click();
    await expect.poll(() => commandNames(page)).toContain("reveal_shot");

    await page.locator(".viewer-stage").click({ button: "right" });
    const remove = page.getByRole("menuitem", { name: "保存したファイルを削除" });
    await expect(remove).toHaveCSS("color", "rgb(255, 123, 114)");
    await remove.hover();
    // 選択中は危険色で塗りつぶす
    await expect(remove).toHaveCSS("background-color", "rgb(255, 123, 114)");
    await remove.click();
    await expect(toast(page)).toHaveText("ごみ箱に移動しました");
    await page.locator(".viewer-stage").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "保存したファイルを削除" })).toHaveCount(0);
  });

  test("toggles always-on-top from the menu", async ({ page }) => {
    await openViewer(page);
    await page.locator(".viewer-stage").click({ button: "right" });
    await page.getByRole("menuitemcheckbox", { name: "常に最前面に表示" }).click();
    await expect.poll(() => commandNames(page)).toContain("plugin:window|set_always_on_top");

    await page.locator(".viewer-stage").click({ button: "right" });
    await expect(page.getByRole("menuitemcheckbox", { name: "常に最前面に表示" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("opens settings from the menu", async ({ page }) => {
    await openViewer(page);
    await choose(page, "設定");
    await expect.poll(() => commandNames(page)).toContain("open_settings");
  });

  test("pans a little into the empty space even when not zoomed", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 500 });
    await openViewer(page);
    const image = page.locator(".viewer-image");
    const before = (await image.boundingBox())!;
    const box = (await page.locator(".viewer-stage").boundingBox())!;

    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 1000, box.y + 100, { steps: 5 });
    await page.mouse.up();

    // 余白はステージ幅の 25% まで。それ以上は止まる
    const after = (await image.boundingBox())!;
    expect(after.x - before.x).toBeGreaterThan(100);
    expect(after.x - before.x).toBeLessThanOrEqual(box.width * 0.25 + 1);
  });


  test("drag on the image never moves the window", async ({ page }) => {
    await openViewer(page);
    const box = (await page.locator(".viewer-stage").boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 60, { steps: 3 });
    await page.mouse.up();
    expect(await commandNames(page)).not.toContain("plugin:window|start_dragging");
  });

  test("loads the image once instead of refetching on every render", async ({ page }) => {
    await openViewer(page);
    await choose(page, "画像をコピー");
    await page.waitForTimeout(1000);

    // 開発時の StrictMode では effect が2回走るので、2回までは正常
    const fetches = (await commandNames(page)).filter((cmd) => cmd === "shot_png");
    expect(fetches.length).toBeLessThanOrEqual(2);
  });

  test("closes with Escape", async ({ page }) => {
    await openViewer(page);
    await page.keyboard.press("Escape");
    await expect.poll(() => commandNames(page)).toContain("plugin:window|close");
  });

  test("Escape closes an open menu without closing the window", async ({ page }) => {
    await openViewer(page);
    await page.locator(".viewer-stage").click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    expect(await commandNames(page)).not.toContain("plugin:window|close");
  });

  test("asks before closing when configured", async ({ page }) => {
    await openViewer(page, { label: "viewer-1", config: { viewer: { always_on_top: false, confirm_on_close: true } } });
    await page.waitForTimeout(200);

    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("保存していない画像は失われます。");
    await dialog.getByRole("button", { name: "キャンセル" }).click();
    await expect(dialog).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeHidden();
    expect(await commandNames(page)).not.toContain("plugin:window|close");

    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "閉じる" }).click();
    await expect.poll(() => commandNames(page)).toContain("plugin:window|close");
  });

  test("zooms with the wheel, pans while zoomed and fits again on double-click", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 500 });
    await openViewer(page);
    const title = page.locator(".titlebar");
    await expect(title).toContainText("100%");

    const stage = page.locator(".viewer-stage");
    const box = (await stage.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await expect(title).not.toContainText(" 100%");
    await expect.poll(async () => (await page.locator(".viewer-image").boundingBox())!.width).toBeGreaterThan(640 * 1.5);

    const before = (await page.locator(".viewer-image").boundingBox())!.x;
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await page.locator(".viewer-image").boundingBox())!.x).toBeGreaterThan(before + 25);

    await stage.dblclick();
    await expect(title).toContainText("100%");
    await expect.poll(async () => Math.round((await page.locator(".viewer-image").boundingBox())!.width)).toBe(640);
  });
});
