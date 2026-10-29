import { invoke } from "@tauri-apps/api/core";

export type AutoCopy = "none" | "image" | "path";
export type ViewerLayout = "source" | "framed" | "remember";
export type ViewerSize = { width: number; height: number };
export type CaptureKind = "region" | "window" | "fullscreen" | "desktop" | "clipboard";
export type ScreenCaptureKind = Exclude<CaptureKind, "clipboard">;
export type CaptureActions = { auto_save: boolean; auto_copy: AutoCopy; open_viewer: boolean };
export type CaptureOverride = Partial<CaptureActions>;

/** Rust 側の `config::Config` と同じ形。 */
export type Config = {
  hotkeys: Record<CaptureKind, string[]>;
  capture: CaptureActions & Partial<Record<ScreenCaptureKind, CaptureOverride>> & { clipboard?: { auto_save: boolean } };
  storage: { directory: string; format: string };
  viewer: {
    always_on_top: boolean;
    confirm_on_close: boolean;
    layout: ViewerLayout;
    zoom_sensitivity: number;
    remembered_size?: ViewerSize;
  };
  external: { tools: ExternalTool[] };
};

export type ExternalTool = {
  enabled?: boolean;
  name: string;
  command: string;
  args: string;
  hide_console: boolean;
  copy_stdout: boolean;
};

/** 外部ツールを起動しただけか、出力をクリップボードへコピーしたか。 */
export type ToolOutcome = "launched" | "copied";

export type CompletedActions = { saved: boolean; copied: AutoCopy | null };

export type ShotInfo = {
  id: number;
  width: number;
  height: number;
  savedPath: string | null;
};

export type EditorSession = {
  id: number;
  width: number;
  height: number;
};

export type Rect = { x: number; y: number; width: number; height: number };

export type ViewerMenuState = { saved: boolean; pinned: boolean; tools: ExternalTool[] };
/** メニュー窓が読み込み直後に内容を取り直すための、リクエスト番号付きの状態。 */
export type ViewerMenuRequest = ViewerMenuState & { requestId: number };
export type ViewerMenuAction = { id: string; checked?: boolean };

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  getDefaultConfig: () => invoke<Config>("get_default_config"),
  openConfigFolder: () => invoke<void>("open_config_folder"),
  openSaveFolder: () => invoke<void>("open_save_folder"),
  saveConfig: (config: Config) => invoke<void>("save_config", { config }),
  exportConfig: (config: Config) => invoke<string | null>("export_config", { config }),
  importConfig: () => invoke<Config | null>("import_config"),
  capture: (kind: CaptureKind) => invoke<void>("capture", { kind }),

  shotInfo: () => invoke<ShotInfo>("shot_info"),
  viewerSession: () => invoke<number | null>("viewer_session"),
  viewerMenuAvailable: () => invoke<boolean>("viewer_menu_available"),
  openViewerMenu: (state: ViewerMenuState) => invoke<boolean>("open_viewer_menu", { state }),
  viewerMenuState: () => invoke<ViewerMenuRequest | null>("viewer_menu_state"),
  showViewerMenu: (width: number, height: number) => invoke<void>("show_viewer_menu", { width, height }),
  hideViewerMenu: () => invoke<void>("hide_viewer_menu"),
  selectViewerMenuItem: (id: string, checked?: boolean) =>
    invoke<void>("select_viewer_menu_item", { id, checked: checked ?? null }),
  openEditor: () => invoke<void>("open_editor"),
  editorSession: () => invoke<EditorSession | null>("editor_session"),
  editorPng: () => invoke<BinaryPayload>("editor_png").then(toBytes),
  shotPng: () => invoke<BinaryPayload>("shot_png").then(toBytes),
  saveShot: () => invoke<string>("save_shot"),
  copyShotImage: () => invoke<void>("copy_shot_image"),
  copyShotPath: () => invoke<void>("copy_shot_path"),
  openShotWith: (tool: number) => invoke<ToolOutcome>("open_shot_with", { tool }),
  revealShot: () => invoke<void>("reveal_shot"),
  saveShotAs: () => invoke<string | null>("save_shot_as"),
  deleteSavedShot: () => invoke<void>("delete_saved_shot"),
  openSettings: () => invoke<void>("open_settings"),
  openAbout: () => invoke<void>("open_about"),
  appVersion: () => invoke<string>("app_version"),
  showWindow: (session?: number) => invoke<void>("show_window", { session: session ?? null }),

  takeCaptureSounds: () => invoke<number>("take_capture_sounds"),
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
