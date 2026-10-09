use image::RgbaImage;
use xcap::{Monitor, Window};

use crate::error::{AppError, AppResult};

/// キャプチャ元モニターの物理座標とスケール。ビューアの配置に使う。
#[derive(Debug, Clone, Copy)]
pub struct MonitorGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

impl MonitorGeometry {
    fn of(monitor: &Monitor) -> AppResult<Self> {
        Ok(Self {
            x: monitor.x()?,
            y: monitor.y()?,
            width: monitor.width()?,
            height: monitor.height()?,
            scale: f64::from(monitor.scale_factor()?),
        })
    }
}

pub struct Captured {
    pub image: RgbaImage,
    pub monitor: MonitorGeometry,
}

/// カーソルのあるモニター全体を撮る。領域キャプチャもこの画像から切り出す。
pub fn monitor_at(x: i32, y: i32) -> AppResult<Captured> {
    let monitor = Monitor::from_point(x, y)?;
    Ok(Captured {
        image: monitor.capture_image()?,
        monitor: MonitorGeometry::of(&monitor)?,
    })
}

/// ホットキーを押した時点で前面にあるウィンドウを撮る。
pub fn focused_window() -> AppResult<Captured> {
    let window = Window::all()?
        .into_iter()
        .find(|w| w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(true))
        .ok_or_else(|| AppError::msg("アクティブウィンドウが見つかりません"))?;
    Ok(Captured {
        image: window.capture_image()?,
        monitor: MonitorGeometry::of(&window.current_monitor()?)?,
    })
}
