import type { Rect } from "./api";

export type Point = { x: number; y: number };

/** ドラッグの始点と終点から、向きに関係なく正の幅・高さを持つ矩形を作る。 */
export function rectFromPoints(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/**
 * 画面上の CSS ピクセルの矩形を、撮影画像の物理ピクセルへ変換する。
 * オーバーレイは画像をウィンドウ全面に引き伸ばしているので、比率だけで換算できる。
 */
export function toImagePixels(rect: Rect, scaleX: number, scaleY: number): Rect {
  const x = Math.round(rect.x * scaleX);
  const y = Math.round(rect.y * scaleY);
  return {
    x,
    y,
    width: Math.round((rect.x + rect.width) * scaleX) - x,
    height: Math.round((rect.y + rect.height) * scaleY) - y,
  };
}

/** クリックだけの誤操作を選択として扱わない。 */
export function isMeaningfulSelection(rect: Rect): boolean {
  return rect.width >= 2 && rect.height >= 2;
}
