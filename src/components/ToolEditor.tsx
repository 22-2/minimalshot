import { useRef, useState, type ReactNode, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { t } from "../i18n";
import { useSettings } from "../stores/settings";
import "./SettingEditor.css";
import "./ToolEditor.css";

/** 有効・無効は一覧で切り替え、コマンドの詳細はモーダルで編集する。 */
export function ToolEditor(props: {
  title: string;
  description: string;
  modified?: boolean;
  defaultOpen?: boolean;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  fallbackFocus: RefObject<HTMLButtonElement | null>;
  children: (closeBeforeRemoval: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const returnToFallback = useRef(false);
  const status = useSettings((state) => state.status);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <section className="setting-disclosure" data-modified={props.modified || undefined} data-disabled={!props.enabled || undefined}>
        <div className="setting-row">
          <h3 className="setting-row-heading">
            <Dialog.Trigger asChild>
              <button ref={trigger} type="button" className="setting-row-trigger">
                <span className="setting-row-title">{props.title}</span>
              </button>
            </Dialog.Trigger>
          </h3>
          <label className="setting-row-enable">
            <span className="visually-hidden">{props.title}{t("settings.enableSuffix")}</span>
            <input type="checkbox" checked={props.enabled} onChange={(event) => props.onEnabledChange(event.target.checked)} />
          </label>
        </div>
      </section>
      <Dialog.Portal>
        <Dialog.Overlay className="tool-editor-overlay" />
        <Dialog.Content
          ref={content}
          className="tool-editor"
          onOpenAutoFocus={(event) => {
            const input = content.current?.querySelector<HTMLInputElement>("input");
            if (input) { event.preventDefault(); input.focus(); }
          }}
          onCloseAutoFocus={(event) => {
            // 削除後は元の行が消えるため、追加ボタンへ戻す。
            if (returnToFallback.current || !trigger.current?.isConnected) {
              event.preventDefault();
              props.fallbackFocus.current?.focus();
              returnToFallback.current = false;
            }
          }}
        >
          <header className="tool-editor-header">
            <Dialog.Title className="tool-editor-title">{props.title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="button icon-button" data-variant="quiet" title={t("settings.closeEditor")} aria-label={t("settings.closeEditor")}>
                <X aria-hidden />
              </button>
            </Dialog.Close>
          </header>
          <div className="tool-editor-body">
            <Dialog.Description className="setting-description tool-editor-description">{props.description}</Dialog.Description>
            {props.children(() => {
              returnToFallback.current = true;
              setOpen(false);
            })}
          </div>
          <footer className="tool-editor-footer">
            <output className="toolbar-status" data-tone={status?.tone}>{status?.text ?? t("settings.autoSaveNote")}</output>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
