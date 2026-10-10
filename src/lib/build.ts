/** `pnpm tauri dev` と開発版の配布 exe。どちらも devtools を開ける。 */
export const isDevelopmentBuild = import.meta.env.DEV || !!import.meta.env.VITE_DEV_BUILD_AT;
