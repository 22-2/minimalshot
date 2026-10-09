import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

import { Settings } from "../../src/views/Settings";
import { useSettings } from "../../src/stores/settings";
import { defaultConfig } from "./fixtures";

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
        if (config.hotkeys.region === "PrintScreen") throw "ショートカット「PrintScreen」には修飾キーが必要です";
        saved.push(config);
      }
    });
  });

  it("loads the config and saves edits", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const editor = await screen.findByLabelText("実行ファイル");
    expect(editor).toHaveValue("mspaint.exe");

    await user.clear(editor);
    await user.type(editor, "paint.net");
    await user.click(screen.getByRole("switch", { name: "自動で保存する" }));
    await user.click(screen.getByRole("radio", { name: "パス（保存時のみ）" }));
    await user.click(screen.getByRole("button", { name: "設定を保存" }));

    expect(await screen.findByText("設定を保存しました")).toBeInTheDocument();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      capture: { auto_save: true, auto_copy: "path" },
      external: { editor: "paint.net" },
    });
  });

  it("shows validation errors from the backend", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const region = await screen.findByLabelText("領域");
    await user.clear(region);
    await user.type(region, "PrintScreen");
    await user.click(screen.getByRole("button", { name: "設定を保存" }));

    expect(await screen.findByText(/修飾キーが必要です/)).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });
});
