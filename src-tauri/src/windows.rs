use tauri::window::Color;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::capture::{MonitorGeometry, ScreenBounds};
use crate::config::{Viewer, ViewerLayout, ViewerSize};
use crate::error::AppResult;
use crate::i18n::t;
use crate::state::{
    AppState, PreviewCapture, ViewerMenuAction, ViewerMenuLoad, ViewerMenuRequest, ViewerMenuState,
};

pub const REGION_LABEL: &str = "region";
pub const SETTINGS_LABEL: &str = "settings";
pub const ABOUT_LABEL: &str = "about";
pub const VIEWER_PREFIX: &str = "viewer-";
pub const EDITOR_PREFIX: &str = "editor-";
pub const PREVIEW_PREFIX: &str = "capture-preview-";
/// `viewer-` で始めない。ビューアの予備窓を探す処理とラベルが衝突する。
pub const VIEWER_MENU_LABEL: &str = "context-menu";
// src/styles/tokens.css の --color-canvas。WebView の最初のフレームも白くしない。
const BACKGROUND: Color = Color(22, 23, 26, 255);
/// wry の既定値に CalculateNativeWinOcclusion を加える。WebView2 は cloak した窓を
/// 隠れたものとみなして描画を止めるため、領域選択を表示した瞬間に前回の画面が残る。
/// 同じプロファイルの WebView2 は引数を揃える必要があるので、全窓に同じ値を渡す。
#[cfg(windows)]
const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion";

fn window_builder<'a>(
    app: &'a AppHandle,
    label: &str,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()));
    #[cfg(windows)]
    let builder = builder.additional_browser_args(BROWSER_ARGS);
    builder
}

const VIEWER_WIDTH: f64 = 800.0;
const VIEWER_HEIGHT: f64 = 450.0;
/// タイトルバー32px（論理ピクセル）。CSS の --size-titlebar と揃える。
const CHROME_HEIGHT: f64 = 32.0;
/// ウィンドウ枠の線（左右・上下とも1px）。足さないと画像が等倍に収まらず 99% になる。
const FRAME_BORDER: f64 = 2.0;
const MIN_WIDTH: f64 = 240.0;
const MIN_HEIGHT: f64 = 160.0;
/// メニュー窓の内側に空ける余白（論理ピクセル）。CSS の .context-menu-anchor と揃える。
/// `--shadow-menu` のぼかしが窓の縁で切れない大きさにする。
const MENU_PADDING: f64 = 28.0;

const EDITOR_WIDTH: f64 = 960.0;
const EDITOR_HEIGHT: f64 = 720.0;
const EDITOR_MIN_WIDTH: f64 = 480.0;
const EDITOR_MIN_HEIGHT: f64 = 360.0;

fn build_viewer(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    Ok(window_builder(app, label)
        .title(t("app.name"))
        .decorations(false)
        // Windows 11 の枠なし窓に付く白い1px枠を避ける。枠線は CSS 側で描く。
        .shadow(false)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .background_color(BACKGROUND)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .build()?)
}

fn build_editor(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    Ok(window_builder(app, label)
        .title(format!("{} - {}", t("app.name"), t("editor.title")))
        .decorations(false)
        .shadow(false)
        .visible(false)
        .focused(false)
        .background_color(BACKGROUND)
        .min_inner_size(EDITOR_MIN_WIDTH, EDITOR_MIN_HEIGHT)
        .prevent_overflow()
        .build()?)
}

fn build_viewer_menu(app: &AppHandle) -> AppResult<WebviewWindow> {
    let builder = window_builder(app, VIEWER_MENU_LABEL)
        .title(t("app.name"))
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .inner_size(1.0, 1.0);
    // メニューの角丸と影をそのまま見せる。中身の大きさは表示直前にフロントエンドが決める。
    #[cfg(windows)]
    let builder = builder
        .transparent(true)
        .background_color(Color(0, 0, 0, 0));
    #[cfg(not(windows))]
    let builder = builder.background_color(BACKGROUND);
    Ok(builder.build()?)
}

pub fn prepare_viewer_menu(app: &AppHandle) -> AppResult<()> {
    if app.get_webview_window(VIEWER_MENU_LABEL).is_some() {
        return Ok(());
    }
    build_viewer_menu(app)?;
    Ok(())
}

