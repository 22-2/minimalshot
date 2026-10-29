import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { resolveView } from "./lib/route";
import "./styles/app.css";

// 起動する画面のモジュールだけを読み込み、領域選択でも設定 UI 一式を待たない。
const views = {
  "capture-preview": lazy(() => import("./views/CapturePreview").then((module) => ({ default: module.CapturePreview }))),
  viewer: lazy(() => import("./views/Viewer").then((module) => ({ default: module.Viewer }))),
  editor: lazy(() => import("./views/ExcalidrawEditor").then((module) => ({ default: module.ExcalidrawEditor }))),
  "context-menu": lazy(() => import("./views/ViewerMenu").then((module) => ({ default: module.ViewerMenu }))),
  region: lazy(() => import("./views/RegionSelect").then((module) => ({ default: module.RegionSelect }))),
  settings: lazy(() => import("./views/Settings").then((module) => ({ default: module.Settings }))),
  about: lazy(() => import("./views/About").then((module) => ({ default: module.About }))),
};
const view = resolveView(getCurrentWindow().label);
document.documentElement.dataset.view = view;
const View = views[view];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <View />
    </Suspense>
  </StrictMode>,
);
