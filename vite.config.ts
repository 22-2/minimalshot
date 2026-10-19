import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Excalidraw は JS からフォントを相対 URL で取得する。CSS と違って Vite が
// 出力しないため、ビルド時に dist へ複製して同じオリジンから配信する。
function excalidrawAssets(): Plugin {
  const fonts = resolve("node_modules/@excalidraw/excalidraw/dist/prod/fonts");
  return {
    name: "minimalshot:excalidraw-assets",
    apply: "build",
    closeBundle() {
      cpSync(fonts, resolve("dist/excalidraw-assets/fonts"), { recursive: true });
    },
  };
}

// workflow_run は既定ブランチ側の定義で動くため、既存の VERSION から開発版を判定する。
const devBuildAt = process.env.VITE_DEV_BUILD_AT
  ?? (process.env.VERSION === "v0.0.0-dev" ? new Date().toISOString() : "");

// Tauri の devUrl と揃えるためポートを固定する
export default defineConfig({
  plugins: [react(), excalidrawAssets()],
  define: { "import.meta.env.VITE_DEV_BUILD_AT": JSON.stringify(devBuildAt) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
  },
});
