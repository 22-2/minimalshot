import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { resolveView } from "./lib/route";
import "./styles/app.css";

// 起動する画面のモジュールだけを読み込み、領域選択でも設定 UI 一式を待たない。
const views = {
  viewer: lazy(() => import("./views/Viewer").then((module) => ({ default: module.Viewer }))),
  region: lazy(() => import("./views/RegionSelect").then((module) => ({ default: module.RegionSelect }))),
  settings: lazy(() => import("./views/Settings").then((module) => ({ default: module.Settings }))),
};
const View = views[resolveView(getCurrentWindow().label)];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <View />
    </Suspense>
  </StrictMode>,
);
