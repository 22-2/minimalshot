import { useEffect, useRef, useState, type PointerEvent } from "react";

import { api, pngUrl } from "../lib/api";
import { isMeaningfulSelection, rectFromPoints, toImagePixels, type Point } from "../lib/region";
import { t } from "../i18n";

/** 撮影済みのモニター画像を全面に敷き、その上で範囲を選ばせる。 */
export function RegionSelect() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    void api.regionPng().then((png) => setImageUrl(pngUrl(png)));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void api.cancelRegion();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const point = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setStart(point(event));
    setEnd(point(event));
  };

  const onPointerUp = () => {
    const image = imageRef.current;
    if (!start || !end || !image) return;
    const rect = rectFromPoints(start, end);
    setStart(null);
    setEnd(null);
    if (!isMeaningfulSelection(rect)) return;
    const scaleX = image.naturalWidth / image.clientWidth;
    const scaleY = image.naturalHeight / image.clientHeight;
    void api.finishRegion(toImagePixels(rect, scaleX, scaleY));
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
      {imageUrl && <img ref={imageRef} className="region-image" src={imageUrl} alt="" draggable={false} />}
      {!selection && <div className="region-dim" />}
      {!selection && <p className="region-hint">{t("region.hint")}</p>}
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