/// カーソル位置にメニューの左上を合わせる。右・下に入り切らないときは
/// メニューの右下がカーソルに重なるよう反転し、最後にモニター内へ収める。
pub fn menu_window_rect(
    cursor: (f64, f64),
    menu: (f64, f64),
    monitor: &MonitorGeometry,
    scale: f64,
) -> (i32, i32, u32, u32) {
    let padding = MENU_PADDING * scale;
    let width = (menu.0 * scale + padding * 2.0).round().max(1.0);
    let height = (menu.1 * scale + padding * 2.0).round().max(1.0);
    let right = f64::from(monitor.x) + f64::from(monitor.width);
    let bottom = f64::from(monitor.y) + f64::from(monitor.height);
    let mut x = cursor.0 - padding;
    let mut y = cursor.1 - padding;
    if x + width > right {
        x = cursor.0 - width + padding;
    }
    if y + height > bottom {
        y = cursor.1 - height + padding;
    }
    x = x.min(right - width).max(f64::from(monitor.x)).round();
    y = y.min(bottom - height).max(f64::from(monitor.y)).round();
    (x as i32, y as i32, width as u32, height as u32)
}

/// build は UI スレッドとの往復を伴うので、pool のロックを保持せず実行する。
pub fn prepare_viewer(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    let Some(label) = state.viewers.lock().unwrap().reserve_spare() else {
        return Ok(());
    };
    match build_viewer(app, &label) {
        Ok(_) => state.viewers.lock().unwrap().spare_created(&label),
        Err(error) => {
            state.viewers.lock().unwrap().remove(&label);
            return Err(error);
        }
    }
    Ok(())
}

/// ビューアのカーソル位置を控え、メニュー窓へ内容を送る。窓がまだ無ければ false を返し、
/// 呼び出し側は WebView 内のメニューへフォールバックする。
pub fn open_viewer_menu(
    app: &AppHandle,
    parent: &WebviewWindow,
    state: ViewerMenuState,
) -> AppResult<bool> {
    let Some(menu) = app.get_webview_window(VIEWER_MENU_LABEL) else {
        return Ok(false);
    };
    let anchor = parent.cursor_position()?;
    let app_state = app.state::<AppState>();
    let load = ViewerMenuLoad {
        request_id: app_state.next_viewer_menu_id(),
        state,
    };
    *app_state.viewer_menu.lock().unwrap() = Some(ViewerMenuRequest {
        parent: parent.label().to_owned(),
        anchor,
        load: load.clone(),
    });
    menu.emit("viewer-menu-load", load)?;
    Ok(true)
}

