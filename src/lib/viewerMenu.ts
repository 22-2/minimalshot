import { AppWindow, Copy, ExternalLink, FilePen, FolderOpen, Link, Pin, Save, Settings, Trash2, type LucideIcon } from "lucide-react";

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
  | {
      type: "check";
      id: string;
      label: string;
      icon: LucideIcon;
      checked: boolean;
      onCheckedChange: (checked: boolean) => void;
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
  setPinned: (pinned: boolean) => void;
};

type MenuState = { saved: boolean; pinned: boolean; tools: ExternalTool[] };

/** ビューアの右クリックメニュー。ビューアの操作はすべてここから行う。 */
export function viewerMenu({ saved, pinned, tools }: MenuState, actions: ViewerActions): MenuEntry[] {
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

  const openWith = openWithEntries(tools, actions);

  return [
    ...copy,
    ...save,
    ...deleteSaved,
    { type: "separator", id: "sep-open" },
    { type: "sub", id: "open-with", label: t("viewer.openWith"), icon: ExternalLink, entries: openWith },
    ...(saved
      ? [{ type: "item" as const, id: "reveal", label: t("viewer.reveal"), icon: FolderOpen, onSelect: actions.reveal }]
      : []),
    { type: "separator", id: "sep-window" },
    { type: "check", id: "pin", label: t("viewer.pin"), icon: Pin, checked: pinned, onCheckedChange: actions.setPinned },
    { type: "item", id: "settings", label: t("viewer.settings"), icon: Settings, onSelect: actions.openSettings },
  ];
}

/** 「外部ツールで開く」の一覧。右クリックのサブメニューとタイトルバーのボタンで共通。 */
export function openWithEntries(tools: ExternalTool[], actions: Pick<ViewerActions, "openWith" | "openSettings">): MenuEntry[] {
  if (tools.length === 0) {
    return [{ type: "item", id: "no-tools", label: t("viewer.noTools"), icon: Settings, onSelect: actions.openSettings }];
  }
  return tools.map((tool, index) => ({
    type: "item",
    id: `tool-${index}`,
    label: tool.name,
    icon: AppWindow,
    onSelect: () => actions.openWith(index),
  }));
}
