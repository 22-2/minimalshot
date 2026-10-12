import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

import { Settings } from "../../src/views/Settings";
import { useSettings } from "../../src/stores/settings";
import { defaultConfig } from "./fixtures";

// Tauri の mockIPC はイベントの listener 管理を実装しない。再表示は E2E で検証する。
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

describe("Settings", () => {
  let saved: unknown[];

  beforeEach(() => {
    saved = [];
    useSettings.setState({ draft: null, status: null });
    mockWindows("settings");
    mockIPC((cmd, args) => {
      if (cmd === "get_config" || cmd === "get_default_config") return defaultConfig();
      if (cmd === "save_config") {
        const config = (args as { config: ReturnType<typeof defaultConfig> }).config;
        if (config.hotkeys.region.includes("Ctrl+Alt+P")) throw "Ctrl+Alt+P を登録できません: 他のアプリが使用中です";
        saved.push(config);
      }
    });
  });

  const openTab = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(await screen.findByRole("tab", { name }));
  };

  // 保存ボタンは無く、変更が止まると自動で保存される
  const expectSaved = (expected: object) => waitFor(() => expect(saved.at(-1)).toMatchObject(expected));

  // 行からモード別の設定を開く。
  const openMode = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(await screen.findByRole("button", { name }));
    return screen.getByRole("region", { name });
  };

  it("edits external tools and saves them", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, "外部ツール");
    await user.click(screen.getByRole("button", { name: "ペイント" }));

    const command = screen.getByLabelText("コマンド");
    expect(command).toHaveValue("mspaint.exe");
    await user.clear(command);
    await user.type(command, "paint.net");
    await user.click(screen.getByRole("button", { expanded: true }));
    await user.click(screen.getByRole("button", { name: "ツールを追加" }));
    // 名前とコマンドが揃うまでは、検証エラーにせず保存を待つ
    expect(await screen.findByText("外部ツールの名前とコマンドを入力すると保存します")).toBeInTheDocument();
    await user.type(screen.getByLabelText("名前"), "GIMP");
    await user.type(screen.getByLabelText("コマンド"), "gimp.exe");
    // 出力をコピーするツールは、コンソール非表示が強制される
    await user.click(screen.getByRole("switch", { name: "標準出力をコピー" }));
    expect(screen.getByRole("switch", { name: "コンソールを表示しない" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "コンソールを表示しない" })).toBeChecked();

    expect(await screen.findByText("設定を保存しました")).toBeInTheDocument();
    await expectSaved({
      external: {
        tools: [
          { name: "ペイント", command: "paint.net", args: '"${file}"', hide_console: false, copy_stdout: false },
          defaultConfig().external.tools[1],
          { name: "GIMP", command: "gimp.exe", args: '"${file}"', hide_console: false, copy_stdout: true },
        ],
      },
    });
  });

  it("stores actions for one capture mode without touching the others", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    const region = await openMode(user, "領域をキャプチャ");

    await user.click(within(region).getByRole("combobox", { name: "クリップボードへコピー" }));
    await user.click(await screen.findByRole("option", { name: "パス（保存時のみ）" }));
    await user.click(within(region).getByRole("switch", { name: "自動で画像を保存する" }));

    await expectSaved({ capture: { region: { auto_save: true, auto_copy: "path" } } });
    const config = saved.at(-1) as ReturnType<typeof defaultConfig>;
    expect(config.capture.region).toEqual({ auto_save: true, auto_copy: "path", open_viewer: true });
    expect(config.capture.window).toBeUndefined();
    expect(config.capture).toMatchObject({ auto_save: false, auto_copy: "image" });
  });

  it("disables the viewer for one mode while preserving its output actions", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    const region = await openMode(user, "領域をキャプチャ");
    await user.click(within(region).getByRole("switch", { name: "撮影後にウィンドウを開かない" }));
    await expectSaved({ capture: { region: { open_viewer: false, auto_copy: "image", auto_save: false } } });
    expect(within(region).getByRole("switch", { name: "撮影後にウィンドウを開かない" })).toBeChecked();
    await user.click(within(region).getByRole("switch", { name: "撮影後にウィンドウを開かない" }));
    await expectSaved({ capture: { region: { open_viewer: true } } });
  });

  it("records shortcuts from key presses and removes them", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openMode(user, "領域をキャプチャ");

    await user.click(screen.getByRole("button", { name: "領域をキャプチャ: ショートカットを追加" }));
    // 修飾キーを伴わない入力は無視して、記録を続ける
    await user.keyboard("z");
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(screen.getByText("Ctrl+Shift+Z")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { expanded: true }));
    const fullscreen = await openMode(user, "アクティブなディスプレイをキャプチャ");
    await user.click(screen.getByRole("button", { name: "アクティブなディスプレイをキャプチャ: ショートカットを削除 Alt+PrintScreen" }));
    expect(within(fullscreen).getByText("未設定")).toBeInTheDocument();

    await expectSaved({
      hotkeys: { region: ["Ctrl+PrintScreen", "Ctrl+Shift+Z"], fullscreen: [] },
    });
  });

  it("cancels recording with Escape and marks duplicated shortcuts", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openMode(user, "アクティブなウィンドウをキャプチャ");

    await user.click(screen.getByRole("button", { name: "アクティブなウィンドウをキャプチャ: ショートカットを追加" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByText("キーを押してください")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "アクティブなウィンドウをキャプチャ: ショートカットを追加" }));
    await user.keyboard("{Alt>}[PrintScreen]{/Alt}");
    expect(screen.getAllByTitle("他のショートカットと重複しています")).toHaveLength(1);
    await user.click(screen.getByRole("button", { expanded: true }));
    await openMode(user, "アクティブなディスプレイをキャプチャ");
    expect(screen.getByTitle("他のショートカットと重複しています")).toBeInTheDocument();
  });

  it("removes a tool from inside its section", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, "外部ツール");

    // ツール名の行から設定を開く
    await user.click(screen.getByRole("button", { name: "ペイント" }));
    expect(screen.queryByRole("button", { name: "設定を保存" })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "ペイント" })).getByRole("button", { name: "このツールを削除" }));
    expect(screen.getByRole("button", { name: "文字認識してメモ帳で開く" })).toBeInTheDocument();

    await expectSaved({ external: { tools: [defaultConfig().external.tools[1]] } });
  });

  it("writes pending changes before the window closes", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, "ビューア");

    await user.click(screen.getByRole("switch", { name: "常に最前面に表示" }));
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    // 自動保存を待たずに書き出す
    expect(saved.at(-1)).toMatchObject({ viewer: { always_on_top: true } });
  });

  it("shows validation errors from the backend", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openMode(user, "領域をキャプチャ");

    await user.click(screen.getByRole("button", { name: "領域をキャプチャ: ショートカットを追加" }));
    await user.keyboard("{Control>}{Alt>}p{/Alt}{/Control}");

    expect(await screen.findByText(/他のアプリが使用中です/)).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });
});
