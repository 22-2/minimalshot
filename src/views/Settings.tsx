import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Camera,
  Database,
  FolderOpen,
  HardDrive,
  Image,
  Info,
  Plus,
  RotateCcw,
  SquareTerminal,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { TitleBar } from "../components/TitleBar";
import { HotkeyInput } from "../components/HotkeyInput";
import { Dropdown, SettingGroup, SettingItem, SettingNotice, SettingPage, TextInput, Toggle } from "../components/Setting";
import { SettingEditor } from "../components/SettingEditor";
import { ToolEditor } from "../components/ToolEditor";
import type { AutoCopy, CaptureActions, CaptureKind, Config, ExternalTool, ScreenCaptureKind, ViewerLayout } from "../lib/api";
import { duplicatedHotkeys } from "../lib/hotkey";
import { useSettings, type ResetTarget } from "../stores/settings";
import { DataPage } from "./DataPage";
import { useWindowReady } from "../lib/useWindowReady";
import { t } from "../i18n";

type TabId = "capture" | "storage" | "viewer" | "tools" | "data";
type Tab = { id: TabId; label: string; icon: LucideIcon };

const captureModes: { kind: ScreenCaptureKind; action: string }[] = [
  { kind: "region", action: t("tray.region") },
  { kind: "window", action: t("tray.window") },
  { kind: "fullscreen", action: t("tray.fullscreen") },
  { kind: "desktop", action: t("tray.desktop") },
];

// 見出しは置かず、余白だけでまとまりを分ける
const tabGroups: Tab[][] = [
  [{ id: "capture", label: t("settings.capture"), icon: Camera }],
  [
    { id: "storage", label: t("settings.storage"), icon: HardDrive },
    { id: "viewer", label: t("settings.viewer"), icon: Image },
    { id: "tools", label: t("settings.external"), icon: SquareTerminal },
  ],
  [{ id: "data", label: t("settings.data"), icon: Database }],
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
  { value: "remember", label: t("settings.viewerLayoutRemember") },
];

const tabId = (id: TabId) => `settings-tab-${id}`;
const panelId = (id: TabId) => `settings-panel-${id}`;

