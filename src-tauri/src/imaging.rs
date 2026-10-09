use std::path::Path;

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ImageEncoder, ImageFormat, RgbaImage};

use crate::error::{AppError, AppResult};

/// プレビュー用。毎行すべてのフィルターを試す処理を省き、表示までの時間を短縮する。
/// 保存用の PNG と同じく可逆で、ピクセルは変わらない。
pub fn encode_png(image: &RgbaImage) -> AppResult<Vec<u8>> {
    let mut bytes = Vec::new();
    PngEncoder::new_with_quality(&mut bytes, CompressionType::Fast, FilterType::Sub)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )?;
    Ok(bytes)
}

pub fn write_png(image: &RgbaImage, path: &Path) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    image.save_with_format(path, ImageFormat::Png)?;
    Ok(())
}

/// 選択矩形を画像の範囲内に収めて切り出す。範囲外や大きさ0の矩形はエラーにする。
pub fn crop(image: &RgbaImage, x: u32, y: u32, width: u32, height: u32) -> AppResult<RgbaImage> {
    let right = x.saturating_add(width).min(image.width());
    let bottom = y.saturating_add(height).min(image.height());
    if x >= right || y >= bottom {
        return Err(AppError::msg("選択範囲が空です"));
    }
    Ok(image::imageops::crop_imm(image, x, y, right - x, bottom - y).to_image())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn crops_and_clamps_to_bounds() {
        let mut image = RgbaImage::new(10, 10);
        image.put_pixel(8, 8, Rgba([255, 0, 0, 255]));
        let cropped = crop(&image, 8, 8, 100, 100).unwrap();
        assert_eq!(cropped.dimensions(), (2, 2));
        assert_eq!(cropped.get_pixel(0, 0), &Rgba([255, 0, 0, 255]));
    }

    #[test]
    fn rejects_empty_selection() {
        let image = RgbaImage::new(10, 10);
        assert!(crop(&image, 3, 3, 0, 5).is_err());
        assert!(crop(&image, 20, 0, 5, 5).is_err());
    }

    #[test]
    fn png_round_trip() {
        let image = RgbaImage::from_pixel(3, 2, Rgba([1, 2, 3, 255]));
        let bytes = encode_png(&image).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(decoded, image);
    }
}
