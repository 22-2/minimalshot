import { create } from "zustand";

import { api, errorMessage, pngUrl, type ShotInfo } from "../lib/api";
import { t, type MessageKey } from "../i18n";

type Status = { tone: "info" | "error"; text: string } | null;

type ViewerState = {
  info: ShotInfo | null;
  imageUrl: string | null;
  status: Status;
  load: () => Promise<void>;
  copyImage: () => Promise<void>;
  copyPath: () => Promise<void>;
  save: () => Promise<void>;
  openEditor: () => Promise<void>;
};

export const useViewer = create<ViewerState>((set, get) => {
  /** 操作を実行し、結果をツールバーの状態表示に流す。 */
  async function run(action: () => Promise<unknown>, done: MessageKey) {
    try {
      await action();
      set({ status: { tone: "info", text: t(done) } });
    } catch (error) {
      set({ status: { tone: "error", text: errorMessage(error) } });
    }
  }

  return {
    info: null,
    imageUrl: null,
    status: null,

    load: async () => {
      try {
        const [info, png] = await Promise.all([api.shotInfo(), api.shotPng()]);
        // 読み直したときに前の Blob を解放し、メモリが積み上がらないようにする
        const previous = get().imageUrl;
        if (previous) URL.revokeObjectURL(previous);
        set({ info, imageUrl: pngUrl(png) });
      } catch (error) {
        set({ status: { tone: "error", text: errorMessage(error) } });
      }
    },

    copyImage: () => run(api.copyShotImage, "viewer.copiedImage"),
    copyPath: () => run(api.copyShotPath, "viewer.copiedPath"),
    openEditor: () => run(api.openShotInEditor, "viewer.opened"),
    save: () =>
      run(async () => {
        const savedPath = await api.saveShot();
        const info = get().info;
        if (info) set({ info: { ...info, savedPath } });
      }, "viewer.saved"),
  };
});
