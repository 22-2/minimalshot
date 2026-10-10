import type { Page } from "@playwright/test";

type MockOptions = {
  label: string;
  config?: Record<string, unknown>;
  /** 指定したコマンドを、この文言で失敗させる。 */
  failures?: Record<string, string>;
  delays?: Record<string, number>;
  holdFirst?: string[];
  viewerSession?: number | null;
  regionSession?: number | null;
};

export type Call = { cmd: string; args: Record<string, unknown> };

/**
 * Tauri ランタイムの代わりに `window.__TAURI_INTERNALS__` を差し込む。
 * 呼ばれたコマンドは `window.__calls` に残し、テストから検証する。
 */
export async function installTauriMock(page: Page, options: MockOptions) {
  await page.addInitScript((opts: MockOptions) => {
    const calls: Call[] = [];
    const presentations: { session: unknown; imagesReady: boolean; settingsReady: boolean }[] = [];
    let savedPath: string | null = null;
    let pinned = false;
    let regionSession: number | null = opts.regionSession === undefined ? 1 : opts.regionSession;
    let viewerSession: number | null = opts.viewerSession === undefined ? 1 : opts.viewerSession;
    let nextId = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    const held = new Map<string, () => void>();
    const callCounts = new Map<string, number>();
    const emit = (event: string, payload?: unknown) => {
      if (event === "region-load") regionSession = payload as number;
      if (event === "viewer-load") viewerSession = payload as number;
      if (event === "shot-saved") savedPath = payload as string;
      for (const [id, listener] of listeners) {
        if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
      }
    };
    const config = {
      hotkeys: { region: ["Ctrl+PrintScreen"], window: ["Alt+PrintScreen"], fullscreen: ["Shift+PrintScreen"] },
      capture: { auto_save: false, auto_copy: "image" },
      storage: { directory: "{pictures}/{appname}", format: "%Y-%m/%Y-%m-%d_%H-%M-%S.png" },
      viewer: { always_on_top: false, confirm_on_close: false, layout: "source" },
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
      open_config_folder: () => undefined,
      save_config: () => undefined,
      viewer_session: () => viewerSession,
      shot_info: () => ({ id: viewerSession, width: 640, height: 360, savedPath }),
      shot_png: () => png(640, 360),
      save_shot: () => (savedPath = "C:\\Users\\me\\Pictures\\MinimalShot\\2026-10\\2026-10-09_12-00-00.png"),
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
      open_about: () => undefined,
      app_version: () => "0.0.9",
      show_window: (args) => {
        const images = Array.from(document.querySelectorAll<HTMLImageElement>(".viewer-image, .region-image"));
        presentations.push({
          session: args.session,
          imagesReady: images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0),
          settingsReady: document.querySelector(".setting-page") !== null,
        });
      },
      region_session: () => regionSession,
      prepare_region: () => ({ width: window.innerWidth, height: window.innerHeight, renderWhileHidden: true }),
      region_png: () => png(window.innerWidth, window.innerHeight),
      finish_region: () => { regionSession = null; emit("region-reset"); },
      cancel_region: () => { regionSession = null; emit("region-reset"); },
      "plugin:event|listen": (args) => {
        const id = ++nextId;
        listeners.set(id, { event: args.event as string, handler: args.handler as number });
        return id;
      },
      "plugin:event|unlisten": (args) => listeners.delete(args.eventId as number),
      "plugin:window|is_always_on_top": () => pinned,
      "plugin:window|set_always_on_top": (args) => {
        pinned = Boolean(args.value);
      },
    };

    Object.assign(window, {
      __calls: calls,
      __presentations: presentations,
      __emit: emit,
      __release: (cmd: string) => held.get(cmd)?.(),
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: opts.label },
          currentWebview: { windowLabel: opts.label, label: opts.label },
        },
        transformCallback: (callback: (event: unknown) => void) => {
          const id = ++nextId;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        convertFileSrc: (path: string) => path,
        invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
          calls.push({ cmd, args });
          const count = (callCounts.get(cmd) ?? 0) + 1;
          callCounts.set(cmd, count);
          if (count === 1 && opts.holdFirst?.includes(cmd)) {
            await new Promise<void>((resolve) => held.set(cmd, resolve));
            held.delete(cmd);
          }
          const failure = opts.failures?.[cmd];
          if (failure) throw failure;
          const delay = opts.delays?.[cmd];
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
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
