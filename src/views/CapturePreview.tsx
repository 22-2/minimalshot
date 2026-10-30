import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

import { api, pngUrl, type PreviewState } from "../lib/api";
import { t } from "../i18n";
import "./CapturePreview.css";

function statusText(state: PreviewState): string {
  const labels: string[] = [];
  if (state.saved) labels.push(t("viewer.saved"));
  if (state.copied === "image") labels.push(t("viewer.copiedImage"));
  if (state.copied === "path") labels.push(t("viewer.copiedPath"));
  if (state.failed) labels.push(t("viewer.previewFailed"));
  return labels.join("・") || t(state.done ? "viewer.previewNone" : "viewer.previewWorking");
}

export function CapturePreview() {
  const [url, setUrl] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewState | null>(null);
  const [fading, setFading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let disposed = false;
    let imageUrl: string | null = null;
    let started = false;
    const update = (next: PreviewState) => {
      if (disposed) return;
      setResult((previous) => previous?.id === next.id ? {
        ...next, saved: previous.saved || next.saved, copied: next.copied ?? previous.copied,
        done: previous.done || next.done, failed: previous.failed || next.failed,
      } : next);
      if (started) return;
      started = true;
      void api.capturePreviewPng().then((bytes) => {
        if (disposed) return;
        imageUrl = pngUrl(bytes);
        setUrl(imageUrl);
      }).catch(() => { if (!disposed) void getCurrentWindow().close(); });
    };
    const refresh = () => void api.capturePreviewState().then((state) => { if (state) update(state); });
    const listeners = [
      listen<number>("capture-preview-load", refresh),
      listen<PreviewState>("capture-preview-actions", ({ payload }) => update(payload)),
    ];
    void Promise.all(listeners).then(refresh).catch(() => void getCurrentWindow().close());
    return () => {
      disposed = true;
      for (const listener of listeners) void listener.then((stop) => stop());
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
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

  return url && result ? (
    <button type="button" className="capture-preview" data-fading={fading || undefined}
      aria-label={t("viewer.openPreview")} onClick={open}>
      <span className="capture-preview-image">
        <img src={url} alt="" onLoad={() => void api.showCapturePreview().then(() => setShown(true)).catch(() => void getCurrentWindow().close())}
          onError={() => void getCurrentWindow().close()} />
        <span className="capture-preview-status" aria-live="polite">{statusText(result)}</span>
      </span>
    </button>
  ) : null;
}
