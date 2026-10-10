import { create } from "zustand";

import { api, errorMessage, type Config } from "../lib/api";
import { t } from "../i18n";

type Status = { tone: "info" | "error"; text: string } | null;

type SettingsState = {
  draft: Config | null;
  status: Status;
  load: () => Promise<void>;
  openConfigFolder: () => Promise<void>;
  openAbout: () => Promise<void>;
  update: <S extends keyof Config, K extends keyof Config[S]>(
    section: S,
    key: K,
    value: Config[S][K],
  ) => void;
  /** 待ち中の自動保存をすぐに行う。窓を閉じる・読み直す前に呼ぶ。 */
  flush: () => Promise<void>;
};

/** 入力の途中で毎回保存しないよう、変更が止まってから保存するまでの時間。 */
export const AUTO_SAVE_DELAY = 400;

/** 追加したばかりのツールは名前とコマンドが空で、保存すると必ず検証エラーになる。 */
function hasIncompleteTool(config: Config) {
  return config.external.tools.some((tool) => !tool.name.trim() || !tool.command.trim());
}

export const useSettings = create<SettingsState>((set, get) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 保存中に変わった値も取りこぼさないよう、保存は1つずつ順に行う
  let saving: Promise<void> = Promise.resolve();

  const save = () => {
    const draft = get().draft;
    if (!draft) return saving;
    saving = saving.then(async () => {
      if (hasIncompleteTool(draft)) {
        set({ status: { tone: "info", text: t("settings.waitingForTool") } });
        return;
      }
      try {
        await api.saveConfig(draft);
        set({ status: { tone: "info", text: t("settings.saved") } });
      } catch (error) {
        // 検証エラーは Rust 側の文言をそのまま見せ、どの項目が悪いか分かるようにする
        set({ status: { tone: "error", text: errorMessage(error) } });
      }
    });
    return saving;
  };

  const flush = async () => {
    if (timer === undefined) return saving;
    clearTimeout(timer);
    timer = undefined;
    return save();
  };

  return {
    draft: null,
    status: null,

    load: async () => {
      await flush();
      set({ draft: null, status: null });
      try {
        set({ draft: await api.getConfig(), status: null });
      } catch (error) {
        set({ status: { tone: "error", text: `${t("settings.loadFailed")}: ${errorMessage(error)}` } });
      }
    },

    openConfigFolder: async () => {
      try {
        await api.openConfigFolder();
        set({ status: { tone: "info", text: t("settings.openedConfigFolder") } });
      } catch (error) {
        set({ status: { tone: "error", text: `${t("settings.openConfigFolderFailed")}: ${errorMessage(error)}` } });
      }
    },

    openAbout: async () => {
      try {
        await api.openAbout();
      } catch (error) {
        set({ status: { tone: "error", text: errorMessage(error) } });
      }
    },

    update: (section, key, value) => {
      const draft = get().draft;
      if (!draft) return;
      set({ draft: { ...draft, [section]: { ...draft[section], [key]: value } } });
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void save();
      }, AUTO_SAVE_DELAY);
    },

    flush,
  };
});
