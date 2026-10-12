import type { Config } from "../../src/lib/api";

export function defaultConfig(): Config {
  return {
    hotkeys: { region: ["Ctrl+PrintScreen"], window: ["Shift+PrintScreen"], fullscreen: ["Alt+PrintScreen"], desktop: [], clipboard: [] },
    capture: { auto_save: false, auto_copy: "image", clipboard: { auto_save: false, auto_copy: "none" } },
    storage: { directory: "{pictures}/{appname}", format: "%Y-%m/%Y-%m-%d_%H-%M-%S.png" },
    viewer: { always_on_top: false, confirm_on_close: false, layout: "source" },
    external: {
      tools: [
        { name: "ペイント", command: "mspaint.exe", args: '"${file}"', hide_console: false, copy_stdout: false },
        {
          name: "文字認識してメモ帳で開く",
          command: "powershell.exe",
          args: '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${configDirname}/ocr.ps1" -ImagePath "${file}" -Scale 3 -PageSegmentationMode 3',
          hide_console: true,
          copy_stdout: false,
        },
      ],
    },
  };
}
