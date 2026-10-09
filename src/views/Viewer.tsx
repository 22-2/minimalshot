import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Copy, ExternalLink, Link, Pin, PinOff, Save } from "lucide-react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { IconButton } from "../components/IconButton";
import { TitleBar } from "../components/TitleBar";
import { api } from "../lib/api";
import { useZoom } from "../lib/useZoom";
import { useViewer } from "../stores/viewer";
import { t } from "../i18n";

export function Viewer() {
  const { info, imageUrl, status, load, copyImage, copyPath, save, openEditor } = useViewer();
  const [pinned, setPinned] = useState(false);
  const [confirmOnClose, setConfirmOnClose] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // getCurrentWindow() は呼ぶたびに別オブジェクトを返す。effect の依存に入れると毎回の描画で
  // 読み込みが走り、PNG の再取得が止まらなくなる（WebView のメモリが尽きて真っ黒になる）
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const stageRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const panFrom = useRef<{ x: number; y: number } | null>(null);
  const imageSize = useMemo(() => (info ? { width: info.width, height: info.height } : null), [info?.width, info?.height]);
  const zoom = useZoom(stageRef, imageRef, imageSize);

  useEffect(() => {
    void load();
    void appWindow.isAlwaysOnTop().then(setPinned);
    void api.getConfig().then((config) => setConfirmOnClose(config.viewer.confirm_on_close));
  }, [load, appWindow]);

  const close = () => (confirmOnClose ? setConfirming(true) : void appWindow.close());

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 確認ダイアログ表示中の Esc はダイアログを閉じるだけにする
      if (event.key !== "Escape" || confirming) return;
      // 同じ Esc が、今開くダイアログにまで届いて即座に閉じないよう止める
      event.stopPropagation();
      if (confirmOnClose) setConfirming(true);
      else void appWindow.close();
    };
    // キャプチャ段階で受け、ダイアログ（Radix）より先に判断する。後に回すと、Radix が同じ Esc で
    // ダイアログを閉じた直後に再登録された listener が呼ばれ、ダイアログが開き直ってしまう
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [appWindow, confirmOnClose, confirming]);

  const togglePin = async () => {
    await appWindow.setAlwaysOnTop(!pinned);
    setPinned(!pinned);
  };

  // 画像のどこを掴んでもウィンドウごと動かせる。拡大して画像がはみ出しているときだけ、画像のパンにする
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (!zoom.canPan()) {
      void appWindow.startDragging();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    panFrom.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!panFrom.current) return;
    zoom.panBy(event.clientX - panFrom.current.x, event.clientY - panFrom.current.y);
    panFrom.current = { x: event.clientX, y: event.clientY };
  };

  const saved = info?.savedPath != null;
  const title = info
    ? `${t("app.name")}  ${info.width} × ${info.height}  ${Math.round(zoom.scale * 100)}%`
    : t("app.name");

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="frame">
        <TitleBar title={title} onClose={close} />
        <main
          ref={stageRef}
          className="viewer-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (panFrom.current = null)}
          onDoubleClick={() => zoom.fit()}
        >
          {imageUrl ? (
            <img ref={imageRef} className="viewer-image" src={imageUrl} alt="" draggable={false} />
          ) : (
            <span className="viewer-placeholder">{t("viewer.loading")}</span>
          )}
        </main>
        <footer className="toolbar">
          <IconButton icon={Copy} label={t("viewer.copyImage")} onClick={copyImage} />
          <IconButton
            icon={Link}
            label={saved ? t("viewer.copyPath") : t("viewer.copyPathDisabled")}
            onClick={copyPath}
            disabled={!saved}
          />
          <IconButton icon={Save} label={t("viewer.save")} onClick={save} disabled={saved} />
          <IconButton icon={ExternalLink} label={t("viewer.openEditor")} onClick={openEditor} />
          <output className="toolbar-status" data-tone={status?.tone} title={info?.savedPath ?? undefined}>
            {status?.text ?? info?.savedPath ?? ""}
          </output>
          <span className="toolbar-spacer" />
          <IconButton
            icon={pinned ? Pin : PinOff}
            label={pinned ? t("viewer.unpin") : t("viewer.pin")}
            onClick={togglePin}
            pressed={pinned}
          />
        </footer>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("viewer.closeTitle")}
        description={saved ? t("viewer.closeSaved") : t("viewer.closeUnsaved")}
        cancelLabel={t("viewer.cancel")}
        confirmLabel={t("viewer.confirmClose")}
        onConfirm={() => void appWindow.close()}
      />
    </Tooltip.Provider>
  );
}
