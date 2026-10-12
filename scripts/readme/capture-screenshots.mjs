import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const openFolder = args.includes("--open");
const outputRoot = resolve(process.env.README_SHOT_DIR ?? join(tmpdir(), "minimalshot-readme-screenshots"));
await mkdir(outputRoot, { recursive: true });
// 画像ビューアが前回の PNG を開いたままでも、上書きせず撮影できるようにする。
const outputDirectory = await mkdtemp(join(outputRoot, "run-"));
const env = { ...process.env, README_SHOT_DIR: outputDirectory };

const result = spawnSync(process.execPath, [
  fileURLToPath(import.meta.resolve("@playwright/test/cli")),
  "test",
  "--config",
  fileURLToPath(new URL("../../playwright.readme.config.ts", import.meta.url)),
  ...args.filter((arg) => arg !== "--open"),
], {
  cwd: fileURLToPath(new URL("../../", import.meta.url)),
  env,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Screenshots: ${outputDirectory}`);

if (openFolder) {
  const opener = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(opener, [outputDirectory], { detached: true, stdio: "ignore" });
  child.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.unref();
}
