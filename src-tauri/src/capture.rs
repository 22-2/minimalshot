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

/// Windows 8 以降の GDI キャプチャはアルファが 0 のまま返ることがあり、
/// そのまま表示・保存すると透明（暗い背景で真っ黒）になるため不透明にそろえる。
pub fn make_opaque(mut image: RgbaImage) -> RgbaImage {
    for pixel in image.pixels_mut() {
        pixel.0[3] = 255;
    }
    image
}

pub struct Captured {
    pub image: RgbaImage,
    pub monitor: MonitorGeometry,
}

/// カーソルのあるモニター全体を撮る。領域キャプチャもこの画像から切り出す。
pub fn monitor_at(x: i32, y: i32) -> AppResult<Captured> {
    let monitor = Monitor::from_point(x, y)?;
    Ok(Captured {
        image: make_opaque(monitor.capture_image()?),
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
        image: make_opaque(window.capture_image()?),
        monitor: MonitorGeometry::of(&window.current_monitor()?)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn makes_transparent_pixels_opaque() {
        let image = make_opaque(RgbaImage::from_pixel(2, 2, Rgba([10, 20, 30, 0])));
        assert!(image.pixels().all(|p| *p == Rgba([10, 20, 30, 255])));
    }

    /// 実際の画面を撮る。デスクトップのある環境（CI の Windows ランナー）でだけ `--ignored` で実行する。
    #[test]
    #[ignore = "needs a real desktop session"]
    fn captures_primary_monitor_opaquely() {
        let captured = monitor_at(0, 0).expect("capture primary monitor");
        assert!(captured.image.width() > 0 && captured.image.height() > 0);
        assert!(captured.image.pixels().all(|p| p.0[3] == 255));
        let png = crate::imaging::encode_png(&captured.image).unwrap();
        assert_eq!(&png[1..4], b"PNG");
    }
}
