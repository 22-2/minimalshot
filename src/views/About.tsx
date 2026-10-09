import { useEffect, useState } from "react";

import { TitleBar } from "../components/TitleBar";
import { api, errorMessage } from "../lib/api";
import { useWindowReady } from "../lib/useWindowReady";
import { t } from "../i18n";

export function About() {
  const [version, setVersion] = useState<string | null>(null);
  const buildAt = import.meta.env.VITE_DEV_BUILD_AT;
  const buildTime = buildAt ? new Date(buildAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false }) : null;
  useWindowReady(version !== null);

  useEffect(() => {
    void api.appVersion().then(setVersion, (error) => setVersion(errorMessage(error)));
  }, []);

  return (
    <div className="frame">
      <TitleBar title={`${t("app.name")} - ${t("about.title")}`} />
      <main className="about-body">
        <h1>{t("app.name")}</h1>
        <p>{t("about.version")} {version ?? "…"}</p>
        {buildTime && <p>{t("about.buildTime")} <time dateTime={buildAt}>{buildTime}</time></p>}
        <p>{t("about.description")}</p>
      </main>
    </div>
  );
}
