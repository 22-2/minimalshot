import { AppWindow, Copy, ExternalLink, FilePen, FolderOpen, Link, Save, Settings, Trash2, type LucideIcon } from "lucide-react";

import type { ExternalTool } from "./api";
import { t } from "../i18n";

export type MenuEntry =
  | {
      type: "item";
      id: string;
      label: string;
      icon: LucideIcon;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
    }
  | { type: "separator"; id: string }
  | { type: "sub"; id: string; label: string; icon: LucideIcon; entries: MenuEntry[] };

export type ViewerActions = {
  copyPath: () => void;
  copyImage: () => void;
  save: () => void;
  saveAs: () => void;
  deleteSaved: () => void;
  openWith: (tool: number) => void;
  reveal: () => void;
  openSettings: () => void;
};

type MenuState = { saved: boolean; tools: ExternalTool[] };

/**
 * 右クリックメニューと下部バーのドロップダウンで同じ項目を使うため、項目の定義はここに集める。
 * 下部バーは各グループを、右クリックメニューは全体を表示する。
 */
export function viewerMenu({ saved, tools }: MenuState, actions: ViewerActions) {
  const copy: MenuEntry[] = [
    { type: "item", id: "copy-path", label: t("viewer.copyPath"), icon: Link, onSelect: actions.copyPath, disabled: !saved },
    { type: "item", id: "copy-image", label: t("viewer.copyImage"), icon: Copy, onSelect: actions.copyImage },
  ];

  const save: MenuEntry[] = [
    { type: "item", id: "save", label: t("viewer.save"), icon: Save, onSelect: actions.save, disabled: saved },
    { type: "item", id: "save-as", label: t("viewer.saveAs"), icon: FilePen, onSelect: actions.saveAs },
  ];

  const deleteSaved: MenuEntry[] = saved
    ? [{ type: "item", id: "delete", label: t("viewer.deleteSaved"), icon: Trash2, onSelect: actions.deleteSaved, danger: true }]
    : [];

  const openWith: MenuEntry[] =
    tools.length > 0
      ? tools.map((tool, index) => ({
          type: "item" as const,
          id: `tool-${index}`,
          label: tool.name,
          icon: AppWindow,
          onSelect: () => actions.openWith(index),
        }))
      : [{ type: "item", id: "no-tools", label: t("viewer.noTools"), icon: Settings, onSelect: actions.openSettings }];

  const context: MenuEntry[] = [
    ...copy,
    ...save,
    ...deleteSaved,
    { type: "separator", id: "sep-open" },
    { type: "sub", id: "open-with", label: t("viewer.openWith"), icon: ExternalLink, entries: openWith },
    ...(saved
      ? [{ type: "item" as const, id: "reveal", label: t("viewer.reveal"), icon: FolderOpen, onSelect: actions.reveal }]
      : []),
    { type: "separator", id: "sep-settings" },
    { type: "item", id: "settings", label: t("viewer.settings"), icon: Settings, onSelect: actions.openSettings },
  ];

  return { copy, save, openWith, context };
}
