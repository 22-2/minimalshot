import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri の devUrl と揃えるためポートを固定する
export default defineConfig({
  plugins: [react()],
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
