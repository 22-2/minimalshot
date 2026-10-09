import { useEffect, useId, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Switch from "@radix-ui/react-switch";

import { TitleBar } from "../components/TitleBar";
import { Plus, Trash2 } from "lucide-react";

import type { AutoCopy, ExternalTool } from "../lib/api";
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

export function Settings() {
  const { draft, status, saving, load, update, save } = useSettings();
  const autoCopyLabel = useId();
  const [presentation, setPresentation] = useState(0);
  useWindowReady(presentation > 0, presentation);

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
        {draft && (
          <>
            <section className="settings-section">
              <h2 className="settings-heading">{t("settings.hotkeys")}</h2>
              <p className="section-note">{t("settings.hotkeyNote")}</p>
              <TextField
                label={t("settings.hotkeyRegion")}
                value={draft.hotkeys.region}
                onChange={(v) => update("hotkeys", "region", v)}
              />
              <TextField
                label={t("settings.hotkeyWindow")}
                value={draft.hotkeys.window}
                onChange={(v) => update("hotkeys", "window", v)}
              />
              <TextField
                label={t("settings.hotkeyFullscreen")}
                value={draft.hotkeys.fullscreen}
                onChange={(v) => update("hotkeys", "fullscreen", v)}
              />
            </section>

            <section className="settings-section">
              <h2 className="settings-heading">{t("settings.afterCapture")}</h2>
              <SwitchField
                label={t("settings.autoSave")}
                checked={draft.capture.auto_save}
                onChange={(v) => update("capture", "auto_save", v)}
              />
              <div className="field" role="group" aria-labelledby={autoCopyLabel}>
                <span id={autoCopyLabel}>{t("settings.autoCopy")}</span>
                <RadioGroup.Root
                  className="radio-group"
                  aria-labelledby={autoCopyLabel}
                  value={draft.capture.auto_copy}
                  onValueChange={(v) => update("capture", "auto_copy", v as AutoCopy)}
                >
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
              <ToolList tools={draft.external.tools} onChange={(tools) => update("external", "tools", tools)} />
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
