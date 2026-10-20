import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { MenuPanel } from "../components/Menu";
import { api, type ViewerMenuRequest } from "../lib/api";
import { viewerMenu, type ViewerActions } from "../lib/viewerMenu";

/** CSS の .context-menu-anchor と Rust の MENU_PADDING と同じ、影のための余白。 */
const ANCHOR = 28;

/**
 * ビューアの右クリックメニューを、ビューアとは別の透明ウィンドウに描く。
 * 小さいビューアでもメニューが窓の外まで出せるよう、窓の大きさは内容に合わせて
 * Rust 側が決める。カーソル位置は Rust が控えており、ここでは内容だけを測る。
 */
export function ViewerMenu() {
  const [request, setRequest] = useState<ViewerMenuRequest | null>(null);
  const [menuEl, setMenuEl] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const selecting = useRef(false);

  useEffect(() => {
    let disposed = false;
    const unlisten = listen<ViewerMenuRequest>("viewer-menu-load", ({ payload }) => {
      if (disposed) return;
      selecting.current = false;
      setRequest(payload);
      setOpen(true);
    });
    // メニュー窓の読み込みが右クリックに間に合わなかった場合の取りこぼしを拾う。
    void api
      .viewerMenuState()
      .then((state) => {
        if (disposed || !state) return;
        selecting.current = false;
        setRequest(state);
        setOpen(true);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
    };
  }, []);

  useLayoutEffect(() => {
    if (!menuEl) return;
    let cancelled = false;
    let lastSize = "";
    // サブメニューは別要素として body に出るので、開いているメニュー全体の外接矩形を測る。
    // これを渡さないと、ツール一覧がメニュー窓の外で切れる。
    const measure = () => {
      let width = menuEl.offsetWidth + ANCHOR * 2;
      let height = menuEl.offsetHeight + ANCHOR * 2;
      for (const menu of document.querySelectorAll<HTMLElement>('[role="menu"]')) {
        const rect = menu.getBoundingClientRect();
        width = Math.max(width, rect.right + ANCHOR);
        height = Math.max(height, rect.bottom + ANCHOR);
      }
      return { width: Math.round(width), height: Math.round(height) };
    };
    const report = () => {
      const { width, height } = measure();
      if (width <= 0 || height <= 0) return;
      const size = `${width}x${height}`;
      if (size === lastSize) return;
      lastSize = size;
      void api
        .showViewerMenu(width, height)
        .then(() => {
          if (cancelled) return;
          // 窓を表示した時点で WebView にフォーカスが移る。矢印キーをすぐ使えるよう
          // 先頭項目へフォーカスを移す（既に項目が選ばれている場合は邪魔しない）。
          if (document.activeElement === document.body) {
            menuEl.querySelector<HTMLElement>(".menu-item, .menu-icon-item")?.focus();
          }
        })
        .catch(() => undefined);
    };
    const resize = new ResizeObserver(report);
    const observeMenus = () => {
      for (const menu of document.querySelectorAll<HTMLElement>('[role="menu"]')) {
        resize.observe(menu);
      }
    };
    resize.observe(menuEl);
    const mutation = new MutationObserver(() => {
      observeMenus();
      report();
    });
    mutation.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    report();
    return () => {
      cancelled = true;
      resize.disconnect();
      mutation.disconnect();
    };
  }, [menuEl]);

  const entries = useMemo(() => {
    if (!request) return [];
    const select = (id: string, checked?: boolean) => {
      selecting.current = true;
      void api.selectViewerMenuItem(id, checked).catch(() => {
        selecting.current = false;
      });
    };
    const actions: ViewerActions = {
      copyPath: () => select("copy-path"),
      copyImage: () => select("copy-image"),
      save: () => select("save"),
      saveAs: () => select("save-as"),
      deleteSaved: () => select("delete"),
      openEditor: () => select("edit"),
      openWith: (tool) => select(`tool-${tool}`),
      reveal: () => select("reveal"),
      openSettings: () => select("settings"),
      setPinned: (pinned) => select("pin", pinned),
      actualSize: () => select("actual-size"),
    };
    return viewerMenu(request, actions);
  }, [request]);

  const close = () => {
    setOpen(false);
    // 項目の選択中は select_viewer_menu_item が窓を隠す。ここから先に隠すと、
    // 親ビューアへ送るはずのアクションが消える。
    if (!selecting.current) void api.hideViewerMenu().catch(() => undefined);
  };

  if (!request) return null;

  return (
    <DropdownMenu.Root
      key={request.requestId}
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      modal={false}
    >
      {/* DropdownMenu に Anchor は無いので、位置決め用の 0×0 の Trigger を置く。 */}
      <DropdownMenu.Trigger asChild>
        <span className="context-menu-anchor" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          ref={setMenuEl}
          className="menu menu-context"
          side="bottom"
          align="start"
          sideOffset={0}
          alignOffset={0}
          avoidCollisions={false}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <MenuPanel entries={entries} subContentProps={{ avoidCollisions: false }} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
