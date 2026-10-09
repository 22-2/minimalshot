import { invoke } from "@tauri-apps/api/core";

export type AutoCopy = "none" | "image" | "path";
export type CaptureKind = "region" | "window" | "fullscreen";

/** Rust 側の `config::Config` と同じ形。 */
export type Config = {
  hotkeys: { region: string; window: string; fullscreen: string };
  capture: { auto_save: boolean; auto_copy: AutoCopy };
  storage: { directory: string; format: string };
  viewer: { always_on_top: boolean; confirm_on_close: boolean };
  external: { tools: ExternalTool[] };
};

export type ExternalTool = {
  name: string;
  command: string;
  args: string;
  hide_console: boolean;
  copy_stdout: boolean;
};

/** 外部ツールを起動しただけか、出力をクリップボードへコピーしたか。 */
export type ToolOutcome = "launched" | "copied";

export type ShotInfo = {
  id: number;
  width: number;
  height: number;
  savedPath: string | null;
};

export type Rect = { x: number; y: number; width: number; height: number };

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  openConfigFolder: () => invoke<void>("open_config_folder"),
  saveConfig: (config: Config) => invoke<void>("save_config", { config }),
  capture: (kind: CaptureKind) => invoke<void>("capture", { kind }),

  shotInfo: () => invoke<ShotInfo>("shot_info"),
  viewerSession: () => invoke<number | null>("viewer_session"),
  shotPng: () => invoke<BinaryPayload>("shot_png").then(toBytes),
  saveShot: () => invoke<string>("save_shot"),
  copyShotImage: () => invoke<void>("copy_shot_image"),
  copyShotPath: () => invoke<void>("copy_shot_path"),
  openShotWith: (tool: number) => invoke<ToolOutcome>("open_shot_with", { tool }),
  revealShot: () => invoke<void>("reveal_shot"),
  saveShotAs: () => invoke<string | null>("save_shot_as"),
  deleteSavedShot: () => invoke<void>("delete_saved_shot"),
  openSettings: () => invoke<void>("open_settings"),
  showWindow: (session?: number) => invoke<void>("show_window", { session: session ?? null }),

  regionSession: () => invoke<number | null>("region_session"),
  prepareRegion: () => invoke<{ width: number; height: number; renderWhileHidden: boolean }>("prepare_region"),
  regionPng: (session: number) => invoke<BinaryPayload>("region_png", { session }).then(toBytes),
  finishRegion: (rect: Rect, session: number) => invoke<void>("finish_region", { rect, session }),
  cancelRegion: () => invoke<void>("cancel_region"),
};

/** 通常は ArrayBuffer で届くが、IPC が postMessage に落ちた場合は数値配列になる。 */
export type BinaryPayload = ArrayBuffer | Uint8Array | number[];

export function toBytes(payload: BinaryPayload): Uint8Array<ArrayBuffer> {
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  return Uint8Array.from(payload);
}

export function pngUrl(bytes: Uint8Array<ArrayBuffer>): string {
  return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
