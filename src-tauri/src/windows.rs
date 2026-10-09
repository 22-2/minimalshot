use tauri::window::Color;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::capture::MonitorGeometry;
use crate::error::AppResult;
use crate::i18n::t;
use crate::state::AppState;

pub const REGION_LABEL: &str = "region";
pub const SETTINGS_LABEL: &str = "settings";
pub const VIEWER_PREFIX: &str = "viewer-";
// src/styles/tokens.css の --color-canvas。WebView の最初のフレームも白くしない。
const BACKGROUND: Color = Color(22, 23, 26, 255);

/// タイトルバー32px（論理ピクセル）。CSS の --size-titlebar と揃える。
const CHROME_HEIGHT: f64 = 32.0;
/// ウィンドウ枠の線（左右・上下とも1px）。足さないと画像が等倍に収まらず 99% になる。
const FRAME_BORDER: f64 = 2.0;
const MIN_WIDTH: f64 = 240.0;
const MIN_HEIGHT: f64 = 160.0;

fn build_viewer(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    Ok(
        WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
            .title(t("app.name"))
            .decorations(false)
            // Windows 11 の枠なし窓に付く白い1px枠を避ける。枠線は CSS 側で描く。
            .shadow(false)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .background_color(BACKGROUND)
            .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
            .build()?,
    )
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

fn region_window(app: &AppHandle) -> AppResult<WebviewWindow> {
    let state = app.state::<AppState>();
    // 起動直後のホットキーと事前準備が同時に走っても、同じラベルで二重作成しない。
    let _creation = state.region_window_lock.lock().unwrap();
    if let Some(existing) = app.get_webview_window(REGION_LABEL) {
        return Ok(existing);
    }
    Ok(
        WebviewWindowBuilder::new(app, REGION_LABEL, WebviewUrl::App("index.html".into()))
            .title(t("app.name"))
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .background_color(BACKGROUND)
            .build()?,
    )
}

pub fn prepare_region(app: &AppHandle) -> AppResult<()> {
    region_window(app)?;
    Ok(())
}

/// ビューアの物理サイズ。画像を等倍で見せつつ、モニターの9割を超えないようにする。
pub fn viewer_size(image: (u32, u32), monitor: &MonitorGeometry) -> (u32, u32) {
    let chrome = (CHROME_HEIGHT + FRAME_BORDER) * monitor.scale;
    let width = (f64::from(image.0) + FRAME_BORDER * monitor.scale)
        .max(MIN_WIDTH * monitor.scale)
        .min(f64::from(monitor.width) * 0.9);
    let height = (f64::from(image.1) + chrome)
        .max(MIN_HEIGHT * monitor.scale)
        .min(f64::from(monitor.height) * 0.9);
    (width.round() as u32, height.round() as u32)
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

pub fn open_viewer(
    app: &AppHandle,
    id: u32,
    image: (u32, u32),
    monitor: &MonitorGeometry,
    origin: Option<(i32, i32)>,
    always_on_top: bool,
) -> AppResult<()> {
    let size = viewer_size(image, monitor);
    let centered = (
        monitor.x + (monitor.width as i32 - size.0 as i32) / 2,
        monitor.y + (monitor.height as i32 - size.1 as i32) / 2,
    );
    // 領域キャプチャでは、画像が元の場所にそのまま浮いて見えるようタイトルバー分だけ上へずらす
    let desired = origin.map_or(centered, |(x, y)| {
        (x, y - (CHROME_HEIGHT * monitor.scale).round() as i32)
    });
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
        window.set_always_on_top(always_on_top)?;
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

pub fn open_region_overlay(
    app: &AppHandle,
    monitor: &MonitorGeometry,
    session: u32,
) -> AppResult<()> {
    let window = region_window(app)?;
    window.hide()?;
    window.set_position(PhysicalPosition::new(monitor.x, monitor.y))?;
    window.set_size(PhysicalSize::new(monitor.width, monitor.height))?;
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
    WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("index.html".into()))
        .title(format!("{} - {}", t("app.name"), t("settings.title")))
        .decorations(false)
        .shadow(false)
        .visible(false)
        .focused(false)
        .background_color(BACKGROUND)
        .inner_size(560.0, 640.0)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .prevent_overflow()
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
    fn viewer_fits_small_images_with_chrome() {
        assert_eq!(viewer_size((400, 300), &MONITOR), (402, 334));
    }

    #[test]
    fn viewer_has_minimum_size() {
        assert_eq!(viewer_size((10, 10), &MONITOR), (240, 160));
    }

    #[test]
    fn viewer_never_exceeds_monitor() {
        assert_eq!(viewer_size((4000, 3000), &MONITOR), (1728, 972));
    }

    #[test]
    fn viewer_chrome_scales_with_dpi() {
        let hidpi = MonitorGeometry {
            scale: 2.0,
            width: 3840,
            height: 2160,
            ..MONITOR
        };
        assert_eq!(viewer_size((800, 600), &hidpi), (804, 668));
    }

    #[test]
    fn position_is_pulled_inside_monitor() {
        assert_eq!(clamp_position((1800, -50), (400, 300), &MONITOR), (1520, 0));
    }
}
