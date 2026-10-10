import { useEffect, useId, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Switch from "@radix-ui/react-switch";

import { TitleBar } from "../components/TitleBar";
import { FolderOpen, Info, Plus, Trash2 } from "lucide-react";

import type { AutoCopy, CaptureActions, CaptureKind, ExternalTool, ViewerLayout } from "../lib/api";
import { useSettings } from "../stores/settings";
import { useWindowReady } from "../lib/useWindowReady";
import { t } from "../i18n";

function Field({ label, note, children }: { label: string; note?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {note && <p className="field-note">{note}</p>}
    </div>
  );
}

function TextField(props: { label: string; note?: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={props.label} note={props.note}>
      {(id) => (
        <input
          id={id}
          className="text-input"
          spellCheck={false}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function SwitchField(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Field label={props.label}>
      {(id) => (
        <Switch.Root
          id={id}
          className="switch"
          checked={props.checked}
          disabled={props.disabled}
          onCheckedChange={props.onChange}
        >
          <Switch.Thumb className="switch-thumb" />
        </Switch.Root>
      )}
    </Field>
  );
}

function ToolList({ tools, onChange }: { tools: ExternalTool[]; onChange: (tools: ExternalTool[]) => void }) {
  const edit = (index: number, patch: Partial<ExternalTool>) =>
    onChange(tools.map((tool, i) => (i === index ? { ...tool, ...patch } : tool)));

  return (
    <>
      {tools.length === 0 && <p className="section-note">{t("settings.noTools")}</p>}
      <ul className="tool-list">
        {tools.map((tool, index) => (
          <li key={index} className="tool-card">
            <TextField label={t("settings.toolName")} value={tool.name} onChange={(name) => edit(index, { name })} />
            <TextField
              label={t("settings.toolCommand")}
              value={tool.command}
              onChange={(command) => edit(index, { command })}
            />
            <TextField label={t("settings.toolArgs")} value={tool.args} onChange={(args) => edit(index, { args })} />
            <SwitchField
              label={t("settings.toolHideConsole")}
              checked={tool.hide_console || tool.copy_stdout}
              disabled={tool.copy_stdout}
              onChange={(hide_console) => edit(index, { hide_console })}
            />
            <SwitchField
              label={t("settings.toolCopyStdout")}
              checked={tool.copy_stdout}
              onChange={(copy_stdout) => edit(index, { copy_stdout })}
            />
            <button
              type="button"
              className="button tool-remove"
              data-variant="danger"
              onClick={() => onChange(tools.filter((_, i) => i !== index))}
            >
              <Trash2 size={14} aria-hidden />
              {t("settings.removeTool")}
            </button>
          </li>
        ))}
      </ul>
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
    </>
  );
}

const autoCopyOptions: { value: AutoCopy; label: string }[] = [
  { value: "none", label: t("settings.autoCopyNone") },
  { value: "image", label: t("settings.autoCopyImage") },
  { value: "path", label: t("settings.autoCopyPath") },
];

const captureModes: { kind: CaptureKind; label: string }[] = [
  { kind: "region", label: t("settings.hotkeyRegion") },
  { kind: "window", label: t("settings.hotkeyWindow") },
  { kind: "fullscreen", label: t("settings.hotkeyFullscreen") },
];

function HotkeyList(props: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  return (
    <div className="hotkey-list">
      <h3>{props.label}</h3>
      {props.values.map((value, index) => (
        <div className="hotkey-row" key={index}>
          <input
            className="text-input"
            aria-label={index === 0 ? props.label : `${props.label} ${index + 1}`}
            spellCheck={false}
            value={value}
            onChange={(event) => props.onChange(props.values.map((item, i) => i === index ? event.target.value : item))}
          />
          <button type="button" className="button" aria-label={`${props.label}: ${t("settings.removeHotkey")} ${index + 1}`} onClick={() => props.onChange(props.values.filter((_, i) => i !== index))}>
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      ))}
      <button type="button" className="button" onClick={() => props.onChange([...props.values, ""])}>
        <Plus size={14} aria-hidden />
        {props.label}: {t("settings.addHotkey")}
      </button>
    </div>
  );
}

function CaptureActionFields(props: {
  actions: CaptureActions;
  tools: ExternalTool[];
  onChange: <K extends keyof CaptureActions>(key: K, value: CaptureActions[K]) => void;
}) {
  const autoCopyLabel = useId();
  const autoToolsLabel = useId();
  return (
    <div className="capture-fields">
      <SwitchField label={t("settings.autoSave")} checked={props.actions.auto_save} onChange={(v) => props.onChange("auto_save", v)} />
      <div className="field" role="group" aria-labelledby={autoCopyLabel}>
        <span id={autoCopyLabel}>{t("settings.autoCopy")}</span>
        <RadioGroup.Root className="radio-group" aria-labelledby={autoCopyLabel} value={props.actions.auto_copy} onValueChange={(v) => props.onChange("auto_copy", v as AutoCopy)}>
          {autoCopyOptions.map((option) => (
            <label key={option.value} className="radio-option">
              <RadioGroup.Item className="radio" value={option.value}>
                <RadioGroup.Indicator className="radio-indicator" />
              </RadioGroup.Item>
              {option.label}
            </label>
          ))}
        </RadioGroup.Root>
      </div>
      <div className="field" role="group" aria-labelledby={autoToolsLabel}>
        <span id={autoToolsLabel}>{t("settings.autoTools")}</span>
        <div className="auto-tool-list">
          {props.tools.length === 0 && <span className="field-note">{t("settings.noAutoTools")}</span>}
          {props.tools.map((tool, index) => (
            <label className="auto-tool-option" key={index}>
              <input
                type="checkbox"
                disabled={!tool.name.trim()}
                checked={props.actions.auto_tools.includes(tool.name)}
                onChange={(event) => props.onChange("auto_tools", event.target.checked
                  ? [...props.actions.auto_tools, tool.name]
                  : props.actions.auto_tools.filter((name) => name !== tool.name))}
              />
              {tool.name || `${t("settings.toolName")} ${index + 1}`}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Settings() {
  const { draft, status, saving, load, openConfigFolder, openAbout, update, save } = useSettings();
  const [presentation, setPresentation] = useState(0);
  const viewerLayoutLabel = useId();
  useWindowReady(presentation > 0, presentation);

  const changeTools = (tools: ExternalTool[]) => {
    if (!draft) return;
    const oldTools = draft.external.tools;
    const renamed = new Map<string, string>();
    if (tools.length === oldTools.length) {
      oldTools.forEach((tool, index) => {
        if (tool.name !== tools[index].name) renamed.set(tool.name, tools[index].name);
      });
    }
    const keepNames = (names: string[]) => names
      .map((name) => renamed.get(name) ?? name)
      .filter((name) => tools.some((tool) => tool.name === name));
    update("capture", "auto_tools", keepNames(draft.capture.auto_tools));
    for (const { kind } of captureModes) {
      const override = draft.capture[kind];
      if (override?.auto_tools) {
        update("capture", kind, { ...override, auto_tools: keepNames(override.auto_tools) });
      }
    }
    update("external", "tools", tools);
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
      <form
        className="settings-body"
        id="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="settings-section">
          <button type="button" className="button" onClick={() => void openConfigFolder()}>
            <FolderOpen size={14} aria-hidden />
            {t("settings.openConfigFolder")}
          </button>
          <button type="button" className="button" onClick={() => void openAbout()}>
            <Info size={14} aria-hidden />
            {t("about.menu")}
          </button>
        </div>
        {draft && (
          <>
            <section className="settings-section">
              <h2 className="settings-heading">{t("settings.hotkeys")}</h2>
              <p className="section-note">{t("settings.hotkeyNote")}</p>
              {captureModes.map(({ kind, label }) => (
                <HotkeyList key={kind} label={label} values={draft.hotkeys[kind]} onChange={(values) => update("hotkeys", kind, values)} />
              ))}
            </section>

            <section className="settings-section">
              <h2 className="settings-heading">{t("settings.afterCapture")}</h2>
              <p className="section-note">{t("settings.autoToolsNote")}</p>
              <div className="capture-group">
                <h3>{t("settings.defaultActions")}</h3>
                <CaptureActionFields actions={draft.capture} tools={draft.external.tools} onChange={(key, value) => update("capture", key, value)} />
              </div>
              <h3>{t("settings.modeActions")}</h3>
              {captureModes.map(({ kind, label }) => {
                const override = draft.capture[kind];
                const actions: CaptureActions = {
                  auto_save: override?.auto_save ?? draft.capture.auto_save,
                  auto_copy: override?.auto_copy ?? draft.capture.auto_copy,
                  auto_tools: override?.auto_tools ?? draft.capture.auto_tools,
                };
                return (
                  <div className="capture-group" key={kind}>
                    <h4>{label}</h4>
                    <SwitchField
                      label={t("settings.inheritActions")}
                      checked={!override}
                      onChange={(inherit) => update("capture", kind, inherit ? undefined : { ...actions })}
                    />
                    {override && <CaptureActionFields
                      actions={actions}
                      tools={draft.external.tools}
                      onChange={(key, value) => update("capture", kind, { ...override, [key]: value })}
                    />}
                  </div>
                );
              })}
            </section>

            <section className="settings-section">
              <h2 className="settings-heading">{t("settings.storage")}</h2>
              <TextField
                label={t("settings.directory")}
                note={t("settings.directoryNote")}
                value={draft.storage.directory}
                onChange={(v) => update("storage", "directory", v)}
              />
              <TextField
                label={t("settings.format")}
                note={t("settings.formatNote")}
                value={draft.storage.format}
                onChange={(v) => update("storage", "format", v)}
              />
            </section>

            <section className="settings-section">
              <h2 className="settings-heading">{t("settings.viewer")}</h2>
              <div className="field" role="group" aria-labelledby={viewerLayoutLabel}>
                <span id={viewerLayoutLabel}>{t("settings.viewerLayout")}</span>
                <RadioGroup.Root className="radio-group" aria-labelledby={viewerLayoutLabel} value={draft.viewer.layout} onValueChange={(value) => update("viewer", "layout", value as ViewerLayout)}>
                  <label className="radio-option">
                    <RadioGroup.Item className="radio" value="source">
                      <RadioGroup.Indicator className="radio-indicator" />
                    </RadioGroup.Item>
                    {t("settings.viewerLayoutSource")}
                  </label>
                  <label className="radio-option">
                    <RadioGroup.Item className="radio" value="framed">
                      <RadioGroup.Indicator className="radio-indicator" />
                    </RadioGroup.Item>
                    {t("settings.viewerLayoutFramed")}
                  </label>
                </RadioGroup.Root>
                <p className="field-note">{t("settings.viewerLayoutNote")}</p>
              </div>
              <SwitchField
                label={t("settings.alwaysOnTop")}
                checked={draft.viewer.always_on_top}
                onChange={(v) => update("viewer", "always_on_top", v)}
              />
              <SwitchField
                label={t("settings.confirmOnClose")}
                checked={draft.viewer.confirm_on_close}
                onChange={(v) => update("viewer", "confirm_on_close", v)}
              />
            </section>

            <section className="settings-section">
              <h2 className="settings-heading">{t("settings.external")}</h2>
              <p className="section-note">{t("settings.externalNote")}</p>
              <ToolList tools={draft.external.tools} onChange={changeTools} />
            </section>
          </>
        )}
      </form>
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
