import { useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";

import { hotkeyFromEvent, hotkeyIdentity } from "../lib/hotkey";
import { t } from "../i18n";

function HotkeyRecorder(props: { onRecord: (hotkey: string) => void; onCancel: () => void }) {
  const record = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      props.onCancel();
      return;
    }
    const hotkey = hotkeyFromEvent(event.nativeEvent);
    if (hotkey) props.onRecord(hotkey);
  };

  return (
    <button
      type="button"
      className="hotkey-chip"
      data-recording
      autoFocus
      onKeyDown={(event) => {
        // Windows は PrintScreen の keydown を渡さないことがあるので、keyup で拾う
        if (event.code !== "PrintScreen") record(event);
      }}
      onKeyUp={(event) => {
        if (event.code === "PrintScreen") record(event);
      }}
      onBlur={props.onCancel}
    >
      {t("settings.recordingHotkey")}
    </button>
  );
}

/** 1つの撮影モードに割り当てたショートカットを並べ、キー入力で追加する。 */
export function HotkeyInput(props: {
  label: string;
  values: string[];
  conflicts: Set<string>;
  onChange: (values: string[]) => void;
}) {
  const [recording, setRecording] = useState(false);
  // 旧形式の設定には空の行が残っていることがあり、保存時にバックエンドが無視する
  const assigned = props.values.map((value, index) => ({ value, index })).filter(({ value }) => value.trim());

  return (
    <div className="hotkey-input">
      {assigned.length === 0 && !recording && <span className="hotkey-chip" data-empty>{t("settings.noHotkey")}</span>}
      {assigned.map(({ value, index }) => {
        const conflict = props.conflicts.has(hotkeyIdentity(value));
        return (
          <span
            key={index}
            className="hotkey-chip"
            data-conflict={conflict || undefined}
            title={conflict ? t("settings.hotkeyConflict") : undefined}
          >
            <kbd>{value.split("+").map((part) => part.trim()).join(" + ")}</kbd>
            <button
              type="button"
              className="hotkey-chip-remove"
              aria-label={`${props.label}: ${t("settings.removeHotkey")} ${value}`}
              onClick={() => props.onChange(props.values.filter((_, i) => i !== index))}
            >
              <X aria-hidden />
            </button>
          </span>
        );
      })}
      {recording && (
        <HotkeyRecorder
          onRecord={(hotkey) => {
            setRecording(false);
            props.onChange([...props.values.filter((value) => value.trim()), hotkey]);
          }}
          onCancel={() => setRecording(false)}
        />
      )}
      <button
        type="button"
        className="button icon-button"
        data-variant="quiet"
        aria-label={`${props.label}: ${t("settings.addHotkey")}`}
        title={t("settings.addHotkey")}
        disabled={recording}
        onClick={() => setRecording(true)}
      >
        <Plus size={16} aria-hidden />
      </button>
    </div>
  );
}