function SettingsTabs(props: { selected: TabId; onSelect: (id: TabId) => void; onResetTab: () => void; resetDisabled: boolean; onOpenConfigFolder: () => void; onOpenAbout: () => void }) {
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
        <button type="button" className="settings-nav-item" title={t("settings.resetTab")} disabled={props.resetDisabled} onClick={props.onResetTab}>
          <RotateCcw aria-hidden />
          <span className="settings-nav-label">{t("settings.resetTab")}</span>
        </button>
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
type ConfigPageProps = { draft: Config; defaults: Config; update: Update };

/** モードごとの上書きが無ければ、共通の既定値で動く。 */
function effectiveActions(draft: Config, kind: ScreenCaptureKind): CaptureActions {
  const override = draft.capture[kind];
  const autoSave = override?.auto_save ?? draft.capture.auto_save;
  const autoCopy = override?.auto_copy ?? draft.capture.auto_copy;
  return {
    auto_save: autoSave,
    auto_copy: !autoSave && autoCopy === "path" ? "none" : autoCopy,
    open_viewer: override?.open_viewer ?? draft.capture.open_viewer,
  };
}

function shortcutsChanged(draft: Config, defaults: Config, kind: CaptureKind): boolean {
  return JSON.stringify(draft.hotkeys[kind].filter((value) => value.trim())) !== JSON.stringify(defaults.hotkeys[kind]);
}

function CaptureHotkeys(props: ConfigPageProps & { kind: CaptureKind; title: string; conflicts: Set<string> }) {
  return (
    <div className="setting-item hotkey-setting" data-modified={shortcutsChanged(props.draft, props.defaults, props.kind) || undefined}>
      <div className="setting-info">
        <span className="setting-name">{t("settings.hotkeys")}</span>
      </div>
      <div className="setting-control">
        <HotkeyInput
          label={props.title}
          values={props.draft.hotkeys[props.kind]}
          conflicts={props.conflicts}
          onChange={(values) => props.update("hotkeys", props.kind, values)}
        />
      </div>
    </div>
  );
}

function CaptureModeSettings(props: ConfigPageProps & { kind: ScreenCaptureKind; title: string; conflicts: Set<string> }) {
  const actions = effectiveActions(props.draft, props.kind);
  const defaultActions = effectiveActions(props.defaults, props.kind);
  // 画面には実際に適用される値を出し、触ったモードだけをモード別の設定として書き出す
  const change = <K extends keyof CaptureActions>(key: K, value: CaptureActions[K]) =>
    props.update("capture", props.kind, { ...props.draft.capture[props.kind], ...actions, [key]: value });

  return (
    <SettingEditor
      title={props.title}
      modified={shortcutsChanged(props.draft, props.defaults, props.kind) || JSON.stringify(actions) !== JSON.stringify(defaultActions)}
      description={t("settings.hotkeyNote")}
    >
      <CaptureHotkeys {...props} />
      <SettingItem name={t("settings.autoCopy")} modified={actions.auto_copy !== defaultActions.auto_copy}>
        {(ids) => <Dropdown {...ids} value={actions.auto_copy} options={autoCopyOptions.map((option) => ({ ...option, disabled: option.value === "path" && !actions.auto_save }))} onChange={(v) => change("auto_copy", v)} />}
      </SettingItem>
      <SettingItem name={t("settings.autoSave")} modified={actions.auto_save !== defaultActions.auto_save}>
        {(ids) => <Toggle {...ids} checked={actions.auto_save} onChange={(v) => props.update("capture", props.kind, { ...props.draft.capture[props.kind], ...actions, auto_save: v, auto_copy: !v && actions.auto_copy === "path" ? "none" : actions.auto_copy })} />}
      </SettingItem>
      <SettingItem name={t("settings.hideViewer")} description={t("settings.hideViewerNote")} modified={actions.open_viewer !== defaultActions.open_viewer}>
        {(ids) => <Toggle {...ids} checked={!actions.open_viewer} onChange={(v) => change("open_viewer", !v)} />}
      </SettingItem>
    </SettingEditor>
  );
}

function ClipboardSettings(props: ConfigPageProps & { conflicts: Set<string> }) {
  const autoSave = props.draft.capture.clipboard?.auto_save ?? false;
  const defaultAutoSave = props.defaults.capture.clipboard?.auto_save ?? false;
  return (
    <SettingEditor
      title={t("tray.clipboard")}
      description={t("settings.clipboardNote")}
      modified={shortcutsChanged(props.draft, props.defaults, "clipboard") || autoSave !== defaultAutoSave}
    >
      <CaptureHotkeys {...props} kind="clipboard" title={t("tray.clipboard")} />
      <SettingItem name={t("settings.autoSave")} modified={autoSave !== defaultAutoSave}>
        {(ids) => <Toggle {...ids} checked={autoSave} onChange={(auto_save) => props.update("capture", "clipboard", { auto_save })} />}
      </SettingItem>
    </SettingEditor>
  );
}

function CapturePage({ draft, defaults, update }: ConfigPageProps) {
  const conflicts = duplicatedHotkeys([...captureModes.map(({ kind }) => draft.hotkeys[kind]), draft.hotkeys.clipboard]);
  return (
    <SettingPage title={t("settings.capture")} description={t("settings.captureNote")}>
      <div className="setting-row-list">
        {captureModes.map(({ kind, action }) => (
          <CaptureModeSettings key={kind} draft={draft} defaults={defaults} kind={kind} title={action} conflicts={conflicts} update={update} />
        ))}
      </div>
      <div className="setting-row-list">
        <ClipboardSettings draft={draft} defaults={defaults} update={update} conflicts={conflicts} />
      </div>
    </SettingPage>
  );
}

function StoragePage({ draft, defaults, update, onOpenSaveFolder }: ConfigPageProps & { onOpenSaveFolder: () => void }) {
  return (
    <SettingPage title={t("settings.storage")}>
      <SettingGroup>
        <SettingItem name={t("settings.directory")} description={t("settings.directoryNote")} stacked modified={draft.storage.directory !== defaults.storage.directory}>
          {(ids) => <TextInput {...ids} value={draft.storage.directory} onChange={(v) => update("storage", "directory", v)} />}
        </SettingItem>
        <SettingItem name={t("settings.saveFolder")} description={t("settings.saveFolderNote")}>
          {() => <button type="button" className="button" onClick={onOpenSaveFolder}>{t("settings.openSaveFolder")}</button>}
        </SettingItem>
        <SettingItem name={t("settings.format")} description={t("settings.formatNote")} stacked modified={draft.storage.format !== defaults.storage.format}>
          {(ids) => <TextInput {...ids} value={draft.storage.format} onChange={(v) => update("storage", "format", v)} />}
        </SettingItem>
      </SettingGroup>
    </SettingPage>
  );
}

function ZoomSensitivityInput({ id, descriptionId, value, onChange }: { id: string; descriptionId?: string; value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const number = Number(text);
    if (text.trim() && Number.isInteger(number) && number >= 10 && number <= 200) onChange(number);
    else setText(String(value));
  };
  return (
    <div className="zoom-sensitivity-control">
      <input
        id={id}
        aria-describedby={descriptionId}
        className="text-input"
        type="number"
        min={10}
        max={200}
        step={1}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      />
      <span>%</span>
    </div>
  );
}

function ViewerPage({ draft, defaults, update }: ConfigPageProps) {
  return (
    <SettingPage title={t("settings.viewer")}>
      <SettingGroup>
        <SettingItem name={t("settings.viewerLayout")} description={t("settings.viewerLayoutNote")} modified={draft.viewer.layout !== defaults.viewer.layout}>
          {(ids) => (
            <Dropdown {...ids} value={draft.viewer.layout} options={viewerLayoutOptions} onChange={(v) => update("viewer", "layout", v)} />
          )}
        </SettingItem>
        <SettingItem name={t("settings.zoomSensitivity")} description={t("settings.zoomSensitivityNote")} modified={draft.viewer.zoom_sensitivity !== defaults.viewer.zoom_sensitivity}>
          {(ids) => <ZoomSensitivityInput {...ids} value={draft.viewer.zoom_sensitivity} onChange={(value) => update("viewer", "zoom_sensitivity", value)} />}
        </SettingItem>
        <SettingItem name={t("settings.alwaysOnTop")} modified={draft.viewer.always_on_top !== defaults.viewer.always_on_top}>
          {(ids) => <Toggle {...ids} checked={draft.viewer.always_on_top} onChange={(v) => update("viewer", "always_on_top", v)} />}
        </SettingItem>
        <SettingItem name={t("settings.confirmOnClose")} modified={draft.viewer.confirm_on_close !== defaults.viewer.confirm_on_close}>
          {(ids) => <Toggle {...ids} checked={draft.viewer.confirm_on_close} onChange={(v) => update("viewer", "confirm_on_close", v)} />}
        </SettingItem>
      </SettingGroup>
    </SettingPage>
  );
}

function ToolsPage({ tools, defaults, onChange }: { tools: ExternalTool[]; defaults: ExternalTool[]; onChange: (tools: ExternalTool[]) => void }) {
  const addButton = useRef<HTMLButtonElement>(null);
  const edit = (index: number, patch: Partial<ExternalTool>) =>
    onChange(tools.map((tool, i) => (i === index ? { ...tool, ...patch } : tool)));

  return (
    <SettingPage title={t("settings.external")} description={t("settings.externalSummary")}>
      {tools.length === 0
        ? (
          <SettingGroup>
            <SettingNotice>{t("settings.noTools")}</SettingNotice>
          </SettingGroup>
        )
        : (
          <div className="setting-row-list">
            {tools.map((tool, index) => (
              <ToolEditor
                key={index}
                title={tool.name || `${t("settings.untitledTool")} ${index + 1}`}
                enabled={tool.enabled !== false}
                onEnabledChange={(enabled) => edit(index, { enabled })}
                description={t("settings.externalNote")}
                modified={JSON.stringify(tool) !== JSON.stringify(defaults[index])}
                fallbackFocus={addButton}
                // 追加したばかりの空のツールは、すぐ入力できるよう開いておく
                defaultOpen={!tool.name && !tool.command}
              >
                {(closeBeforeRemoval) => <>
                  <SettingItem name={t("settings.toolName")} modified={tool.name !== defaults[index]?.name}>
                    {(ids) => <TextInput {...ids} value={tool.name} onChange={(name) => edit(index, { name })} />}
                  </SettingItem>
                  <SettingItem name={t("settings.toolCommand")} stacked modified={tool.command !== defaults[index]?.command}>
                    {(ids) => <TextInput {...ids} value={tool.command} onChange={(command) => edit(index, { command })} />}
                  </SettingItem>
                  <SettingItem name={t("settings.toolArgs")} stacked modified={tool.args !== defaults[index]?.args}>
                    {(ids) => <TextInput {...ids} value={tool.args} onChange={(args) => edit(index, { args })} />}
                  </SettingItem>
                  <SettingItem name={t("settings.toolHideConsole")} modified={(tool.hide_console || tool.copy_stdout) !== (defaults[index] && (defaults[index].hide_console || defaults[index].copy_stdout))}>
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
                  <SettingItem name={t("settings.toolCopyStdout")} modified={tool.copy_stdout !== defaults[index]?.copy_stdout}>
                    {(ids) => <Toggle {...ids} checked={tool.copy_stdout} onChange={(copy_stdout) => edit(index, { copy_stdout })} />}
                  </SettingItem>
                  <div className="setting-item setting-item-actions">
                    <button
                      type="button"
                      className="button"
                      data-variant="danger"
                      onClick={() => {
                        closeBeforeRemoval();
                        onChange(tools.filter((_, i) => i !== index));
                      }}
                    >
                      <Trash2 size={14} aria-hidden />
                      {t("settings.removeTool")}
                    </button>
                  </div>
                </>}
              </ToolEditor>
            ))}
          </div>
        )}
      <button
        type="button"
        className="button"
        ref={addButton}
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
  const { draft, defaults, status, load, openConfigFolder, openSaveFolder, openAbout, update, flush, reset } = useSettings();
  const [presentation, setPresentation] = useState(0);
  const [tab, setTab] = useState<TabId>("capture");
  const [resetting, setResetting] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useWindowReady(presentation > 0, presentation);

  const selectTab = (id: TabId) => {
    setTab(id);
    if (content.current) content.current.scrollTop = 0;
  };

  const resetSettings = async (target: ResetTarget) => {
    setResetting(true);
    try {
      await reset(target);
      if (content.current) content.current.scrollTop = 0;
    } finally {
      setResetting(false);
    }
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
      <TitleBar
        title={`${t("app.name")} - ${t("settings.title")}`}
        // 窓は隠すだけで残るが、待ち中の変更を書き出してから閉じる
        onClose={() => void flush().then(() => getCurrentWindow().close())}
      />
      <div className="settings-body">
        <SettingsTabs
          selected={tab}
          onSelect={selectTab}
          onResetTab={() => { if (tab !== "data") void resetSettings(tab); }}
          resetDisabled={!draft || resetting || tab === "data"}
          onOpenConfigFolder={() => void openConfigFolder()}
          onOpenAbout={() => void openAbout()}
        />
        <div ref={content} className="settings-content">
          {/* 各ページは同じ領域に描くので、パネルの id は選択中のタブに合わせて付け替える */}
          <div id={panelId(tab)} className="settings-panel" role="tabpanel" aria-labelledby={tabId(tab)}>
            {draft && defaults && tab === "capture" && <CapturePage draft={draft} defaults={defaults} update={update} />}
            {draft && defaults && tab === "storage" && <StoragePage draft={draft} defaults={defaults} update={update} onOpenSaveFolder={() => void openSaveFolder()} />}
            {draft && defaults && tab === "viewer" && <ViewerPage draft={draft} defaults={defaults} update={update} />}
            {draft && defaults && tab === "tools" && <ToolsPage tools={draft.external.tools} defaults={defaults.external.tools} onChange={(tools) => update("external", "tools", tools)} />}
            {draft && tab === "data" && <DataPage resetting={resetting} onReset={() => void resetSettings("all")} />}
          </div>
        </div>
      </div>
      <footer className="settings-footer">
        <output className="toolbar-status" data-tone={status?.tone}>
          {status?.text ?? t("settings.autoSaveNote")}
        </output>
      </footer>
    </div>
  );
}
