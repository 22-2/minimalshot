import { defineConfig, devices } from "@playwright/test";

// Tauri ランタイムの代わりに IPC をモックし、Vite の開発サーバー上で画面を検証する
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
    // 同梱ブラウザと版が合わない環境では、既存の Chromium を指定できるようにする
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
  },
});
