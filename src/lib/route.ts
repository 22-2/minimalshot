export type ViewName = "capture-preview" | "viewer" | "editor" | "context-menu" | "region" | "settings" | "about";

/** すべてのウィンドウは同じ index.html を読み、ウィンドウラベルで表示する画面を決める。 */
export function resolveView(label: string): ViewName {
  if (label.startsWith("capture-preview-")) return "capture-preview";
  if (label === "context-menu") return "context-menu";
  if (label.startsWith("viewer-")) return "viewer";
  if (label.startsWith("editor-")) return "editor";
  if (label === "region") return "region";
  if (label === "about") return "about";
  return "settings";
}
