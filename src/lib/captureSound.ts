import { init, success } from "@rexa-developer/tiks";

let initialized = false;

/** グローバルホットキーによる撮影も、全モード共通の完了音で知らせる。 */
export function playCaptureSound() {
  if (!initialized) {
    init();
    // tiks 0.3 は WebView 内の入力でだけ AudioContext を作る。Tauri は自動再生を
    // 許可しているので、操作対象のないイベントで初期化し、実際のクリックを待たない。
    document.dispatchEvent(new Event("pointerdown"));
    initialized = true;
  }
  success();
}
