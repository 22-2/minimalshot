import type { Page } from "@playwright/test";

type MockOptions = {
  label: string;
  config?: Record<string, unknown>;
  /** 指定したコマンドを、この文言で失敗させる。 */
  failures?: Record<string, string>;
};

export type Call = { cmd: string; args: Record<string, unknown> };

/**
 * Tauri ランタイムの代わりに `window.__TAURI_INTERNALS__` を差し込む。
 * 呼ばれたコマンドは `window.__calls` に残し、テストから検証する。
 */
export async function installTauriMock(page: Page, options: MockOptions) {
  await page.addInitScript((opts: MockOptions) => {
    const calls: Call[] = [];
    let savedPath: string | null = null;
    let pinned = false;
    const config = {
      hotkeys: { region: "Ctrl+PrintScreen", window: "Alt+PrintScreen", fullscreen: "Shift+PrintScreen" },
      capture: { auto_save: false, auto_copy: "image" },
      storage: { directory: "{pictures}/{appname}", format: "%Y-%m/%Y-%m-%d_%H-%M-%S.png" },
      viewer: { always_on_top: false, confirm_on_close: false },
      external: {
        tools: [
          { name: "ペイント", command: "mspaint.exe", args: '"${file}"', hide_console: false, copy_stdout: false },
          { name: "GIMP", command: "gimp.exe", args: '"${file}"', hide_console: false, copy_stdout: false },
        ],
      },
      ...opts.config,
    };

    async function png(width: number, height: number): Promise<ArrayBuffer> {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#3a6ea5";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(width / 4, height / 4, width / 2, height / 2);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
      return blob.arrayBuffer();
    }

    const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
      get_config: () => config,
      save_config: () => undefined,
      shot_info: () => ({ id: 1, width: 640, height: 360, savedPath }),
      shot_png: () => png(640, 360),
      save_shot: () => (savedPath = "C:\\Users\\me\\Pictures\\MinimaShot\\2026-10\\2026-10-09_12-00-00.png"),
      copy_shot_image: () => undefined,
      copy_shot_path: () => undefined,
      open_shot_with: (args) => {
        const tools = (config.external as { tools: { copy_stdout: boolean }[] }).tools;
        return tools[args.tool as number]?.copy_stdout ? "copied" : "launched";
      },
      reveal_shot: () => undefined,
      save_shot_as: () => (savedPath = "D:\\shots\\named.png"),
      delete_saved_shot: () => {
        savedPath = null;
      },
      open_settings: () => undefined,
      region_png: () => png(window.innerWidth, window.innerHeight),
      finish_region: () => undefined,
      cancel_region: () => undefined,
      "plugin:window|is_always_on_top": () => pinned,
      "plugin:window|set_always_on_top": (args) => {
        pinned = Boolean(args.value);
      },
    };

    Object.assign(window, {
      __calls: calls,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: opts.label },
          currentWebview: { windowLabel: opts.label, label: opts.label },
        },
        transformCallback: () => Math.floor(Math.random() * 1e9),
        unregisterCallback: () => undefined,
        convertFileSrc: (path: string) => path,
        invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
          calls.push({ cmd, args });
          const failure = opts.failures?.[cmd];
          if (failure) throw failure;
          return handlers[cmd]?.(args);
        },
      },
    });
  }, options);
}

export function calls(page: Page): Promise<Call[]> {
  return page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls);
}

export async function commandNames(page: Page): Promise<string[]> {
  return (await calls(page)).map((call) => call.cmd);
}