pub fn show_viewer_menu(
    app: &AppHandle,
    window: &WebviewWindow,
    width: f64,
    height: f64,
) -> AppResult<()> {
    if window.label() != VIEWER_MENU_LABEL {
        return Ok(());
    }
    let Some(anchor) = app
        .state::<AppState>()
        .viewer_menu
        .lock()
        .unwrap()
        .as_ref()
        .map(|request| request.anchor)
    else {
        return Ok(());
    };
    let Some(monitor) = window
        .monitor_from_point(anchor.x, anchor.y)?
        .or(window.current_monitor()?)
        .or(app.primary_monitor()?)
    else {
        return Ok(());
    };
    let geometry = MonitorGeometry {
        x: monitor.position().x,
        y: monitor.position().y,
        width: monitor.size().width,
        height: monitor.size().height,
        scale: monitor.scale_factor(),
    };
    let (x, y, width, height) = menu_window_rect(
        (anchor.x, anchor.y),
        (width, height),
        &geometry,
        window.scale_factor()?,
    );
    window.set_size(PhysicalSize::new(width, height))?;
    window.set_position(PhysicalPosition::new(x, y))?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

pub fn hide_viewer_menu(
    app: &AppHandle,
    window: &WebviewWindow,
    focus_parent: bool,
) -> AppResult<()> {
    let request = app.state::<AppState>().viewer_menu.lock().unwrap().take();
    window.hide()?;
    if focus_parent {
        if let Some(parent) = request.and_then(|request| app.get_webview_window(&request.parent)) {
            parent.set_focus()?;
        }
    }
    Ok(())
}

pub fn select_viewer_menu_item(
    app: &AppHandle,
    window: &WebviewWindow,
    id: String,
    checked: Option<bool>,
) -> AppResult<()> {
    let request = app.state::<AppState>().viewer_menu.lock().unwrap().take();
    window.hide()?;
    let Some(request) = request else {
        return Ok(());
    };
    if let Some(parent) = app.get_webview_window(&request.parent) {
        parent.emit("viewer-menu-action", ViewerMenuAction { id, checked })?;
        parent.set_focus()?;
    }
    Ok(())
}

fn region_window(app: &AppHandle) -> AppResult<WebviewWindow> {
    let state = app.state::<AppState>();
    // 起動直後のホットキーと事前準備が同時に走っても、同じラベルで二重作成しない。
    let _creation = state.region_window_lock.lock().unwrap();
    if let Some(existing) = app.get_webview_window(REGION_LABEL) {
        return Ok(existing);
    }
    let builder = window_builder(app, REGION_LABEL)
        .title(t("app.name"))
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .focusable(!cfg!(windows))
        .background_color(BACKGROUND);
    // 表示直後に WebView2 の空フレームが合成されても、撮影前の画面をそのまま見せる。
    #[cfg(windows)]
    let builder = builder
        .transparent(true)
        .background_color(Color(0, 0, 0, 0));
    let window = builder.build()?;
    let prepare = || -> AppResult<()> {
        let monitors = app.available_monitors()?;
        let bounds = ScreenBounds::covering(monitors.iter().map(|monitor| {
            (
                monitor.position().x,
                monitor.position().y,
                monitor.size().width,
                monitor.size().height,
            )
        }))?;
        crate::region_window::set_bounds(&window, &bounds)?;
        crate::region_window::prepare(&window)
    };
    if let Err(error) = prepare() {
        window.destroy()?;
        return Err(error);
    }
    Ok(window)
}

pub fn prepare_region(app: &AppHandle) -> AppResult<()> {
    region_window(app)?;
    Ok(())
}

/// 撮影元に重なる既定の窓と、余白付きの16:9の窓、前回の大きさを切り替える。
pub fn viewer_size(
    image: (u32, u32),
    monitor: &MonitorGeometry,
    layout: ViewerLayout,
    remembered: Option<ViewerSize>,
) -> (u32, u32) {
    // 記憶した大きさは、最小サイズとモニターの9割に収めてから使う。
    if let (ViewerLayout::Remember, Some(size)) = (layout, remembered) {
        let width = (f64::from(size.width) * monitor.scale)
            .max(MIN_WIDTH * monitor.scale)
            .min(f64::from(monitor.width) * 0.9);
        let height = (f64::from(size.height) * monitor.scale)
            .max(MIN_HEIGHT * monitor.scale)
            .min(f64::from(monitor.height) * 0.9);
        return (width.round() as u32, height.round() as u32);
    }
    // 初回の「大きさを記憶する」は撮影元に合わせ、リサイズ後から大きさを引き継ぐ。
    if matches!(layout, ViewerLayout::Source | ViewerLayout::Remember) {
        let chrome = (CHROME_HEIGHT + FRAME_BORDER) * monitor.scale;
        let width = (f64::from(image.0) + FRAME_BORDER * monitor.scale)
            .max(MIN_WIDTH * monitor.scale)
            .min(f64::from(monitor.width) * 0.9);
        let height = (f64::from(image.1) + chrome)
            .max(MIN_HEIGHT * monitor.scale)
            .min(f64::from(monitor.height) * 0.9);
        return (width.round() as u32, height.round() as u32);
    }
    let width = VIEWER_WIDTH * monitor.scale;
    let height = VIEWER_HEIGHT * monitor.scale;
    let fit = 1.0_f64
        .min(f64::from(monitor.width) * 0.9 / width)
        .min(f64::from(monitor.height) * 0.9 / height);
    ((width * fit).round() as u32, (height * fit).round() as u32)
}

/// リサイズ後のビューアの大きさを覚える。バインディング前や最小化中の値は無視する。
pub fn remember_viewer_size(app: &AppHandle, window: &tauri::Window, size: PhysicalSize<u32>) {
    let state = app.state::<AppState>();
    if state.config.lock().unwrap().viewer.layout != ViewerLayout::Remember {
        return;
    }
    if state
        .viewers
        .lock()
        .unwrap()
        .shot_id(window.label())
        .is_none()
    {
        return;
    }
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let Some(scale) = window.scale_factor().ok().filter(|scale| *scale > 0.0) else {
        return;
    };
    let logical = ViewerSize {
        width: (f64::from(size.width) / scale).round() as u32,
        height: (f64::from(size.height) / scale).round() as u32,
    };
    if f64::from(logical.width) < MIN_WIDTH || f64::from(logical.height) < MIN_HEIGHT {
        return;
    }
    let mut config = state.config.lock().unwrap();
    if config.viewer.remembered_size != Some(logical) {
        config.viewer.remembered_size = Some(logical);
        state
            .viewer_size_dirty
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// エディタは注釈を描く余地を優先し、撮影画像の大きさには合わせない。
pub fn editor_size(monitor: &MonitorGeometry) -> (u32, u32) {
    let width = EDITOR_WIDTH * monitor.scale;
    let height = EDITOR_HEIGHT * monitor.scale;
    let fit = 1.0_f64
        .min(f64::from(monitor.width) * 0.9 / width)
        .min(f64::from(monitor.height) * 0.9 / height);
    ((width * fit).round() as u32, (height * fit).round() as u32)
}

/// 指定位置に置きたいが、モニターからはみ出す場合は内側へ寄せる。
pub fn clamp_position(
    desired: (i32, i32),
    size: (u32, u32),
    monitor: &MonitorGeometry,
) -> (i32, i32) {
    let max_x = monitor.x + monitor.width as i32 - size.0 as i32;
    let max_y = monitor.y + monitor.height as i32 - size.1 as i32;
    (
        desired.0.min(max_x).max(monitor.x),
        desired.1.min(max_y).max(monitor.y),
    )
}

fn preview_label(state: &AppState) -> String {
    let number = state
        .next_preview_label
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        + 1;
    format!("{PREVIEW_PREFIX}{number}")
}

fn build_capture_preview(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    let builder = window_builder(app, label)
        .title(t("app.name"))
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false);
    #[cfg(windows)]
    let builder = builder
        .transparent(true)
        .background_color(Color(0, 0, 0, 0));
    #[cfg(not(windows))]
    let builder = builder.background_color(BACKGROUND);
    Ok(builder.build()?)
}

/// WebView の起動と画面読み込みを、撮影する前に済ませておく。
pub fn prepare_capture_preview(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    let label = {
        let mut spare = state.preview_spare.lock().unwrap();
        if spare.is_some() {
            return Ok(());
        }
        let label = preview_label(&state);
        *spare = Some((label.clone(), false));
        label
    };
    match build_capture_preview(app, &label) {
        Ok(_) => {
            let mut spare = state.preview_spare.lock().unwrap();
            if let Some((reserved, ready)) = spare.as_mut() {
                if *reserved == label {
                    *ready = true;
                }
            }
            Ok(())
        }
        Err(error) => {
            *state.preview_spare.lock().unwrap() = None;
            Err(error)
        }
    }
}

/// 次の撮影にプレビュー自身が写り込まないよう、撮影前に閉じる。
pub fn dismiss_capture_previews(app: &AppHandle) {
    let state = app.state::<AppState>();
    let previews: Vec<_> = state.previews.lock().unwrap().drain().collect();
    for (label, preview) in previews {
        state.shots.remove(preview.id);
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
    }
}

/// タスクバーを除く作業領域の右下に、撮影画像の一時プレビューを置く。
pub fn open_capture_preview(
    app: &AppHandle,
    id: u32,
    monitor: MonitorGeometry,
    origin: Option<(i32, i32)>,
    thumbnail: image::RgbaImage,
) -> AppResult<()> {
    let state = app.state::<AppState>();
    let thumbnail_size = thumbnail.dimensions();
    let (label, spare, old) = {
        let mut previews = state.previews.lock().unwrap();
        if state
            .latest_preview_id
            .load(std::sync::atomic::Ordering::Relaxed)
            != id
        {
            state.shots.remove(id);
            return Ok(());
        }
        let spare = {
            let mut spare = state.preview_spare.lock().unwrap();
            if spare.as_ref().is_some_and(|(_, ready)| *ready) {
                spare.take().map(|(label, _)| label)
            } else {
                None
            }
        };
        let label = spare.clone().unwrap_or_else(|| preview_label(&state));
        let old: Vec<(String, PreviewCapture)> = previews.drain().collect();
        previews.insert(
            label.clone(),
            PreviewCapture {
                id,
                monitor,
                origin,
                ready: false,
                thumbnail,
                completed: Default::default(),
            },
        );
        (label, spare, old)
    };
    for (previous, preview) in old {
        state.shots.remove(preview.id);
        if let Some(window) = app.get_webview_window(&previous) {
            let _ = window.destroy();
        }
    }
    let result = (|| -> AppResult<()> {
        let area = app
            .available_monitors()?
            .into_iter()
            .find(|m| m.position().x == monitor.x && m.position().y == monitor.y)
            .map(|m| *m.work_area());
        let (x, y, width, height) = area.map_or(
            (monitor.x, monitor.y, monitor.width, monitor.height),
            |rect| {
                (
                    rect.position.x,
                    rect.position.y,
                    rect.size.width,
                    rect.size.height,
                )
            },
        );
        let scale = monitor.scale.max(0.1);
        let margin = (16.0 * scale).round() as u32;
        // ステータスの高さは CapturePreview.css と揃える。
        let status_height = (64.0 * scale).round() as u32;
        let available_w = width.saturating_sub(margin * 2).max(1);
        let available_h = height.saturating_sub(margin * 2).max(1);
        // 画像は最大 264x180 に収め、元の物理ピクセル数より拡大しない。
        let max_w = ((264.0 * scale).round() as u32).min(available_w).max(1);
        let max_h = ((180.0 * scale).round() as u32)
            .min(available_h.saturating_sub(status_height))
            .max(1);
        let (image_w, image_h) = crate::preview_size::fit_image(thumbnail_size, (max_w, max_h));
        let w = image_w.max((200.0 * scale).round() as u32).min(available_w);
        let h = image_h.saturating_add(status_height).min(available_h);
        let window = if spare.is_some() {
            app.get_webview_window(&label)
                .ok_or_else(|| crate::error::AppError::msg("予備のプレビューが見つかりません"))?
        } else {
            build_capture_preview(app, &label)?
        };
        window.set_size(PhysicalSize::new(w, h))?;
        window.set_position(PhysicalPosition::new(
            x + width.saturating_sub(w + margin) as i32,
            y + height.saturating_sub(h + margin) as i32,
        ))?;
        let mut previews = state.previews.lock().unwrap();
        if let Some(preview) = previews.get_mut(&label) {
            preview.ready = true;
        } else {
            drop(previews);
            let _ = window.destroy();
            return Ok(());
        }
        drop(previews);
        window.emit("capture-preview-load", id)?;
        let app_for_spare = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            crate::report(prepare_capture_preview(&app_for_spare));
        });
        let handle = window.clone();
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(std::time::Duration::from_secs(15));
            let _ = handle.destroy();
        });
        Ok(())
    })();
    if result.is_err() {
        state.previews.lock().unwrap().remove(&label);
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
    }
    result
}

