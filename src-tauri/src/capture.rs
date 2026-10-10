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

/// 全モニターを物理座標どおりに合成する。ビューアはカーソルのあるモニターに開く。
pub fn desktop_at(x: i32, y: i32) -> AppResult<Captured> {
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
    Ok(Captured {
        image: compose_desktop(&screens)?,
        monitor,
    })
}

fn compose_desktop(screens: &[((i32, i32), RgbaImage)]) -> AppResult<RgbaImage> {
    let left = screens.iter().map(|((x, _), _)| i64::from(*x)).min();
    let top = screens.iter().map(|((_, y), _)| i64::from(*y)).min();
    let (Some(left), Some(top)) = (left, top) else {
        return Err(AppError::msg("ディスプレイが見つかりません"));
    };
    let right = screens
        .iter()
        .map(|((x, _), image)| i64::from(*x) + i64::from(image.width()))
        .max()
        .unwrap();
    let bottom = screens
        .iter()
        .map(|((_, y), image)| i64::from(*y) + i64::from(image.height()))
        .max()
        .unwrap();
    let width =
        u32::try_from(right - left).map_err(|_| AppError::msg("全画面の幅が大きすぎます"))?;
    let height =
        u32::try_from(bottom - top).map_err(|_| AppError::msg("全画面の高さが大きすぎます"))?;
    // 配置に隙間がある部分も、保存・コピー時に透明にならないよう黒で埋める。
    let mut image = RgbaImage::from_pixel(width, height, image::Rgba([0, 0, 0, 255]));
    for ((x, y), screen) in screens {
        image::imageops::replace(
            &mut image,
            screen,
            i64::from(*x) - left,
            i64::from(*y) - top,
        );
    }
    Ok(image)
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
        let image = compose_desktop(&[
            ((-2, -1), RgbaImage::from_pixel(2, 2, red)),
            ((0, 0), RgbaImage::from_pixel(3, 1, blue)),
        ])
        .unwrap();
        assert_eq!(image.dimensions(), (5, 2));
        assert_eq!(*image.get_pixel(0, 0), red);
        assert_eq!(*image.get_pixel(1, 1), red);
        assert_eq!(*image.get_pixel(2, 0), Rgba([0, 0, 0, 255]));
        assert_eq!(*image.get_pixel(4, 1), blue);
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
        let captured = desktop_at(0, 0).unwrap();
        assert_eq!(
            captured.image.dimensions(),
            (
                (right - i64::from(left)) as u32,
                (bottom - i64::from(top)) as u32
            )
        );
        assert!(captured.image.pixels().all(|pixel| pixel.0[3] == 255));
    }
}
