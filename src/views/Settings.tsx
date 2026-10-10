import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  FolderOpen,
  HardDrive,
  Image,
  Info,
  Keyboard,
  Plus,
  SquareTerminal,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { TitleBar } from "../components/TitleBar";
import { HotkeyInput } from "../components/HotkeyInput";
import { Dropdown, SettingDisclosure, SettingGroup, SettingItem, SettingNotice, SettingPage, TextInput, Toggle } from "../components/Setting";
import type { AutoCopy, CaptureActions, CaptureKind, Config, ExternalTool, ViewerLayout } from "../lib/api";
import { duplicatedHotkeys } from "../lib/hotkey";
import { useSettings } from "../stores/settings";
import { useWindowReady } from "../lib/useWindowReady";
import { t } from "../i18n";

type TabId = "hotkeys" | "actions" | "storage" | "viewer" | "tools";
type Tab = { id: TabId; label: string; icon: LucideIcon };

const captureModes: { kind: CaptureKind; action: string }[] = [
  { kind: "region", action: t("tray.region") },
  { kind: "window", action: t("tray.window") },
  { kind: "fullscreen", action: t("tray.fullscreen") },
];

// 見出しは置かず、余白だけでまとまりを分ける
const tabGroups: Tab[][] = [
  [
    { id: "hotkeys", label: t("settings.hotkeys"), icon: Keyboard },
    { id: "actions", label: t("settings.actions"), icon: Zap },
  ],
  [
    { id: "storage", label: t("settings.storage"), icon: HardDrive },
    { id: "viewer", label: t("settings.viewer"), icon: Image },
    { id: "tools", label: t("settings.external"), icon: SquareTerminal },
  ],
];
const tabs = tabGroups.flat();

const autoCopyOptions: { value: AutoCopy; label: string }[] = [
  { value: "none", label: t("settings.autoCopyNone") },
  { value: "image", label: t("settings.autoCopyImage") },
  { value: "path", label: t("settings.autoCopyPath") },
];

const viewerLayoutOptions: { value: ViewerLayout; label: string }[] = [
  { value: "source", label: t("settings.viewerLayoutSource") },
  { value: "framed", label: t("settings.viewerLayoutFramed") },
];

const tabId = (id: TabId) => `settings-tab-${id}`;
const panelId = (id: TabId) => `settings-panel-${id}`;

