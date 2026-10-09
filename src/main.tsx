import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { resolveView } from "./lib/route";
import { RegionSelect } from "./views/RegionSelect";
import { Settings } from "./views/Settings";
import { Viewer } from "./views/Viewer";
import "./styles/app.css";

const views = { viewer: Viewer, region: RegionSelect, settings: Settings };
const View = views[resolveView(getCurrentWindow().label)];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <View />
  </StrictMode>,
);
