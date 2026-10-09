import { useEffect, useId, type ReactNode } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Switch from "@radix-ui/react-switch";

import { TitleBar } from "../components/TitleBar";
import type { AutoCopy } from "../lib/api";
import { useSettings } from "../stores/settings";
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

function SwitchField(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Field label={props.label}>
      {(id) => (
        <Switch.Root id={id} className="switch" checked={props.checked} onCheckedChange={props.onChange}>
          <Switch.Thumb className="switch-thumb" />
        </Switch.Root>
      )}
    </Field>
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

  useEffect(() => {
    void load();
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
              <TextField
                label={t("settings.editor")}
                note={t("settings.editorNote")}
                value={draft.external.editor}
                onChange={(v) => update("external", "editor", v)}
              />
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
