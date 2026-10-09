export type ViewName = "viewer" | "region" | "settings";

/** すべてのウィンドウは同じ index.html を読み、ウィンドウラベルで表示する画面を決める。 */
export function resolveView(label: string): ViewName {
  if (label.startsWith("viewer-")) return "viewer";
  if (label === "region") return "region";
  return "settings";
}