function SettingsTabs(props: { selected: TabId; onSelect: (id: TabId) => void; onOpenConfigFolder: () => void; onOpenAbout: () => void }) {
  const list = useRef<HTMLDivElement>(null);

  // WAI-ARIA の縦タブにならい、上下キーで選択を移す
  const move = (event: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === props.selected);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    props.onSelect(next.id);
    list.current?.querySelector<HTMLElement>(`#${tabId(next.id)}`)?.focus();
  };

  return (
    <nav className="settings-nav">
      <div ref={list} role="tablist" aria-orientation="vertical" aria-label={t("settings.title")} onKeyDown={move}>
        {tabGroups.map((group, index) => (
          <div className="settings-nav-group" key={index}>
            {group.map((tab) => {
              const selected = tab.id === props.selected;
              return (
                <button
                  key={tab.id}
                  id={tabId(tab.id)}
                  type="button"
                  role="tab"
                  className="settings-nav-item"
                  aria-selected={selected}
                  aria-controls={selected ? panelId(tab.id) : undefined}
                  tabIndex={selected ? 0 : -1}
                  title={tab.label}
                  onClick={() => props.onSelect(tab.id)}
                >
                  <tab.icon aria-hidden />
                  <span className="settings-nav-label">{tab.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {/* めったに使わない操作なので、タブの流れから離して末尾に置く */}
      <div className="settings-nav-group settings-nav-footer">
        <button type="button" className="settings-nav-item" title={t("settings.openConfigFolder")} onClick={props.onOpenConfigFolder}>
          <FolderOpen aria-hidden />
          <span className="settings-nav-label">{t("settings.openConfigFolder")}</span>
        </button>
        <button type="button" className="settings-nav-item" title={t("about.menu")} onClick={props.onOpenAbout}>
          <Info aria-hidden />
          <span className="settings-nav-label">{t("about.menu")}</span>
        </button>
      </div>
    </nav>
  );
}

type Update = ReturnType<typeof useSettings.getState>["update"];

function HotkeysPage({ draft, update }: { draft: Config; update: Update }) {
  const conflicts = duplicatedHotkeys(captureModes.map(({ kind }) => draft.hotkeys[kind]));
  return (
    <SettingPage title={t("settings.hotkeys")} description={t("settings.hotkeyNote")}>
      <SettingGroup>
        {captureModes.map(({ kind, action }) => (
          <div className="setting-item" key={kind}>
            <div className="setting-info">
              <span className="setting-name">{action}</span>
            </div>
            <div className="setting-control">
              <HotkeyInput
                label={action}
                values={draft.hotkeys[kind]}
                conflicts={conflicts}
                onChange={(values) => update("hotkeys", kind, values)}
              />
            </div>
          </div>
        ))}
      </SettingGroup>
    </SettingPage>
  );
}

/** モードごとの上書きが無ければ、共通の既定値で動く。 */
function effectiveActions(draft: Config, kind: CaptureKind): CaptureActions {
  const override = draft.capture[kind];
  return {
    auto_save: override?.auto_save ?? draft.capture.auto_save,
    auto_copy: override?.auto_copy ?? draft.capture.auto_copy,
  };
}

/** 閉じたままでも分かるよう、撮影直後に起きることを短く並べる。 */
function actionsSummary(actions: CaptureActions): string {
  const parts = [
    { none: null, image: t("settings.summaryCopyImage"), path: t("settings.summaryCopyPath") }[actions.auto_copy],
    actions.auto_save ? t("settings.summarySave") : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join("・") : t("settings.summaryNothing");
}

function ModeActions(props: { draft: Config; kind: CaptureKind; title: string; update: Update }) {
  const actions = effectiveActions(props.draft, props.kind);
  // 画面には実際に適用される値を出し、触ったモードだけをモード別の設定として書き出す
  const change = <K extends keyof CaptureActions>(key: K, value: CaptureActions[K]) =>
    props.update("capture", props.kind, { ...actions, [key]: value });

  return (
    <SettingDisclosure title={props.title} summary={actionsSummary(actions)}>
      <SettingItem name={t("settings.autoCopy")}>
        {(ids) => <Dropdown {...ids} value={actions.auto_copy} options={autoCopyOptions} onChange={(v) => change("auto_copy", v)} />}
      </SettingItem>
      <SettingItem name={t("settings.autoSave")}>
        {(ids) => <Toggle {...ids} checked={actions.auto_save} onChange={(v) => change("auto_save", v)} />}
      </SettingItem>
    </SettingDisclosure>
  );
}

function ActionsPage({ draft, update }: { draft: Config; update: Update }) {
  return (
    <SettingPage title={t("settings.actions")} description={t("settings.actionsNote")}>
      <div className="setting-disclosure-list">
        {captureModes.map(({ kind, action }) => (
          <ModeActions key={kind} draft={draft} kind={kind} title={action} update={update} />
        ))}
      </div>
    </SettingPage>
  );
}

function StoragePage({ draft, update }: { draft: Config; update: Update }) {
  return (
    <SettingPage title={t("settings.storage")}>
      <SettingGroup>
        <SettingItem name={t("settings.directory")} description={t("settings.directoryNote")} stacked>
          {(ids) => <TextInput {...ids} value={draft.storage.directory} onChange={(v) => update("storage", "directory", v)} />}
        </SettingItem>
        <SettingItem name={t("settings.format")} description={t("settings.formatNote")} stacked>
          {(ids) => <TextInput {...ids} value={draft.storage.format} onChange={(v) => update("storage", "format", v)} />}
        </SettingItem>
      </SettingGroup>
    </SettingPage>
  );
}

function ViewerPage({ draft, update }: { draft: Config; update: Update }) {
  return (
    <SettingPage title={t("settings.viewer")}>
      <SettingGroup>
        <SettingItem name={t("settings.viewerLayout")} description={t("settings.viewerLayoutNote")}>
          {(ids) => (
            <Dropdown {...ids} value={draft.viewer.layout} options={viewerLayoutOptions} onChange={(v) => update("viewer", "layout", v)} />
          )}
        </SettingItem>
        <SettingItem name={t("settings.alwaysOnTop")}>
          {(ids) => <Toggle {...ids} checked={draft.viewer.always_on_top} onChange={(v) => update("viewer", "always_on_top", v)} />}
        </SettingItem>
        <SettingItem name={t("settings.confirmOnClose")}>
          {(ids) => <Toggle {...ids} checked={draft.viewer.confirm_on_close} onChange={(v) => update("viewer", "confirm_on_close", v)} />}
        </SettingItem>
      </SettingGroup>
    </SettingPage>
  );
}

function ToolsPage({ tools, onChange }: { tools: ExternalTool[]; onChange: (tools: ExternalTool[]) => void }) {
  const edit = (index: number, patch: Partial<ExternalTool>) =>
    onChange(tools.map((tool, i) => (i === index ? { ...tool, ...patch } : tool)));

  return (
    <SettingPage title={t("settings.external")} description={t("settings.externalNote")}>
      {tools.length === 0
        ? (
          <SettingGroup>
            <SettingNotice>{t("settings.noTools")}</SettingNotice>
          </SettingGroup>
        )
        : (
          <div className="setting-disclosure-list">
            {tools.map((tool, index) => (
              <SettingDisclosure
                key={index}
                title={tool.name || `${t("settings.untitledTool")} ${index + 1}`}
                summary={tool.command && <code>{tool.command}</code>}
                // 追加したばかりの空のツールは、すぐ入力できるよう開いておく
                defaultOpen={!tool.name && !tool.command}
              >
                <SettingItem name={t("settings.toolName")}>
                  {(ids) => <TextInput {...ids} value={tool.name} onChange={(name) => edit(index, { name })} />}
                </SettingItem>
                <SettingItem name={t("settings.toolCommand")} stacked>
                  {(ids) => <TextInput {...ids} value={tool.command} onChange={(command) => edit(index, { command })} />}
                </SettingItem>
                <SettingItem name={t("settings.toolArgs")} stacked>
                  {(ids) => <TextInput {...ids} value={tool.args} onChange={(args) => edit(index, { args })} />}
                </SettingItem>
                <SettingItem name={t("settings.toolHideConsole")}>
                  {(ids) => (
                    <Toggle
                      {...ids}
                      // 出力を受け取るツールはコンソールを出さずに起動する
                      checked={tool.hide_console || tool.copy_stdout}
                      disabled={tool.copy_stdout}
                      onChange={(hide_console) => edit(index, { hide_console })}
                    />
                  )}
                </SettingItem>
                <SettingItem name={t("settings.toolCopyStdout")}>
                  {(ids) => <Toggle {...ids} checked={tool.copy_stdout} onChange={(copy_stdout) => edit(index, { copy_stdout })} />}
                </SettingItem>
                <div className="setting-item setting-item-actions">
                  <button
                    type="button"
                    className="button"
                    data-variant="danger"
                    onClick={() => onChange(tools.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} aria-hidden />
                    {t("settings.removeTool")}
                  </button>
                </div>
              </SettingDisclosure>
            ))}
          </div>
        )}
      <button
        type="button"
        className="button"
        onClick={() =>
          onChange([...tools, { name: "", command: "", args: '"${file}"', hide_console: false, copy_stdout: false }])
        }
      >
        <Plus size={14} aria-hidden />
        {t("settings.addTool")}
      </button>
    </SettingPage>
  );
}

export function Settings() {
  const { draft, status, saving, load, openConfigFolder, openAbout, update, save } = useSettings();
  const [presentation, setPresentation] = useState(0);
  const [tab, setTab] = useState<TabId>("hotkeys");
  const content = useRef<HTMLFormElement>(null);
  useWindowReady(presentation > 0, presentation);

  const selectTab = (id: TabId) => {
    setTab(id);
    if (content.current) content.current.scrollTop = 0;
  };

  useEffect(() => {
    let disposed = false;
    const reload = async () => {
      await load();
      if (!disposed) setPresentation((value) => value + 1);
    };
    const unlisten = listen("settings-open", () => void reload());
    void reload();
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
    };
  }, [load]);

  return (
    <div className="frame">
      <TitleBar title={`${t("app.name")} - ${t("settings.title")}`} />
      <div className="settings-body">
        <SettingsTabs
          selected={tab}
          onSelect={selectTab}
          onOpenConfigFolder={() => void openConfigFolder()}
          onOpenAbout={() => void openAbout()}
        />
        <form
          ref={content}
          className="settings-content"
          id="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {/* 各ページは同じ領域に描くので、パネルの id は選択中のタブに合わせて付け替える */}
          <div id={panelId(tab)} className="settings-panel" role="tabpanel" aria-labelledby={tabId(tab)}>
            {draft && tab === "hotkeys" && <HotkeysPage draft={draft} update={update} />}
            {draft && tab === "actions" && <ActionsPage draft={draft} update={update} />}
            {draft && tab === "storage" && <StoragePage draft={draft} update={update} />}
            {draft && tab === "viewer" && <ViewerPage draft={draft} update={update} />}
            {draft && tab === "tools" && <ToolsPage tools={draft.external.tools} onChange={(tools) => update("external", "tools", tools)} />}
          </div>
        </form>
      </div>
      <footer className="settings-footer">
        <output className="toolbar-status" data-tone={status?.tone}>
          {status?.text ?? ""}
        </output>
        <button
          type="submit"
          form="settings-form"
          className="button"
          data-variant="primary"
          disabled={!draft || saving}
        >
          {t("settings.save")}
        </button>
      </footer>
    </div>
  );
}
