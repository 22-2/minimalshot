import { invoke } from "@tauri-apps/api/core";

export type AutoCopy = "none" | "image" | "path";
export type CaptureKind = "region" | "window" | "fullscreen";

/** Rust 側の `config::Config` と同じ形。 */
export type Config = {
  hotkeys: { region: string; window: string; fullscreen: string };
  capture: { auto_save: boolean; auto_copy: AutoCopy };
  storage: { directory: string; format: string };
  viewer: { always_on_top: boolean; confirm_on_close: boolean };
  external: { editor: string };
};

export type ShotInfo = {
  id: number;
  width: number;
  height: number;
  savedPath: string | null;
};

export type Rect = { x: number; y: number; width: number; height: number };

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  saveConfig: (config: Config) => invoke<void>("save_config", { config }),
  capture: (kind: CaptureKind) => invoke<void>("capture", { kind }),

  shotInfo: () => invoke<ShotInfo>("shot_info"),
  shotPng: () => invoke<ArrayBuffer>("shot_png"),
  saveShot: () => invoke<string>("save_shot"),
  copyShotImage: () => invoke<void>("copy_shot_image"),
  copyShotPath: () => invoke<void>("copy_shot_path"),
  openShotInEditor: () => invoke<void>("open_shot_in_editor"),

  regionPng: () => invoke<ArrayBuffer>("region_png"),
  finishRegion: (rect: Rect) => invoke<void>("finish_region", { rect }),
  cancelRegion: () => invoke<void>("cancel_region"),
};

export function pngUrl(bytes: ArrayBuffer): string {
  return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
