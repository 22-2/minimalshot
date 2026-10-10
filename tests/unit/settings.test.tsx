import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
    useSettings.setState({ draft: null, status: null, saving: false });
    mockWindows("settings");
    mockIPC((cmd, args) => {
      if (cmd === "get_config") return defaultConfig();
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

  // 撮影モードの見出しは「モード名 キー 処理」と読まれる。「モード名: 〜」の操作ボタンとは区別する
  const openMode = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(await screen.findByRole("button", { name: new RegExp(`^${name} `), expanded: false }));
    return screen.getByRole("region", { name });
  };

  it("edits external tools and saves them", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, "外部ツール");
    await user.click(screen.getByRole("button", { name: "ペイント mspaint.exe" }));

    const command = screen.getByLabelText("コマンド");
    expect(command).toHaveValue("mspaint.exe");
    await user.clear(command);
    await user.type(command, "paint.net");
    await user.click(screen.getByRole("button", { name: "ツールを追加" }));
    await user.type(screen.getAllByLabelText("名前")[1], "GIMP");
    await user.type(screen.getAllByLabelText("コマンド")[1], "gimp.exe");
    // 出力をコピーするツールは、コンソール非表示が強制される
    await user.click(screen.getAllByRole("switch", { name: "標準出力をコピー" })[1]);
    expect(screen.getAllByRole("switch", { name: "コンソールを表示しない" })[1]).toBeDisabled();
    expect(screen.getAllByRole("switch", { name: "コンソールを表示しない" })[1]).toBeChecked();
    await user.click(screen.getByRole("button", { name: "設定を保存" }));

    expect(await screen.findByText("設定を保存しました")).toBeInTheDocument();
    expect(saved[0]).toMatchObject({
      external: {
        tools: [
          { name: "ペイント", command: "paint.net", args: '"${file}"', hide_console: false, copy_stdout: false },
          { name: "GIMP", command: "gimp.exe", args: '"${file}"', hide_console: false, copy_stdout: true },
        ],
      },
    });
  });

  it("stores actions for one capture mode without touching the others", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    // 閉じていても、キーと撮影後の処理を見出しで読める
    const trigger = await screen.findByRole("button", { name: "領域をキャプチャ Ctrl + PrintScreen 画像をコピー" });
    const region = await openMode(user, "領域をキャプチャ");

    await user.click(within(region).getByRole("combobox", { name: "クリップボードへコピー" }));
    await user.click(await screen.findByRole("option", { name: "パス（保存時のみ）" }));
    await user.click(within(region).getByRole("switch", { name: "自動で画像を保存する" }));
    expect(trigger).toHaveAccessibleName("領域をキャプチャ Ctrl + PrintScreen パスをコピー 画像を保存");
    await user.click(screen.getByRole("button", { name: "設定を保存" }));

    await screen.findByText("設定を保存しました");
    const config = saved[0] as ReturnType<typeof defaultConfig>;
    expect(config.capture.region).toEqual({ auto_save: true, auto_copy: "path" });
    expect(config.capture.window).toBeUndefined();
    expect(config.capture).toMatchObject({ auto_save: false, auto_copy: "image" });
  });

  it("records shortcuts from key presses and removes them", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openMode(user, "領域をキャプチャ");
    const fullscreen = await openMode(user, "全画面をキャプチャ");

    await user.click(screen.getByRole("button", { name: "領域をキャプチャ: ショートカットを追加" }));
    // 修飾キーを伴わない入力は無視して、記録を続ける
    await user.keyboard("z");
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(screen.getByText("Ctrl + Shift + Z")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "全画面をキャプチャ: ショートカットを削除 Shift+PrintScreen" }));
    expect(within(fullscreen).getByText("未設定")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "設定を保存" }));

    await screen.findByText("設定を保存しました");
    expect(saved[0]).toMatchObject({
      hotkeys: { region: ["Ctrl+PrintScreen", "Ctrl+Shift+Z"], fullscreen: [] },
    });
  });

  it("cancels recording with Escape and marks duplicated shortcuts", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openMode(user, "ウィンドウをキャプチャ");
    await openMode(user, "全画面をキャプチャ");

    await user.click(screen.getByRole("button", { name: "ウィンドウをキャプチャ: ショートカットを追加" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByText("キーを押してください")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ウィンドウをキャプチャ: ショートカットを追加" }));
    await user.keyboard("{Shift>}[PrintScreen]{/Shift}");
    expect(screen.getAllByTitle("他のショートカットと重複しています")).toHaveLength(2);
  });

  it("removes a tool from inside its section", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openTab(user, "外部ツール");

    // 閉じていても名前とコマンドは見出しで読める
    await user.click(screen.getByRole("button", { name: "ペイント mspaint.exe" }));
    await user.click(within(screen.getByRole("region", { name: "ペイント" })).getByRole("button", { name: "このツールを削除" }));
    expect(screen.getByText("ツールが登録されていません。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "設定を保存" }));

    await screen.findByText("設定を保存しました");
    expect(saved[0]).toMatchObject({ external: { tools: [] } });
  });

  it("shows validation errors from the backend", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await openMode(user, "領域をキャプチャ");

    await user.click(screen.getByRole("button", { name: "領域をキャプチャ: ショートカットを追加" }));
    await user.keyboard("{Control>}{Alt>}p{/Alt}{/Control}");
    await user.click(screen.getByRole("button", { name: "設定を保存" }));

    expect(await screen.findByText(/他のアプリが使用中です/)).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });
});
