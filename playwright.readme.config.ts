import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "scripts/readme",
  outputDir: "test-results/readme",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    ...base.use,
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    reducedMotion: "reduce",
  },
  projects: [{ name: "chromium" }],
});
