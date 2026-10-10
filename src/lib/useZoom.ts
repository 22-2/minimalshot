import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { actualSizeView, approach, clampView, fitView, initialView, isSettled, wheelFactor, zoomAt, type Size, type View } from "./zoom";
import type { ViewerLayout } from "./api";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * ホイールで目標の表示を更新し、描画は requestAnimationFrame で目標へ追従させる。
 * React の再描画を介さず DOM の transform を直接書き換えるので、連続したホイールでも引っかからない。
 */
export function useZoom(stageRef: RefObject<HTMLElement | null>, imageRef: RefObject<HTMLElement | null>, image: Size | null, layout: ViewerLayout) {
  const current = useRef<View | null>(null);
  const target = useRef<View | null>(null);
  const mode = useRef<"initial" | "fit" | "manual">("initial");
  const frame = useRef(0);
  const [scale, setScale] = useState(1);
  const defaultView = layout === "framed" ? initialView : fitView;

  const stageSize = useCallback((): Size => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }, [stageRef]);

  const paint = useCallback(() => {
    const view = current.current;
    const element = imageRef.current;
    if (!view || !element) return;
    element.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    // 拡大時はぼかさずに画素を見せる
    element.dataset.pixelated = String(view.scale >= 2);
  }, [imageRef]);

  const animate = useCallback(() => {
    let last = performance.now();
    cancelAnimationFrame(frame.current);
    const step = (now: number) => {
      const goal = target.current;
      if (!goal || !current.current) return;
      current.current = reducedMotion() ? goal : approach(current.current, goal, now - last);
      last = now;
      if (isSettled(current.current, goal)) current.current = goal;
      paint();
      if (current.current !== goal) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [paint]);

  const setTarget = useCallback(
    (view: View, immediate = false) => {
      target.current = view;
      setScale(view.scale);
      if (immediate || !current.current) {
        current.current = view;
        paint();
        return;
      }
      animate();
    },
    [animate, paint],
  );

  const fit = useCallback(
    (immediate = false) => {
      if (!image || !stageRef.current) return;
      mode.current = "fit";
      setTarget(fitView(image, stageSize()), immediate);
    },
    [image, setTarget, stageRef, stageSize],
  );

  const actualSize = useCallback(() => {
    if (!image || !stageRef.current) return;
    mode.current = "manual";
    setTarget(actualSizeView(image, stageSize()));
  }, [image, setTarget, stageRef, stageSize]);

  // 初期表示と「全体を収める」はリサイズに追従し、手動操作後は倍率を保つ。
  useEffect(() => {
    const stage = stageRef.current;
    if (!image || !stage) return;
    mode.current = "initial";
    setTarget(defaultView(image, stageSize()), true);
    const observer = new ResizeObserver(() => {
      if (mode.current === "initial") return setTarget(defaultView(image, stageSize()), true);
      if (mode.current === "fit") return setTarget(fitView(image, stageSize()), true);
      if (target.current) setTarget(clampView(target.current, image, stageSize()), true);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [defaultView, image, setTarget, stageRef, stageSize]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !image) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const base = target.current ?? defaultView(image, stageSize());
      const rect = stage.getBoundingClientRect();
      const zoomed = zoomAt(base, wheelFactor(event.deltaY), { x: event.clientX - rect.left, y: event.clientY - rect.top });
      mode.current = "manual";
      setTarget(clampView(zoomed, image, stageSize()));
    };
    // React の onWheel は passive なので preventDefault できない。直接登録する
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [defaultView, image, setTarget, stageRef, stageSize]);

  const panBy = (dx: number, dy: number) => {
    if (!target.current || !image) return;
    mode.current = "manual";
    setTarget(clampView({ ...target.current, x: target.current.x + dx, y: target.current.y + dy }, image, stageSize()), true);
  };

  return { scale, fit, actualSize, panBy };
}
