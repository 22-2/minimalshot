import ja from "./locales/ja.json";

type Messages = typeof ja;

/** `"viewer.save"` のようなドット区切りのキーを、言語ファイルの構造から型として列挙する。 */
type KeyOf<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : KeyOf<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = KeyOf<Messages>;

export function t(key: MessageKey): string {
  const value = key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], ja);
  return value as string;
}
