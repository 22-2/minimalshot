import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { ChevronDown, ExternalLink } from "lucide-react";

import { ContextMenuArea, DropdownMenuButton } from "../components/Menu";
import { TitleBar } from "../components/TitleBar";
import { useZoom } from "../lib/useZoom";
import { useWindowReady } from "../lib/useWindowReady";
import { api, errorMessage, type CompletedActions } from "../lib/api";
import { openWithEntries, viewerMenu } from "../lib/viewerMenu";
import { useViewer } from "../stores/viewer";
import { t } from "../i18n";

function completedActionLabels(actions: CompletedActions): string[] {
  const labels: string[] = [];
  if (actions.saved) labels.push(t("viewer.autoSaved"));
  if (actions.copied === "image") labels.push(t("viewer.autoCopiedImage"));
  if (actions.copied === "path") labels.push(t("viewer.autoCopiedPath"));
  return [...labels, ...actions.tools];
}

export function Viewer() {
  const viewer = useViewer();
  const { info, imageUrl, status, tools, confirmOnClose, load } = viewer;
  const [pinned, setPinned] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [session, setSession] = useState<number | null>(null);
  const [autoActions, setAutoActions] = useState<CompletedActions | null>(null);
  // getCurrentWindow() は呼ぶたびに別オブジェクトを返す。effect の依存に入れると毎回の描画で
  // 読み込みが走り、PNG の再取得が止まらなくなる（WebView のメモリが尽きて真っ黒になる）
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const stageRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const panFrom = useRef<{ x: number; y: number } | null>(null);
  const imageSize = useMemo(() => (info ? { width: info.width, height: info.height } : null), [info?.width, info?.height]);
  const zoom = useZoom(stageRef, imageRef, imageSize);
  useWindowReady(session !== null && (imageReady || status?.tone === "error"));

  useEffect(() => {
    let disposed = false;
    let active: number | null = null;
    const loadCapture = async (id: number) => {
      // 予備1枚は1つの撮影だけに使う。イベントと初期問い合わせの重複は読み直さない。
      if (disposed || active !== null) return;
      active = id;
      setSession(id);
      await load();
      const pinned = await appWindow.isAlwaysOnTop();
      if (!disposed) setPinned(pinned);
    };
    const reportError = (error: unknown) => {
      if (!disposed) useViewer.setState({ status: { tone: "error", text: errorMessage(error) } });
    };
    const listeners = [
      listen<number>("viewer-load", ({ payload }) => void loadCapture(payload).catch(reportError)),
      listen<string>("shot-saved", ({ payload }) => {
        if (!disposed) useViewer.getState().setSavedPath(payload);
      }),
      listen<string>("shot-error", ({ payload }) => reportError(payload)),
      listen<CompletedActions>("capture-actions", ({ payload }) => {
        if (!disposed) setAutoActions(payload);
      }),
    ];
    // listener が登録される前に割り当てられた画像も取得する。予備の間は表示しない。
    void Promise.all(listeners).then(async () => {
      if (disposed) return;
      const id = await api.viewerSession();
      if (id !== null) await loadCapture(id);
    }).catch(reportError);
    return () => {
      disposed = true;
      for (const listener of listeners) void listener.then((stop) => stop());
    };
  }, [load, appWindow]);

  const close = () => (confirmOnClose ? setConfirming(true) : void appWindow.close());

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 確認ダイアログ表示中の Esc はダイアログを閉じるだけにする
      if (event.key !== "Escape" || confirming) return;
      // メニューが開いているときの Esc はメニューを閉じるだけにする
      if (document.querySelector('[role="menu"]')) return;
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

  const changePinned = async (next: boolean) => {
    await appWindow.setAlwaysOnTop(next);
    setPinned(next);
  };

  // 操作結果は画像の隅に短く出して消す。バーを持たない代わりの通知
  const { clearStatus } = viewer;
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(clearStatus, status.tone === "error" ? 5000 : 2000);
    return () => window.clearTimeout(timer);
  }, [status, clearStatus]);

  useEffect(() => {
    if (!autoActions) return;
    const timer = window.setTimeout(() => setAutoActions(null), 2200);
    return () => window.clearTimeout(timer);
  }, [autoActions]);

  // 画像内のドラッグはパンだけ。ウィンドウの移動はタイトルバーで行う
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panFrom.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!panFrom.current) return;
    zoom.panBy(event.clientX - panFrom.current.x, event.clientY - panFrom.current.y);
    panFrom.current = { x: event.clientX, y: event.clientY };
  };

  const saved = info?.savedPath != null;
  const actions = {
      copyPath: () => void viewer.copyPath(),
      copyImage: () => void viewer.copyImage(),
      save: () => void viewer.save(),
      saveAs: () => void viewer.saveAs(),
      deleteSaved: () => void viewer.deleteSaved(),
      openWith: (tool: number) => void viewer.openWith(tool),
      reveal: () => void viewer.reveal(),
      openSettings: () => void viewer.openSettings(),
      setPinned: (next: boolean) => void changePinned(next),
  };
  const menu = viewerMenu({ saved, pinned, tools }, actions);
  const title = info
    ? `${t("app.name")}  ${info.width} × ${info.height}  ${Math.round(zoom.scale * 100)}%`
    : t("app.name");

  return (
    <>
      <div className="frame">
        <TitleBar
          title={title}
          onClose={close}
          actions={
            <DropdownMenuButton
              entries={openWithEntries(tools, actions)}
              trigger={
                <button
                  type="button"
                  className="titlebar-action"
                  aria-label={t("viewer.openWith")}
                  title={t("viewer.openWith")}
                >
                  <ExternalLink className="titlebar-action-compact" aria-hidden />
                  <span className="titlebar-action-label">{t("viewer.openWith")}</span>
                  <ChevronDown className="titlebar-action-chevron" aria-hidden />
                </button>
              }
            />
          }
        />
        <ContextMenuArea entries={menu}>
          <main
            ref={stageRef}
            className="viewer-stage"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (panFrom.current = null)}
            onDoubleClick={() => zoom.fit()}
          >
            {imageUrl ? (
              <img
                ref={imageRef}
                className="viewer-image"
                src={imageUrl}
                alt=""
                draggable={false}
                onLoad={() => setImageReady(true)}
                onError={() => useViewer.setState({ status: { tone: "error", text: t("viewer.loadFailed") } })}
              />
            ) : (
              <span className="viewer-placeholder">{t("viewer.loading")}</span>
            )}
            {status && (
              <output className="viewer-toast" data-tone={status.tone}>
                {status.text}
              </output>
            )}
            {autoActions && (
              <output className="viewer-toast viewer-action-toast">
                {t("viewer.autoActions")}: {completedActionLabels(autoActions).join("・")}
              </output>
            )}
          </main>
        </ContextMenuArea>
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
    </>
  );
}