pub fn open_viewer(
    app: &AppHandle,
    id: u32,
    image: (u32, u32),
    monitor: &MonitorGeometry,
    origin: Option<(i32, i32)>,
    viewer: &Viewer,
) -> AppResult<()> {
    let size = viewer_size(image, monitor, viewer.layout, viewer.remembered_size);
    let centered = (
        monitor.x + (monitor.width as i32 - size.0 as i32) / 2,
        monitor.y + (monitor.height as i32 - size.1 as i32) / 2,
    );
    let desired = match viewer.layout {
        ViewerLayout::Source => origin.map_or(centered, |(x, y)| {
            // 領域キャプチャは、タイトルバーを撮影範囲の上に置いて元の場所に重ねる。
            (x, y - (CHROME_HEIGHT * monitor.scale).round() as i32)
        }),
        ViewerLayout::Framed | ViewerLayout::Remember => origin.map_or(centered, |(x, y)| {
            // 決まった大きさの窓は選択範囲の中心付近に置く。
            (
                x + image.0 as i32 / 2 - size.0 as i32 / 2,
                y + image.1 as i32 / 2 - size.1 as i32 / 2,
            )
        }),
    };
    let position = clamp_position(desired, size, monitor);

    let state = app.state::<AppState>();
    let (label, spare) = {
        let mut pool = state.viewers.lock().unwrap();
        match pool.take_spare() {
            Some(label) => (label, true),
            None => (pool.new_label(), false),
        }
    };
    let window = if spare {
        app.get_webview_window(&label)
            .ok_or_else(|| crate::error::AppError::msg("予備のビューアが見つかりません"))?
    } else {
        build_viewer(app, &label)?
    };
    let configure = || -> AppResult<()> {
        window.set_always_on_top(viewer.always_on_top)?;
        window.set_size(PhysicalSize::new(size.0, size.1))?;
        window.set_position(PhysicalPosition::new(position.0, position.1))?;
        // 位置・サイズを確定してから割り当てる。初期化中のフロントエンドは
        // viewer_session でも取得でき、イベントが先に届いても取りこぼさない。
        state.viewers.lock().unwrap().bind(label.clone(), id);
        window.emit("viewer-load", id)?;
        Ok(())
    };
    if let Err(error) = configure() {
        state.viewers.lock().unwrap().remove(&label);
        window.destroy()?;
        return Err(error);
    }
    Ok(())
}

