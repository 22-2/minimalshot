import { useRef, useState, type ReactNode, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Settings, X } from "lucide-react";

import { t } from "../i18n";
import { useSettings } from "../stores/settings";
import "./SettingEditor.css";

/** 一覧には要約だけを置き、設定は同じウィンドウ内で編集する。 */
export function SettingEditor(props: {
  title: string;
  summary?: ReactNode;
  description?: string;
  modified?: boolean;
  defaultOpen?: boolean;
  fallbackFocus?: RefObject<HTMLButtonElement | null>;
  children: ReactNode | ((closeBeforeRemoval: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const returnToFallback = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const status = useSettings((state) => state.status);
  const name = `${props.title}${t("settings.editSuffix")}`;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <section className="setting-row" data-modified={props.modified || undefined}>
        <h3 className="setting-row-title">{props.title}</h3>
        {props.summary && <div className="setting-row-summary">{props.summary}</div>}
        <Dialog.Trigger asChild>
          <button ref={trigger} type="button" className="button icon-button setting-row-edit" data-variant="quiet" title={name} aria-label={name}>
            <Settings aria-hidden />
          </button>
        </Dialog.Trigger>
      </section>
      <Dialog.Portal>
        <Dialog.Overlay className="setting-editor-overlay" />
        <Dialog.Content
          ref={content}
          className="setting-editor"
          onEscapeKeyDown={(event) => {
            // 最初の Escape はショートカットの記録だけを取り消す。
            if (content.current?.querySelector("[data-recording]")) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            const input = content.current?.querySelector<HTMLInputElement>("input");
            if (input) { event.preventDefault(); input.focus(); }
          }}
          onCloseAutoFocus={(event) => {
            // ツールを削除すると元の歯車も消えるため、追加ボタンへ戻す。
            if ((returnToFallback.current || !trigger.current?.isConnected) && props.fallbackFocus?.current) {
              event.preventDefault();
              props.fallbackFocus.current.focus();
              returnToFallback.current = false;
            }
          }}
        >
          <header className="setting-editor-header">
            <Dialog.Title className="setting-editor-title">{props.title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="button icon-button" data-variant="quiet" title={t("settings.closeEditor")} aria-label={t("settings.closeEditor")}>
                <X aria-hidden />
              </button>
            </Dialog.Close>
          </header>
          <div className="setting-editor-body">
            <Dialog.Description className={props.description ? "setting-description setting-editor-description" : "visually-hidden"}>
              {props.description ?? t("settings.autoSaveNote")}
            </Dialog.Description>
            {typeof props.children === "function" ? props.children(() => {
              returnToFallback.current = true;
              setOpen(false);
            }) : props.children}
          </div>
          <footer className="setting-editor-footer">
            <output className="toolbar-status" data-tone={status?.tone}>{status?.text ?? t("settings.autoSaveNote")}</output>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
