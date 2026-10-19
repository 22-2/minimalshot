import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import { listen } from "@tauri-apps/api/event";

import { TitleBar } from "../components/TitleBar";
import { api, errorMessage, type EditorSession } from "../lib/api";
import { useWindowReady } from "../lib/useWindowReady";
import { t } from "../i18n";

type AppState = ReturnType<ExcalidrawImperativeAPI["getAppState"]>;

// Excalidraw 本体の MIN_ZOOM(0.1)/MAX_ZOOM(30) と揃える
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
const INITIAL_ZOOM = 0.65;
// ダークテーマの Excalidraw は canvas 全体に CSS の invert をかけ、ラスター画像だけは
// 描画時に逆向きのフィルタを先にかけて打ち消す。そのため背景は白のままにしておき、
// ダークテーマの暗い背景はこの反転で作る。
const CANVAS_COLOR = "#ffffff";

// フォントは CSP で外部 CDN を許可していないため、同梱したものだけを使う。
// 開発時は Vite が node_modules をそのまま配信する。
window.EXCALIDRAW_ASSET_PATH = import.meta.env.DEV
  ? "/node_modules/@excalidraw/excalidraw/dist/prod/"
  : "/excalidraw-assets/";

function pngDataUrl(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error(t("editor.loadFailed")));
    reader.readAsDataURL(new Blob([bytes], { type: "image/png" }));
  });
}

/** 画像をデコードできると確認してから表示し、白いキャンバスが一瞬見えるのを避ける。 */
function preloadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(t("editor.loadFailed")));
    image.src = src;
  });
}

function initialScene(session: EditorSession, dataURL: string): ExcalidrawInitialDataState {
  const fileId = `shot-${Date.now()}-${Math.random().toString(36).slice(2)}` as BinaryFileData["id"];
  const file: BinaryFileData = {
    id: fileId,
    mimeType: "image/png",
    dataURL: dataURL as DataURL,
    created: Date.now(),
  };
  const elements = convertToExcalidrawElements(
    [
      {
        type: "image",
        x: 0,
        y: 0,
        width: session.width,
        height: session.height,
        fileId,
      },
    ],
    { regenerateIds: false },
  );
  return {
    elements,
    files: { [fileId]: file },
    appState: { theme: "dark", viewBackgroundColor: CANVAS_COLOR, gridModeEnabled: true },
  };
}

export function ExcalidrawEditor() {
  const [scene, setScene] = useState<ExcalidrawInitialDataState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  useWindowReady((scene !== null && mounted) || error !== null);

  useEffect(() => {
    let disposed = false;
    let loaded = false;
    let loading = false;
    const build = async (session: EditorSession) => {
      if (loaded || loading) return;
      loading = true;
      try {
        const bytes = await api.editorPng();
        const dataURL = await pngDataUrl(bytes);
        await preloadImage(dataURL);
        const next = initialScene(session, dataURL);
        if (disposed) return;
        loaded = true;
        setScene(next);
      } catch (loadError) {
        if (!disposed) setError(errorMessage(loadError));
      } finally {
        loading = false;
      }
    };
    const load = async () => {
      const session = await api.editorSession();
      if (session) await build(session);
    };
    const listeners = [listen<number>("editor-load", () => void load().catch((loadError) => {
      if (!disposed) setError(errorMessage(loadError));
    }))];
    // listener の登録前に割り当てられた画像も、初期問い合わせで拾う。
    void Promise.all(listeners).then(load).catch((loadError) => {
      if (!disposed) setError(errorMessage(loadError));
    });
    return () => {
      disposed = true;
      for (const listener of listeners) void listener.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const container = stageRef.current;
    if (!container) return;
    // Excalidraw 標準の素ホイールはスクロールなので、capture で先に受けてカーソル中心ズームにする。
    // Ctrl/Meta+ホイール（トラックパッドのピンチを含む）は Excalidraw 標準ズームに任せる。
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const api = apiRef.current;
      if (!api) return;
      event.preventDefault();
      event.stopPropagation();
      const { scrollX, scrollY, zoom } = api.getAppState();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.value * Math.pow(1.0015, -delta)));
      if (nextZoom === zoom.value) return;
      const rect = container.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const ratio = nextZoom / zoom.value;
      api.updateScene({
        appState: {
          scrollX: pointerX - (pointerX - scrollX) * ratio,
          scrollY: pointerY - (pointerY - scrollY) * ratio,
          zoom: { value: nextZoom } as AppState["zoom"],
        },
      });
    };
    container.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => container.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  const needFitRef = useRef(false);

  const handleAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    needFitRef.current = true;
  }, []);

  const handleChange = useCallback((elements: readonly OrderedExcalidrawElement[]) => {
    // onChange は初期シーンの復元後にも呼ばれるので、画像が届いてから一度だけフィットする。
    if (!needFitRef.current || !elements.some((element) => element.type === "image")) return;
    needFitRef.current = false;
    // 画像の大きさに依らず初期倍率を揃え、画像を表示領域の中央に置く。
    const api = apiRef.current;
    if (!api) return;
    const image = elements.find((element) => element.type === "image");
    if (!image) return;
    const { width, height } = api.getAppState();
    api.updateScene({
      appState: {
        zoom: { value: INITIAL_ZOOM } as AppState["zoom"],
        scrollX: width / (2 * INITIAL_ZOOM) - (image.x + image.width / 2),
        scrollY: height / (2 * INITIAL_ZOOM) - (image.y + image.height / 2),
      },
    });
    setMounted(true);
  }, []);

  return (
    <div className="frame editor-frame">
      <TitleBar title={t("editor.title")} />
      <div ref={stageRef} className="editor-stage">
        {scene ? (
          <Excalidraw
            initialData={scene}
            excalidrawAPI={handleAPI}
            onChange={handleChange}
            theme="dark"
            langCode="ja-JP"
          />
        ) : (
          <span className="editor-placeholder">{error ?? t("editor.loading")}</span>
        )}
      </div>
    </div>
  );
}

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}
