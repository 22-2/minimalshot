export type ViewName = "viewer" | "editor" | "region" | "settings" | "about";

/** すべてのウィンドウは同じ index.html を読み、ウィンドウラベルで表示する画面を決める。 */
export function resolveView(label: string): ViewName {
  if (label.startsWith("viewer-")) return "viewer";
  if (label.startsWith("editor-")) return "editor";
  if (label === "region") return "region";
  if (label === "about") return "about";
  return "settings";
}
