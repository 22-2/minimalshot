import { create } from "zustand";

import { api, errorMessage, pngUrl, type ExternalTool, type ShotInfo } from "../lib/api";
import { t, type MessageKey } from "../i18n";

type Status = { tone: "info" | "error"; text: string } | null;

type ViewerState = {
  info: ShotInfo | null;
  imageUrl: string | null;
  tools: ExternalTool[];
  confirmOnClose: boolean;
  status: Status;
  load: () => Promise<void>;
  copyImage: () => Promise<void>;
  copyPath: () => Promise<void>;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  deleteSaved: () => Promise<void>;
  openWith: (tool: number) => Promise<void>;
  reveal: () => Promise<void>;
  openSettings: () => Promise<void>;
  clearStatus: () => void;
};

export const useViewer = create<ViewerState>((set, get) => {
  /** 操作を実行し、結果をツールバーの状態表示に流す。`done` が null なら成功時は何も出さない。 */
  async function run(action: () => Promise<unknown>, done: MessageKey | null) {
    try {
      await action();
      if (done) set({ status: { tone: "info", text: t(done) } });
    } catch (error) {
      set({ status: { tone: "error", text: errorMessage(error) } });
    }
  }

  const setSavedPath = (savedPath: string | null) => {
    const info = get().info;
    if (info) set({ info: { ...info, savedPath } });
  };

  return {
    info: null,
    imageUrl: null,
    tools: [],
    confirmOnClose: false,
    status: null,

    load: async () => {
      try {
        const [info, png, config] = await Promise.all([api.shotInfo(), api.shotPng(), api.getConfig()]);
        // 読み直したときに前の Blob を解放し、メモリが積み上がらないようにする
        const previous = get().imageUrl;
        if (previous) URL.revokeObjectURL(previous);
        set({
          info,
          imageUrl: pngUrl(png),
          tools: config.external.tools,
          confirmOnClose: config.viewer.confirm_on_close,
        });
      } catch (error) {
        set({ status: { tone: "error", text: errorMessage(error) } });
      }
    },

    clearStatus: () => set({ status: null }),
    copyImage: () => run(api.copyShotImage, "viewer.copiedImage"),
    copyPath: () => run(api.copyShotPath, "viewer.copiedPath"),
    openWith: (tool) => run(() => api.openShotWith(tool), "viewer.opened"),
    reveal: () => run(api.revealShot, null),
    openSettings: () => run(api.openSettings, null),
    save: () => run(async () => setSavedPath(await api.saveShot()), "viewer.saved"),
    saveAs: async () => {
      try {
        const path = await api.saveShotAs();
        // キャンセル時は何も変えない
        if (path === null) return;
        setSavedPath(path);
        set({ status: { tone: "info", text: t("viewer.saved") } });
      } catch (error) {
        set({ status: { tone: "error", text: errorMessage(error) } });
      }
    },
    deleteSaved: () =>
      run(async () => {
        await api.deleteSavedShot();
        setSavedPath(null);
      }, "viewer.deleted"),
  };
});
