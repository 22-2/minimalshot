import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { api, pngUrl } from "../lib/api";
import { t } from "../i18n";
import "./CapturePreview.css";

export function CapturePreview() {
  const [url, setUrl] = useState<string | null>(null);
  const [fading, setFading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let disposed = false;
    let imageUrl: string | null = null;
    void api.capturePreviewPng().then((bytes) => {
      if (disposed) return;
      imageUrl = pngUrl(bytes);
      setUrl(imageUrl);
    }).catch(() => { if (!disposed) void getCurrentWindow().close(); });
    return () => { disposed = true; if (imageUrl) URL.revokeObjectURL(imageUrl); };
  }, []);

  useEffect(() => {
    if (!shown || opening) return;
    const fade = window.setTimeout(() => setFading(true), 3000);
    const close = window.setTimeout(() => void getCurrentWindow().close(), 3700);
    return () => { window.clearTimeout(fade); window.clearTimeout(close); };
  }, [shown, opening]);

  const open = () => {
    if (opening) return;
    setOpening(true);
    void api.openCapturePreview().catch(() => void getCurrentWindow().close());
  };

  return url ? (
    <button type="button" className="capture-preview" data-fading={fading || undefined}
      aria-label={t("viewer.openPreview")} onClick={open}>
      <img src={url} alt="" onLoad={() => void api.showCapturePreview().then(() => setShown(true)).catch(() => void getCurrentWindow().close())}
        onError={() => void getCurrentWindow().close()} />
    </button>
  ) : null;
}
