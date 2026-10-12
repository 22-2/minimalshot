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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl ScreenBounds {
    pub fn covering(screens: impl IntoIterator<Item = (i32, i32, u32, u32)>) -> AppResult<Self> {
        let mut screens = screens.into_iter();
        let (x, y, width, height) = screens
            .next()
            .ok_or_else(|| AppError::msg("ディスプレイが見つかりません"))?;
        let (mut left, mut top) = (x, y);
        let mut right = i64::from(x) + i64::from(width);
        let mut bottom = i64::from(y) + i64::from(height);
        for (x, y, width, height) in screens {
            left = left.min(x);
            top = top.min(y);
            right = right.max(i64::from(x) + i64::from(width));
            bottom = bottom.max(i64::from(y) + i64::from(height));
        }
        Ok(Self {
            x: left,
            y: top,
            width: u32::try_from(right - i64::from(left))
                .map_err(|_| AppError::msg("全画面の幅が大きすぎます"))?,
            height: u32::try_from(bottom - i64::from(top))
                .map_err(|_| AppError::msg("全画面の高さが大きすぎます"))?,
        })
    }

    pub fn selection_origin(&self, x: u32, y: u32) -> AppResult<(i32, i32)> {
        let x = i32::try_from(i64::from(self.x) + i64::from(x))
            .map_err(|_| AppError::msg("選択位置が画面の範囲外です"))?;
        let y = i32::try_from(i64::from(self.y) + i64::from(y))
            .map_err(|_| AppError::msg("選択位置が画面の範囲外です"))?;
        Ok((x, y))
    }
}

pub struct DesktopCapture {
    pub captured: Captured,
    pub bounds: ScreenBounds,
}

/// カーソルのあるモニター全体を撮る。
pub fn monitor_at(x: i32, y: i32) -> AppResult<Captured> {
    let monitor = Monitor::from_point(x, y)?;
    Ok(Captured {
        image: make_opaque(monitor.capture_image()?),
        monitor: MonitorGeometry::of(&monitor)?,
    })
}

/// 全モニターを物理座標どおりに合成する。ビューアはカーソルのあるモニターに開く。
pub fn desktop_at(x: i32, y: i32) -> AppResult<DesktopCapture> {
    let monitor = MonitorGeometry::of(&Monitor::from_point(x, y)?)?;
    let screens = Monitor::all()?
        .iter()
        .map(|screen| {
            Ok((
                (screen.x()?, screen.y()?),
                make_opaque(screen.capture_image()?),
            ))
        })
        .collect::<AppResult<Vec<_>>>()?;
    let (image, bounds) = compose_desktop(&screens)?;
    Ok(DesktopCapture {
        captured: Captured { image, monitor },
        bounds,
    })
}

fn compose_desktop(screens: &[((i32, i32), RgbaImage)]) -> AppResult<(RgbaImage, ScreenBounds)> {
    let bounds = ScreenBounds::covering(
        screens
            .iter()
            .map(|((x, y), image)| (*x, *y, image.width(), image.height())),
    )?;
    // 配置に隙間がある部分も、保存・コピー時に透明にならないよう黒で埋める。
    let mut image = RgbaImage::from_pixel(bounds.width, bounds.height, image::Rgba([0, 0, 0, 255]));
    for ((x, y), screen) in screens {
        image::imageops::replace(
            &mut image,
            screen,
            i64::from(*x) - i64::from(bounds.x),
            i64::from(*y) - i64::from(bounds.y),
        );
    }
    Ok((image, bounds))
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

    #[test]
    fn composes_monitors_with_negative_origins_and_gaps() {
        let red = Rgba([255, 0, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);
        let (image, bounds) = compose_desktop(&[
            ((-2, -1), RgbaImage::from_pixel(2, 2, red)),
            ((0, 0), RgbaImage::from_pixel(3, 1, blue)),
        ])
        .unwrap();
        assert_eq!(
            bounds,
            ScreenBounds {
                x: -2,
                y: -1,
                width: 5,
                height: 2
            }
        );
        assert_eq!(image.dimensions(), (5, 2));
        assert_eq!(*image.get_pixel(0, 0), red);
        assert_eq!(*image.get_pixel(1, 1), red);
        assert_eq!(*image.get_pixel(2, 0), Rgba([0, 0, 0, 255]));
        assert_eq!(*image.get_pixel(4, 1), blue);
        let selected = crate::imaging::crop(&image, 1, 1, 3, 1).unwrap();
        assert_eq!(bounds.selection_origin(1, 1).unwrap(), (-1, 0));
        assert_eq!(*selected.get_pixel(0, 0), red);
        assert_eq!(*selected.get_pixel(2, 0), blue);
    }

    #[test]
    fn rejects_desktop_without_monitors() {
        assert!(compose_desktop(&[]).is_err());
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

    #[test]
    #[ignore = "needs a real desktop session"]
    fn captures_all_monitors_at_their_physical_positions() {
        let monitors = Monitor::all().unwrap();
        let geometries: Vec<_> = monitors
            .iter()
            .map(|monitor| MonitorGeometry::of(monitor).unwrap())
            .collect();
        let left = geometries.iter().map(|monitor| monitor.x).min().unwrap();
        let top = geometries.iter().map(|monitor| monitor.y).min().unwrap();
        let right = geometries
            .iter()
            .map(|monitor| i64::from(monitor.x) + i64::from(monitor.width))
            .max()
            .unwrap();
        let bottom = geometries
            .iter()
            .map(|monitor| i64::from(monitor.y) + i64::from(monitor.height))
            .max()
            .unwrap();
        let desktop = desktop_at(0, 0).unwrap();
        assert_eq!((desktop.bounds.x, desktop.bounds.y), (left, top));
        let captured = desktop.captured;
        assert_eq!(
            captured.image.dimensions(),
            (
                (right - i64::from(left)) as u32,
                (bottom - i64::from(top)) as u32
            )
        );
        assert!(captured.image.pixels().all(|pixel| pixel.0[3] == 255));
    }

    #[test]
    fn desktop_bounds_include_different_monitor_sizes_and_vertical_offsets() {
        let bounds = ScreenBounds::covering([
            (-2560, -400, 2560, 1440),
            (0, 0, 1920, 1080),
            (1920, 200, 3840, 2160),
        ])
        .unwrap();
        assert_eq!(
            bounds,
            ScreenBounds {
                x: -2560,
                y: -400,
                width: 8320,
                height: 2760
            }
        );
        assert_eq!(bounds.selection_origin(2560, 400).unwrap(), (0, 0));
        assert!(ScreenBounds::covering([(i32::MIN, 0, 1, 1), (i32::MAX, 0, 1, 1)]).is_err());
    }
}
