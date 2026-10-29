/// 画像を拡大せず、縦横比を保って指定した範囲に収める。
pub fn fit_image(size: (u32, u32), bounds: (u32, u32)) -> (u32, u32) {
    let (width, height) = (size.0.max(1), size.1.max(1));
    let (max_width, max_height) = (bounds.0.max(1), bounds.1.max(1));
    let scale = 1.0_f64
        .min(max_width as f64 / width as f64)
        .min(max_height as f64 / height as f64);
    (
        ((width as f64 * scale).round() as u32).clamp(1, max_width),
        ((height as f64 * scale).round() as u32).clamp(1, max_height),
    )
}

#[cfg(test)]
mod tests {
    use super::fit_image;

    #[test]
    fn keeps_small_images_at_original_size() {
        assert_eq!(fit_image((100, 100), (528, 360)), (100, 100));
        assert_eq!(fit_image((1, 20), (264, 180)), (1, 20));
    }

    #[test]
    fn fits_large_images_without_distorting_them() {
        assert_eq!(fit_image((1920, 1080), (528, 360)), (528, 297));
        assert_eq!(fit_image((500, 1000), (528, 360)), (180, 360));
        assert_eq!(fit_image((528, 297), (264, 180)), (264, 149));
    }
}
