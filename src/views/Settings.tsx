import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ClipboardType,
  Copy,
  EyeOff,
  FolderOpen,
  HardDrive,
  Image,
  Info,
  Link,
  Plus,
  RotateCcw,
  Save,
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
import { useSettings, type ResetTarget } from "../stores/settings";
import { useWindowReady } from "../lib/useWindowReady";
import { t } from "../i18n";

type TabId = "actions" | "storage" | "viewer" | "tools" | "reset";
type Tab = { id: TabId; label: string; icon: LucideIcon };

const captureModes: { kind: CaptureKind; action: string }[] = [
  { kind: "region", action: t("tray.region") },
  { kind: "window", action: t("tray.window") },
  { kind: "fullscreen", action: t("tray.fullscreen") },
  { kind: "desktop", action: t("tray.desktop") },
];

// 見出しは置かず、余白だけでまとまりを分ける
const tabGroups: Tab[][] = [
  [{ id: "actions", label: t("settings.actions"), icon: Zap }],
  [
    { id: "storage", label: t("settings.storage"), icon: HardDrive },
    { id: "viewer", label: t("settings.viewer"), icon: Image },
    { id: "tools", label: t("settings.external"), icon: SquareTerminal },
  ],
  [{ id: "reset", label: t("settings.reset"), icon: RotateCcw }],
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
        <button type="button" className="settings-nav-item" data-wrap title={t("settings.resetTab")} disabled={props.resetDisabled} onClick={props.onResetTab}>
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
function effectiveActions(draft: Config, kind: CaptureKind): CaptureActions {
  const override = draft.capture[kind];
  return {
    auto_save: override?.auto_save ?? draft.capture.auto_save,
    auto_copy: override?.auto_copy ?? draft.capture.auto_copy,
  };
}

type Effect = { label: string; icon: LucideIcon };

/** 有効な処理をアイコンで並べる。名前はツールチップと読み上げで伝える。 */
function SummaryEffects({ effects }: { effects: Effect[] }) {
  return (
    <>
      {/* 読み上げで語がつながらないよう空白を挟む。flex の中なので見た目には影響しない */}
      {" "}
      <span className="summary-effects">
        {effects.map((effect) => (
          <Fragment key={effect.label}>
            {" "}
            <span title={effect.label}>
              <effect.icon aria-hidden />
              <span className="visually-hidden">{effect.label}</span>
            </span>
          </Fragment>
        ))}
      </span>
    </>
  );
}

/** 撮影直後の処理を、ビューアのメニューと同じアイコンで表す。 */
function actionEffects(actions: CaptureActions): Effect[] {
  const copy = {
    none: null,
    image: { label: t("settings.summaryCopyImage"), icon: Copy },
    path: { label: t("settings.summaryCopyPath"), icon: Link },
  }[actions.auto_copy];
  const save = actions.auto_save ? { label: t("settings.summarySave"), icon: Save } : null;
  return [copy, save].filter((effect) => effect !== null);
}

function CaptureModeSettings(props: ConfigPageProps & { kind: CaptureKind; title: string; conflicts: Set<string> }) {
  const actions = effectiveActions(props.draft, props.kind);
  const defaultActions = effectiveActions(props.defaults, props.kind);
  const hotkeys = props.draft.hotkeys[props.kind];
  const shortcutsChanged = JSON.stringify(hotkeys.filter((value) => value.trim())) !== JSON.stringify(props.defaults.hotkeys[props.kind]);
  // 画面には実際に適用される値を出し、触ったモードだけをモード別の設定として書き出す
  const change = <K extends keyof CaptureActions>(key: K, value: CaptureActions[K]) =>
    props.update("capture", props.kind, { ...actions, [key]: value });

  return (
    <SettingDisclosure
      title={props.title}
      leading={<SummaryEffects effects={actionEffects(actions)} />}
    >
      <div className="setting-item" data-stacked data-modified={shortcutsChanged || undefined}>
        <div className="setting-info">
          <span className="setting-name">{t("settings.hotkeys")}</span>
        </div>
        <div className="setting-control">
          <HotkeyInput
            label={props.title}
            values={hotkeys}
            conflicts={props.conflicts}
            onChange={(values) => props.update("hotkeys", props.kind, values)}
          />
        </div>
      </div>
      <SettingItem name={t("settings.autoCopy")} modified={actions.auto_copy !== defaultActions.auto_copy}>
        {(ids) => <Dropdown {...ids} value={actions.auto_copy} options={autoCopyOptions} onChange={(v) => change("auto_copy", v)} />}
      </SettingItem>
      <SettingItem name={t("settings.autoSave")} modified={actions.auto_save !== defaultActions.auto_save}>
        {(ids) => <Toggle {...ids} checked={actions.auto_save} onChange={(v) => change("auto_save", v)} />}
      </SettingItem>
    </SettingDisclosure>
  );
}

function ActionsPage({ draft, defaults, update }: ConfigPageProps) {
  const conflicts = duplicatedHotkeys(captureModes.map(({ kind }) => draft.hotkeys[kind]));
  return (
    <SettingPage title={t("settings.actions")} description={`${t("settings.actionsNote")}${t("settings.hotkeyNote")}`}>
      <div className="setting-disclosure-list">
        {captureModes.map(({ kind, action }) => (
          <CaptureModeSettings key={kind} draft={draft} defaults={defaults} kind={kind} title={action} conflicts={conflicts} update={update} />
        ))}
      </div>
    </SettingPage>
  );
}

function StoragePage({ draft, defaults, update }: ConfigPageProps) {
  return (
    <SettingPage title={t("settings.storage")}>
      <SettingGroup>
        <SettingItem name={t("settings.directory")} description={t("settings.directoryNote")} stacked modified={draft.storage.directory !== defaults.storage.directory}>
          {(ids) => <TextInput {...ids} value={draft.storage.directory} onChange={(v) => update("storage", "directory", v)} />}
        </SettingItem>
        <SettingItem name={t("settings.format")} description={t("settings.formatNote")} stacked modified={draft.storage.format !== defaults.storage.format}>
          {(ids) => <TextInput {...ids} value={draft.storage.format} onChange={(v) => update("storage", "format", v)} />}
        </SettingItem>
      </SettingGroup>
    </SettingPage>
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

function toolEffects(tool: ExternalTool): Effect[] {
  // 出力をコピーするツールは、設定に関わらずコンソールを出さずに起動する
  const hidden = tool.hide_console || tool.copy_stdout;
  return [
    hidden ? { label: t("settings.toolHideConsole"), icon: EyeOff } : null,
    tool.copy_stdout ? { label: t("settings.toolCopyStdout"), icon: ClipboardType } : null,
  ].filter((effect) => effect !== null);
}

/** 撮影モードと同じく、チップに起動するコマンド、右端に有効な動作を並べる。 */
function ToolSummary({ tool }: { tool: ExternalTool }) {
  const command = tool.command.trim();
  // フルパスは長く、見分けるのに要るのはファイル名なので末尾だけを出す
  const program = command.split(/[\\/]/).pop();
  return (
    <>
      {program
        ? <code className="summary-chip" title={command}>{program}</code>
        : <span className="summary-chip" data-empty>{t("settings.noCommand")}</span>}
      <SummaryEffects effects={toolEffects(tool)} />
    </>
  );
}

function ToolsPage({ tools, defaults, onChange }: { tools: ExternalTool[]; defaults: ExternalTool[]; onChange: (tools: ExternalTool[]) => void }) {
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
                summary={<ToolSummary tool={tool} />}
                // 追加したばかりの空のツールは、すぐ入力できるよう開いておく
                defaultOpen={!tool.name && !tool.command}
              >
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
  const { draft, defaults, status, load, openConfigFolder, openAbout, update, flush, reset } = useSettings();
  const [presentation, setPresentation] = useState(0);
  const [tab, setTab] = useState<TabId>("actions");
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
          onResetTab={() => { if (tab !== "reset") void resetSettings(tab); }}
          resetDisabled={!draft || resetting || tab === "reset"}
          onOpenConfigFolder={() => void openConfigFolder()}
          onOpenAbout={() => void openAbout()}
        />
        <div ref={content} className="settings-content">
          {/* 各ページは同じ領域に描くので、パネルの id は選択中のタブに合わせて付け替える */}
          <div id={panelId(tab)} className="settings-panel" role="tabpanel" aria-labelledby={tabId(tab)}>
            {draft && defaults && tab === "actions" && <ActionsPage draft={draft} defaults={defaults} update={update} />}
            {draft && defaults && tab === "storage" && <StoragePage draft={draft} defaults={defaults} update={update} />}
            {draft && defaults && tab === "viewer" && <ViewerPage draft={draft} defaults={defaults} update={update} />}
            {draft && defaults && tab === "tools" && <ToolsPage tools={draft.external.tools} defaults={defaults.external.tools} onChange={(tools) => update("external", "tools", tools)} />}
            {draft && tab === "reset" && (
              <SettingPage title={t("settings.reset")} description={t("settings.resetAllNote")}>
                <button type="button" className="button" data-variant="danger" disabled={resetting} onClick={() => void resetSettings("all")}>
                  <RotateCcw size={14} aria-hidden />
                  {t("settings.resetAll")}
                </button>
              </SettingPage>
            )}
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
