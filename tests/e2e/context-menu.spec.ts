import { expect, test } from "@playwright/test";

import { calls, installTauriMock } from "./tauri-mock";

const tools = [
  { name: "ペイント", command: "mspaint.exe", args: "", hide_console: false, copy_stdout: false },
];

test("renders the viewer menu in its own window and reports the selected action", async ({ page }) => {
  await installTauriMock(page, {
    label: "context-menu",
    viewerMenuState: { requestId: 1, saved: false, pinned: false, tools },
  });
  await page.goto("/");

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(page.locator(".context-menu-anchor")).toBeAttached();
  await expect(menu.getByRole("menuitem", { name: "画像をコピー", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "既定の場所に保存", exact: true })).toBeVisible();

  // 内容の実寸を Rust 側へ渡し、窓の大きさと位置を決めてもらう
  await expect
    .poll(async () => (await calls(page)).find((call) => call.cmd === "show_viewer_menu")?.args)
    .toMatchObject({ width: expect.any(Number), height: expect.any(Number) });

  await menu.getByRole("menuitem", { name: "画像をコピー", exact: true }).click();
  await expect
    .poll(async () => (await calls(page)).find((call) => call.cmd === "select_viewer_menu_item")?.args)
    .toEqual({ id: "copy-image", checked: null });
});