pub fn open_editor(app: &AppHandle, id: u32, monitor: &MonitorGeometry) -> AppResult<()> {
    let size = editor_size(monitor);
    let position = (
        monitor.x + (monitor.width as i32 - size.0 as i32) / 2,
        monitor.y + (monitor.height as i32 - size.1 as i32) / 2,
    );

    let state = app.state::<AppState>();
    let label = state.editors.lock().unwrap().new_label();
    let window = match build_editor(app, &label) {
        Ok(window) => window,
        Err(error) => {
            state.editors.lock().unwrap().remove(&label);
            return Err(error);
        }
    };
    let configure = || -> AppResult<()> {
        window.set_size(PhysicalSize::new(size.0, size.1))?;
        window.set_position(PhysicalPosition::new(position.0, position.1))?;
        // 配置を確定してから割り当てる。初期化中のフロントエンドは editor_session でも取得できる。
        state.editors.lock().unwrap().bind(label.clone(), id);
        window.emit("editor-load", id)?;
        Ok(())
    };
    if let Err(error) = configure() {
        state.editors.lock().unwrap().remove(&label);
        window.destroy()?;
        return Err(error);
    }
    Ok(())
}

pub fn open_region_overlay(app: &AppHandle, bounds: &ScreenBounds, session: u32) -> AppResult<()> {
    let window = region_window(app)?;
    crate::region_window::hide(&window)?;
    crate::region_window::set_bounds(&window, bounds)?;
    // 新規 WebView の listener が間に合わない場合は region_session で取得する。
    window.emit("region-load", session)?;
    Ok(())
}

