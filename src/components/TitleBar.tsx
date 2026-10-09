import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

import { t } from "../i18n";

type Props = {
  title: string;
  /** 閉じる前に確認したい場合などに差し替える。 */
  onClose?: () => void;
  /** ウィンドウ操作ボタンのすぐ左に置く部品。 */
  actions?: ReactNode;
};

export function TitleBar({ title, onClose, actions }: Props) {
  const appWindow = getCurrentWindow();
  const close = onClose ?? (() => void appWindow.close());

  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar-title" data-tauri-drag-region>
        {title}
      </span>
      {actions}
      <div className="titlebar-buttons">
        <button
          type="button"
          className="titlebar-button"
          aria-label={t("titlebar.minimize")}
          title={t("titlebar.minimize")}
          onClick={() => void appWindow.minimize()}
        >
          <Minus aria-hidden />
        </button>
        <button
          type="button"
          className="titlebar-button"
          aria-label={t("titlebar.maximize")}
          title={t("titlebar.maximize")}
          onClick={() => void appWindow.toggleMaximize()}
        >
          <Square aria-hidden />
        </button>
        <button
          type="button"
          className="titlebar-button"
          data-variant="close"
          aria-label={t("titlebar.close")}
          title={t("titlebar.close")}
          onClick={close}
        >
          <X aria-hidden />
        </button>
      </div>
    </header>
  );
}
