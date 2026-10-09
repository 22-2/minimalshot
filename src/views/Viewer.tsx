import { useEffect, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Copy, ExternalLink, Link, Pin, PinOff, Save } from "lucide-react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { IconButton } from "../components/IconButton";
import { TitleBar } from "../components/TitleBar";
import { api } from "../lib/api";
import { useViewer } from "../stores/viewer";
import { t } from "../i18n";

export function Viewer() {
  const { info, imageUrl, status, load, copyImage, copyPath, save, openEditor } = useViewer();
  const [pinned, setPinned] = useState(false);
  const [confirmOnClose, setConfirmOnClose] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    void load();
    void appWindow.isAlwaysOnTop().then(setPinned);
    void api.getConfig().then((config) => setConfirmOnClose(config.viewer.confirm_on_close));
  }, [load, appWindow]);

  const close = () => (confirmOnClose ? setConfirming(true) : void appWindow.close());

  const togglePin = async () => {
    await appWindow.setAlwaysOnTop(!pinned);
    setPinned(!pinned);
  };

  // 画像のどこを掴んでもウィンドウごと動かせるようにする
  const dragWindow = (event: MouseEvent) => {
    if (event.button === 0) void appWindow.startDragging();
  };

  const saved = info?.savedPath != null;
  const title = info ? `${t("app.name")}  ${info.width} × ${info.height}` : t("app.name");

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="frame">
        <TitleBar title={title} onClose={close} />
        <main className="viewer-stage" onMouseDown={dragWindow}>
          {imageUrl ? (
            <img className="viewer-image" src={imageUrl} alt="" draggable={false} />
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
