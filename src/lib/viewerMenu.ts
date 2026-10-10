import { AppWindow, Copy, ExternalLink, FilePen, FolderOpen, Link, Pin, Save, Scan, Settings, Trash2, type LucideIcon } from "lucide-react";

import type { ExternalTool } from "./api";
import { t } from "../i18n";

type MenuItem = {
      type: "item";
      id: string;
      label: string;
      icon: LucideIcon;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
      caption?: string;
      hint?: string;
    };

export type MenuEntry =
  | MenuItem
  | { type: "icon-row"; id: string; entries: MenuItem[] }
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
  actualSize: () => void;
};

type MenuState = { saved: boolean; pinned: boolean; tools: ExternalTool[] };

/** ビューアの右クリックメニュー。ビューアの操作はすべてここから行う。 */
export function viewerMenu({ saved, pinned, tools }: MenuState, actions: ViewerActions): MenuEntry[] {
  const openWith = openWithEntries(tools, actions);

  return [
    {
      type: "icon-row", id: "quick-actions", entries: [
        { type: "item", id: "copy-image", label: t("viewer.copyImage"), caption: t("viewer.copyImageShort"), icon: Copy, onSelect: actions.copyImage },
        { type: "item", id: "copy-path", label: t("viewer.copyPath"), caption: t("viewer.copyPathShort"), icon: Link, onSelect: actions.copyPath, disabled: !saved },
        { type: "item", id: "delete", label: t("viewer.deleteSaved"), caption: t("viewer.deleteShort"), icon: Trash2, onSelect: actions.deleteSaved, disabled: !saved, danger: saved },
      ],
    },
    { type: "separator", id: "sep-quick" },
    { type: "item", id: "save", label: t("viewer.save"), icon: Save, onSelect: actions.save, disabled: saved, hint: "Ctrl+S" },
    { type: "item", id: "save-as", label: t("viewer.saveAs"), icon: FilePen, onSelect: actions.saveAs, hint: "Ctrl+Shift+S" },
    { type: "sub", id: "open-with", label: t("viewer.openWith"), icon: ExternalLink, entries: openWith },
    ...(saved
      ? [{ type: "item" as const, id: "reveal", label: t("viewer.reveal"), icon: FolderOpen, onSelect: actions.reveal }]
      : []),
    { type: "separator", id: "sep-view" },
    { type: "item", id: "actual-size", label: t("viewer.actualSize"), icon: Scan, onSelect: actions.actualSize, hint: "100%" },
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
