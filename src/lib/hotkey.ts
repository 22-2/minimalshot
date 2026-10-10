type KeyInput = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

const modifierKeys = new Set(["Control", "Shift", "Alt", "Meta", "OS", "AltGraph"]);

/** KeyboardEvent.code を、global-shortcut が読めるキー名へ変換する。 */
function keyName(code: string) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code;
}

/**
 * キー入力をショートカット文字列（例: Ctrl+Shift+Z）にする。
 * 修飾キーだけの入力と、修飾キーを伴わない入力は登録できないので null を返す。
 */
export function hotkeyFromEvent(event: KeyInput): string | null {
  if (modifierKeys.has(event.key)) return null;
  const modifiers = [
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    // バックエンドが Win を Super に読み替える
    event.metaKey && "Win",
  ].filter((part): part is string => !!part);
  if (modifiers.length === 0) return null;
  return [...modifiers, keyName(event.code)].join("+");
}

const aliases: Record<string, string> = {
  control: "ctrl",
  win: "super",
  windows: "super",
  meta: "super",
};

/** 表記の揺れ（大文字小文字・修飾キーの順序・別名）を無視して、同じショートカットか比べるための値。 */
export function hotkeyIdentity(text: string) {
  return text
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .map((part) => aliases[part] ?? part.replace(/^key(?=[a-z]$)/, "").replace(/^digit(?=\d$)/, ""))
    .sort()
    .join("+");
}

/** 画面に出す表記。区切りの前後に空白を入れて読みやすくする（例: Ctrl + Shift + Z）。 */
export function formatHotkey(text: string) {
  return text.split("+").map((part) => part.trim()).join(" + ");
}

/** 2か所以上に割り当てられているショートカットの識別値。 */
export function duplicatedHotkeys(lists: string[][]) {
  const counts = new Map<string, number>();
  for (const text of lists.flat()) {
    if (!text.trim()) continue;
    const identity = hotkeyIdentity(text);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([identity]) => identity));
}
