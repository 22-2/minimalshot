use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use crate::capture::MonitorGeometry;
use crate::error::AppResult;
use crate::i18n::t;

pub const REGION_LABEL: &str = "region";
pub const SETTINGS_LABEL: &str = "settings";
pub const VIEWER_PREFIX: &str = "viewer-";

/// タイトルバー24px + 下部ツールバー32px（論理ピクセル）。CSSのトークンと揃える。
const CHROME_HEIGHT: f64 = 56.0;
const MIN_WIDTH: f64 = 240.0;
const MIN_HEIGHT: f64 = 160.0;

pub fn viewer_label(id: u32) -> String {
    format!("{VIEWER_PREFIX}{id}")
}

/// ビューアの物理サイズ。画像を等倍で見せつつ、モニターの9割を超えないようにする。
pub fn viewer_size(image: (u32, u32), monitor: &MonitorGeometry) -> (u32, u32) {
    let chrome = CHROME_HEIGHT * monitor.scale;
    let width = f64::from(image.0)
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
        (x, y - (24.0 * monitor.scale).round() as i32)
    });
    let position = clamp_position(desired, size, monitor);

    let window =
        WebviewWindowBuilder::new(app, viewer_label(id), WebviewUrl::App("index.html".into()))
            .title(t("app.name"))
            .decorations(false)
            .always_on_top(always_on_top)
            .visible(false)
            .build()?;
    window.set_size(PhysicalSize::new(size.0, size.1))?;
    window.set_position(PhysicalPosition::new(position.0, position.1))?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

pub fn open_region_overlay(app: &AppHandle, monitor: &MonitorGeometry) -> AppResult<()> {
    if let Some(existing) = app.get_webview_window(REGION_LABEL) {
        existing.close()?;
    }
    let window = WebviewWindowBuilder::new(app, REGION_LABEL, WebviewUrl::App("index.html".into()))
        .title(t("app.name"))
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    window.set_position(PhysicalPosition::new(monitor.x, monitor.y))?;
    window.set_size(PhysicalSize::new(monitor.width, monitor.height))?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

pub fn open_settings(app: &AppHandle) -> AppResult<()> {
    if let Some(existing) = app.get_webview_window(SETTINGS_LABEL) {
        existing.unminimize()?;
        existing.set_focus()?;
        return Ok(());
    }
    WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("index.html".into()))
        .title(format!("{} - {}", t("app.name"), t("settings.title")))
        .decorations(false)
        .inner_size(560.0, 640.0)
        .min_inner_size(420.0, 360.0)
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
        assert_eq!(viewer_size((400, 300), &MONITOR), (400, 356));
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
        assert_eq!(viewer_size((800, 600), &hidpi), (800, 712));
    }

    #[test]
    fn position_is_pulled_inside_monitor() {
        assert_eq!(clamp_position((1800, -50), (400, 300), &MONITOR), (1520, 0));
    }
}
