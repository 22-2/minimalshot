import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import "./SettingEditor.css";

/** 行から開閉し、一覧の中でキャプチャ設定を編集する。 */
export function SettingEditor(props: {
  title: string;
  description?: string;
  modified?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const panelId = useId();
  return (
    <section className="setting-disclosure" data-modified={props.modified || undefined}>
      <div className="setting-row">
        <h3 className="setting-row-heading">
          <button type="button" className="setting-row-trigger" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)}>
            <span className="setting-row-title" id={titleId}>{props.title}</span>
            <ChevronRight className="setting-row-chevron" aria-hidden />
          </button>
        </h3>
      </div>
      {open && (
        <div id={panelId} role="region" aria-labelledby={titleId} className="setting-editor-body">
          {props.description && <p className="setting-description setting-editor-description">{props.description}</p>}
          {props.children}
        </div>
      )}
    </section>
  );
}
