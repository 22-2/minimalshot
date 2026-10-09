/** 画像の表示状態。`x`,`y` はステージ左上から見た画像左上の位置、`scale` は等倍に対する倍率。 */
export type View = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 32;
/** ホイール1ノッチ（deltaY=100）で約1.2倍。指数にしておくと拡大と縮小が対称になる。 */
const WHEEL_SENSITIVITY = 0.0018;

/** 等倍を上限に、ステージへ収まる倍率で中央に置く。 */
export function fitView(image: Size, stage: Size): View {
  const scale = Math.min(1, stage.width / image.width, stage.height / image.height);
  return {
    scale,
    x: (stage.width - image.width * scale) / 2,
    y: (stage.height - image.height * scale) / 2,
  };
}

export function wheelFactor(deltaY: number): number {
  return Math.exp(-deltaY * WHEEL_SENSITIVITY);
}

/** カーソル下の画素が動かないように倍率を変える。 */
export function zoomAt(view: View, factor: number, at: Point): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const ratio = scale / view.scale;
  return {
    scale,
    x: at.x - (at.x - view.x) * ratio,
    y: at.y - (at.y - view.y) * ratio,
  };
}

/**
 * 画像がステージより小さい軸は中央へ寄せ、大きい軸は端に隙間ができないよう押し戻す。
 * 拡大中にパンしすぎて画像を見失わないようにするため。
 */
export function clampView(view: View, image: Size, stage: Size): View {
  const clampAxis = (offset: number, imageLength: number, stageLength: number) => {
    const length = imageLength * view.scale;
    if (length <= stageLength) return (stageLength - length) / 2;
    return Math.min(0, Math.max(stageLength - length, offset));
  };
  return {
    scale: view.scale,
    x: clampAxis(view.x, image.width, stage.width),
    y: clampAxis(view.y, image.height, stage.height),
  };
}

/**
 * 現在の表示を目標へ指数的に近づける。経過時間に対する割合で動かすので、
 * フレームレートに関係なく同じ速さで収束する（時定数 `tau` ミリ秒）。
 */
export function approach(current: View, target: View, elapsedMs: number, tau = 45): View {
  const t = 1 - Math.exp(-elapsedMs / tau);
  // 倍率は対数空間で補間すると、拡大と縮小で同じ手触りになる
  const scale = Math.exp(Math.log(current.scale) + (Math.log(target.scale) - Math.log(current.scale)) * t);
  return {
    scale,
    x: current.x + (target.x - current.x) * t,
    y: current.y + (target.y - current.y) * t,
  };
}

export function isSettled(current: View, target: View): boolean {
  return (
    Math.abs(current.scale / target.scale - 1) < 0.001 &&
    Math.abs(current.x - target.x) < 0.25 &&
    Math.abs(current.y - target.y) < 0.25
  );
}
