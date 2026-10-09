import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// workflow_run は既定ブランチ側の定義で動くため、既存の VERSION から開発版を判定する。
const devBuildAt = process.env.VITE_DEV_BUILD_AT
  ?? (process.env.VERSION === "v0.0.0-dev" ? new Date().toISOString() : "");

// Tauri の devUrl と揃えるためポートを固定する
export default defineConfig({
  plugins: [react()],
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
