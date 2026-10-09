import { useEffect, useRef, useState, type PointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";

import { api, errorMessage, pngUrl } from "../lib/api";
import { useWindowReady } from "../lib/useWindowReady";
import { isMeaningfulSelection, rectFromPoints, toImagePixels, type Point } from "../lib/region";
import { t } from "../i18n";

/** 撮影済みのモニター画像を全面に敷き、その上で範囲を選ばせる。 */
export function RegionSelect() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [session, setSession] = useState<number | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useWindowReady(session !== null && (imageReady || error !== null), session ?? 0, session ?? undefined);

  useEffect(() => {
    let disposed = false;
    let active: number | null = null;
    let revision = 0;
    let url: string | null = null;
    const reset = () => {
      revision += 1;
      active = null;
      if (url) URL.revokeObjectURL(url);
      url = null;
      setImageUrl(null);
      setSession(null);
      setImageReady(false);
      setError(null);
      setStart(null);
      setEnd(null);
    };
    const load = async (id: number) => {
      if (disposed || active === id) return;
      reset();
      active = id;
      setSession(id);
      try {
        const png = await api.regionPng(id);
        if (disposed || active !== id) return;
        url = pngUrl(png);
        setImageUrl(url);
      } catch (error) {
        if (!disposed && active === id) setError(errorMessage(error));
      }
    };
    const listeners = [
      listen<number>("region-load", ({ payload }) => void load(payload)),
      listen("region-reset", () => { if (!disposed) reset(); }),
    ];
    const prepare = async () => {
      const { width, height, renderWhileHidden } = await api.prepareRegion();
      if (disposed || revision !== 0) return;
      // 実画面を保存せず、実寸のダミー画像で PNG のデコードと初回合成を済ませる。
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("viewer.loadFailed"));
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-canvas").trim();
      context.fillRect(0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(t("viewer.loadFailed"))), "image/png");
      });
      const preparedUrl = URL.createObjectURL(blob);
      try {
        const image = new Image();
        image.src = preparedUrl;
        await image.decode();
        if (disposed || revision !== 0) return;
        url = preparedUrl;
        setImageUrl(url);
        // Windows では cloak 中も描画できる。非表示 WebView の rAF は待たない。
        if (renderWhileHidden) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        }
      } finally {
        if (url !== preparedUrl) URL.revokeObjectURL(preparedUrl);
      }
    };
    // listener 登録より早く来た初回イベントも拾う。
    void Promise.all(listeners).then(async () => {
      // 事前描画の失敗が実際のキャプチャまで妨げないよう、問い合わせは継続する。
      await prepare().catch(console.error);
      if (disposed) return;
      const id = await api.regionSession();
      if (id !== null) await load(id);
    }).catch((error) => { if (!disposed) setError(errorMessage(error)); });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void api.cancelRegion();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      disposed = true;
      active = null;
      if (url) URL.revokeObjectURL(url);
      for (const listener of listeners) void listener.then((stop) => stop());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const point = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !imageReady || session === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setStart(point(event));
    setEnd(point(event));
  };

  const onPointerUp = () => {
    const image = imageRef.current;
    if (!start || !end || !image || session === null) return;
    const rect = rectFromPoints(start, end);
    setStart(null);
    setEnd(null);
    if (!isMeaningfulSelection(rect)) return;
    const scaleX = image.naturalWidth / image.clientWidth;
    const scaleY = image.naturalHeight / image.clientHeight;
    void api.finishRegion(toImagePixels(rect, scaleX, scaleY), session);
  };

  const selection = start && end ? rectFromPoints(start, end) : null;
  const scale = window.devicePixelRatio;

  return (
    <div
      className="region"
      onPointerDown={onPointerDown}
      onPointerMove={(event) => start && setEnd(point(event))}
      onPointerUp={onPointerUp}
      onContextMenu={(event) => {
        event.preventDefault();
        void api.cancelRegion();
      }}
    >
      {imageUrl && (
        <img
          key={imageUrl}
          ref={imageRef}
          className="region-image"
          src={imageUrl}
          alt=""
          draggable={false}
          onLoad={() => setImageReady(true)}
          onError={() => setError(t("viewer.loadFailed"))}
        />
      )}
      {!selection && <div className="region-dim" />}
      {!selection && <p className="region-hint">{error ?? t("region.hint")}</p>}
      {selection && (
        <div
          className="region-selection"
          data-testid="region-selection"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
            // 選択範囲の外側だけを暗くする
            boxShadow: `0 0 0 100vmax var(--color-scrim)`,
          }}
        >
          <span className="region-size">
            {Math.round(selection.width * scale)} × {Math.round(selection.height * scale)}
          </span>
        </div>
      )}
    </div>
  );
}