pub fn open_settings(app: &AppHandle) -> AppResult<()> {
    if let Some(existing) = app.get_webview_window(SETTINGS_LABEL) {
        if existing.is_visible()? {
            existing.unminimize()?;
            existing.set_focus()?;
        } else {
            // 閉じたときの未保存編集を捨て、最新の設定を読み込んでから再表示する。
            existing.emit("settings-open", ())?;
        }
        return Ok(());
    }
    window_builder(app, SETTINGS_LABEL)
        .title(format!("{} - {}", t("app.name"), t("settings.title")))
        .decorations(false)
        .shadow(false)
        .visible(false)
        .focused(false)
        .background_color(BACKGROUND)
        .inner_size(760.0, 600.0)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .prevent_overflow()
        .center()
        .build()?;
    Ok(())
}

pub fn open_about(app: &AppHandle) -> AppResult<()> {
    if let Some(existing) = app.get_webview_window(ABOUT_LABEL) {
        existing.unminimize()?;
        existing.set_focus()?;
        return Ok(());
    }
    window_builder(app, ABOUT_LABEL)
        .title(format!("{} - {}", t("app.name"), t("about.title")))
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .visible(false)
        .focused(false)
        .background_color(BACKGROUND)
        .inner_size(360.0, 260.0)
        .min_inner_size(300.0, 180.0)
        .center()
        .build()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: MonitorGeometry = MonitorGeometry {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        scale: 1.0,
    };

    #[test]
    fn source_viewer_follows_image_size() {
        assert_eq!(
            viewer_size((400, 300), &MONITOR, ViewerLayout::Source, None),
            (402, 334)
        );
        assert_eq!(
            viewer_size((10, 10), &MONITOR, ViewerLayout::Source, None),
            (240, 160)
        );
        assert_eq!(
            viewer_size((4000, 3000), &MONITOR, ViewerLayout::Source, None),
            (1728, 972)
        );
    }

    #[test]
    fn framed_viewer_uses_fixed_sixteen_by_nine_size() {
        assert_eq!(
            viewer_size((400, 300), &MONITOR, ViewerLayout::Framed, None),
            (800, 450)
        );
    }

    #[test]
    fn remember_viewer_uses_the_last_size_and_clamps_it() {
        let remembered = Some(ViewerSize {
            width: 640,
            height: 400,
        });
        assert_eq!(
            viewer_size((400, 300), &MONITOR, ViewerLayout::Remember, remembered),
            (640, 400)
        );
        // 小さすぎる記憶値は最小サイズまで、大きすぎる値はモニターの9割まで詰める
        assert_eq!(
            viewer_size(
                (400, 300),
                &MONITOR,
                ViewerLayout::Remember,
                Some(ViewerSize {
                    width: 10,
                    height: 10
                })
            ),
            (240, 160)
        );
        assert_eq!(
            viewer_size(
                (400, 300),
                &MONITOR,
                ViewerLayout::Remember,
                Some(ViewerSize {
                    width: 4000,
                    height: 3000
                })
            ),
            (1728, 972)
        );
    }

    #[test]
    fn remember_viewer_without_a_size_falls_back_to_the_capture() {
        assert_eq!(
            viewer_size((400, 300), &MONITOR, ViewerLayout::Remember, None),
            viewer_size((400, 300), &MONITOR, ViewerLayout::Source, None)
        );
    }

    #[test]
    fn viewer_shrinks_proportionally_on_small_monitors() {
        let small = MonitorGeometry {
            width: 800,
            height: 600,
            ..MONITOR
        };
        assert_eq!(
            viewer_size((400, 300), &small, ViewerLayout::Framed, None),
            (720, 405)
        );
    }

    #[test]
    fn viewer_never_exceeds_monitor() {
        let small = MonitorGeometry {
            width: 640,
            height: 360,
            ..MONITOR
        };
        assert_eq!(
            viewer_size((400, 300), &small, ViewerLayout::Framed, None),
            (576, 324)
        );
    }

    #[test]
    fn viewer_size_scales_with_dpi() {
        let hidpi = MonitorGeometry {
            scale: 2.0,
            width: 3840,
            height: 2160,
            ..MONITOR
        };
        assert_eq!(
            viewer_size((800, 600), &hidpi, ViewerLayout::Framed, None),
            (1600, 900)
        );
        assert_eq!(
            viewer_size((800, 600), &hidpi, ViewerLayout::Source, None),
            (804, 668)
        );
    }

    #[test]
    fn editor_uses_a_large_fixed_window_and_shrinks_on_small_monitors() {
        assert_eq!(editor_size(&MONITOR), (960, 720));
        let small = MonitorGeometry {
            width: 800,
            height: 600,
            ..MONITOR
        };
        assert_eq!(editor_size(&small), (720, 540));
        let hidpi = MonitorGeometry {
            scale: 2.0,
            width: 3840,
            height: 2160,
            ..MONITOR
        };
        assert_eq!(editor_size(&hidpi), (1920, 1440));
    }

    #[test]
    fn position_is_pulled_inside_monitor() {
        assert_eq!(clamp_position((1800, -50), (400, 300), &MONITOR), (1520, 0));
    }

    #[test]
    fn menu_opens_toward_the_cursor_with_padding_for_its_shadow() {
        let (x, y, width, height) = menu_window_rect((100.0, 100.0), (276.0, 252.0), &MONITOR, 1.0);
        assert_eq!((x, y), (72, 72));
        assert_eq!((width, height), (332, 308));
    }

    #[test]
    fn menu_flips_when_it_would_leave_the_monitor() {
        let (x, y, _, _) = menu_window_rect((1900.0, 1070.0), (276.0, 252.0), &MONITOR, 1.0);
        // 右下がカーソルに重なる位置へ反転し、影の余白ごと画面内へ収める
        assert_eq!((x, y), (1588, 772));
    }

    #[test]
    fn menu_position_follows_the_dpi_scale() {
        let hidpi = MonitorGeometry {
            scale: 2.0,
            width: 3840,
            height: 2160,
            ..MONITOR
        };
        assert_eq!(
            menu_window_rect((200.0, 200.0), (276.0, 252.0), &hidpi, 2.0),
            (144, 144, 664, 616)
        );
    }
}
