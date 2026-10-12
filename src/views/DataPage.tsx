import type { ReactNode } from "react";
import { Download, RotateCcw, Upload } from "lucide-react";

import { SettingGroup, SettingPage } from "../components/Setting";
import { useSettings } from "../stores/settings";
import { t } from "../i18n";
import "./DataPage.css";

function DataAction(props: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="setting-item data-action">
      <div className="setting-info">
        <h3 className="setting-name">{props.title}</h3>
        <p className="setting-description">{props.description}</p>
      </div>
      <div className="setting-control">{props.children}</div>
    </div>
  );
}

export function DataPage(props: { resetting: boolean; onReset: () => void }) {
  const { transferring, exportConfig, importConfig } = useSettings();
  const busy = props.resetting || transferring !== null;
  return (
    <SettingPage title={t("settings.data")} description={t("settings.dataNote")}>
      <SettingGroup>
        <DataAction title={t("settings.exportTitle")} description={t("settings.exportNote")}>
          <button type="button" className="button" disabled={busy} onClick={() => void exportConfig()}>
            <Download size={14} aria-hidden />{t("settings.export")}
          </button>
        </DataAction>
        <DataAction title={t("settings.importTitle")} description={t("settings.importNote")}>
          <button type="button" className="button" disabled={busy} onClick={() => void importConfig()}>
            <Upload size={14} aria-hidden />{t("settings.import")}
          </button>
        </DataAction>
      </SettingGroup>
      <section className="data-reset">
        <h3 className="data-reset-title">{t("settings.resetTitle")}</h3>
        <p className="setting-description">{t("settings.resetAllNote")}</p>
        <button type="button" className="button" data-variant="danger" disabled={busy} onClick={props.onReset}>
          <RotateCcw size={14} aria-hidden />{t("settings.resetAll")}
        </button>
      </section>
    </SettingPage>
  );
}
