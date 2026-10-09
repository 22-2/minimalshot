import { create } from "zustand";

import { api, errorMessage, type Config } from "../lib/api";
import { t } from "../i18n";

type Status = { tone: "info" | "error"; text: string } | null;

type SettingsState = {
  draft: Config | null;
  status: Status;
  saving: boolean;
  load: () => Promise<void>;
  update: <S extends keyof Config, K extends keyof Config[S]>(
    section: S,
    key: K,
    value: Config[S][K],
  ) => void;
  save: () => Promise<void>;
};

export const useSettings = create<SettingsState>((set, get) => ({
  draft: null,
  status: null,
  saving: false,

  load: async () => {
    set({ draft: null, status: null });
    try {
      set({ draft: await api.getConfig(), status: null });
    } catch (error) {
      set({ status: { tone: "error", text: `${t("settings.loadFailed")}: ${errorMessage(error)}` } });
    }
  },

  update: (section, key, value) => {
    const draft = get().draft;
    if (!draft) return;
    set({ draft: { ...draft, [section]: { ...draft[section], [key]: value } }, status: null });
  },

  save: async () => {
    const draft = get().draft;
    if (!draft) return;
    set({ saving: true });
    try {
      await api.saveConfig(draft);
      set({ status: { tone: "info", text: t("settings.saved") } });
    } catch (error) {
      // 検証エラーは Rust 側の文言をそのまま見せ、どの項目が悪いか分かるようにする
      set({ status: { tone: "error", text: errorMessage(error) } });
    } finally {
      set({ saving: false });
    }
  },
}));
