import type { Config } from "../../src/lib/api";

export function defaultConfig(): Config {
  return {
    hotkeys: { region: "Ctrl+PrintScreen", window: "Alt+PrintScreen", fullscreen: "Shift+PrintScreen" },
    capture: { auto_save: false, auto_copy: "image" },
    storage: { directory: "{pictures}/{appname}", format: "%Y-%m/%Y-%m-%d_%H-%M-%S.png" },
    viewer: { always_on_top: false, confirm_on_close: false },
    external: { tools: [{ name: "ペイント", command: "mspaint.exe", args: '"${file}"', hide_console: false, copy_stdout: false }] },
  };
}
