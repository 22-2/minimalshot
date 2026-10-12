import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronRight } from "lucide-react";

import { t } from "../i18n";
import "./SettingEditor.css";

/** 行から開閉し、一覧の中で設定を編集する。チェックは開閉とは独立させる。 */
export function SettingEditor(props: {
  title: string;
  description?: string;
  modified?: boolean;
  defaultOpen?: boolean;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  fallbackFocus?: RefObject<HTMLButtonElement | null>;
  children: ReactNode | ((closeBeforeRemoval: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const titleId = useId();
  const panelId = useId();
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 追加直後のツールだけは、一覧をスクロールして最初の入力へ移す。
    if (props.defaultOpen) content.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [props.defaultOpen]);
  return (
    <section className="setting-disclosure" data-modified={props.modified || undefined} data-disabled={props.enabled === false || undefined}>
      <div className="setting-row">
        <h3 className="setting-row-heading">
          <button type="button" className="setting-row-trigger" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)}>
            <span className="setting-row-title" id={titleId}>{props.title}</span>
            <ChevronRight className="setting-row-chevron" aria-hidden />
          </button>
        </h3>
        {props.onEnabledChange && (
          <label className="setting-row-enable">
            <span className="visually-hidden">{props.title}{t("settings.enableSuffix")}</span>
            <input type="checkbox" checked={props.enabled} onChange={(event) => props.onEnabledChange?.(event.target.checked)} />
          </label>
        )}
      </div>
      {open && (
        <div ref={content} id={panelId} role="region" aria-labelledby={titleId} className="setting-editor-body">
          {props.description && <p className="setting-description setting-editor-description">{props.description}</p>}
          {typeof props.children === "function" ? props.children(() => {
            props.fallbackFocus?.current?.focus();
            setOpen(false);
          }) : props.children}
        </div>
      )}
    </section>
  );
}
