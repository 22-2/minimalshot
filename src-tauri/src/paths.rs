use std::path::{Path, PathBuf};

use chrono::{DateTime, TimeZone};

use crate::error::{AppError, AppResult};

pub const APP_NAME: &str = "MinimaShot";

/// `{pictures}` と `{appname}` を展開した保存先ディレクトリに、日付書式で作ったファイル名を連結する。
pub fn render_save_path<Tz: TimeZone>(
    directory: &str,
    format: &str,
    pictures: &Path,
    now: &DateTime<Tz>,
) -> AppResult<PathBuf>
where
    Tz::Offset: std::fmt::Display,
{
    let dir = directory
        .replace("{pictures}", &pictures.to_string_lossy())
        .replace("{appname}", APP_NAME);
    let relative = format_date(format, now)?;
    if relative.trim().is_empty() {
        return Err(AppError::msg("保存ファイル名の書式が空です"));
    }
    Ok(PathBuf::from(dir).join(relative))
}

fn format_date<Tz: TimeZone>(format: &str, now: &DateTime<Tz>) -> AppResult<String>
where
    Tz::Offset: std::fmt::Display,
{
    use std::fmt::Write;
    let mut out = String::new();
    // 不正な書式は Display 時にエラーになるので、panic させずに設定エラーとして返す
    write!(out, "{}", now.format(format))
        .map_err(|_| AppError::msg(format!("日付書式が不正です: {format}")))?;
    Ok(out)
}

/// 同名ファイルが既にある場合は `_1`, `_2` … を付けて上書きを避ける。
pub fn avoid_collision(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    (1..)
        .map(|n| path.with_file_name(format!("{stem}_{n}{ext}")))
        .find(|candidate| !candidate.exists())
        .expect("unbounded iterator always yields")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, TimeZone};

    fn sample_time() -> DateTime<FixedOffset> {
        FixedOffset::east_opt(9 * 3600)
            .unwrap()
            .with_ymd_and_hms(2026, 10, 9, 12, 34, 56)
            .unwrap()
    }

    #[test]
    fn renders_default_layout() {
        let path = render_save_path(
            "{pictures}/{appname}",
            "%Y-%m/%Y-%m-%d_%H-%M-%S.png",
            Path::new("/home/me/Pictures"),
            &sample_time(),
        )
        .unwrap();
        assert_eq!(
            path,
            PathBuf::from("/home/me/Pictures/MinimaShot/2026-10/2026-10-09_12-34-56.png")
        );
    }

    #[test]
    fn rejects_invalid_format() {
        let result = render_save_path("/tmp", "%Q.png", Path::new("/p"), &sample_time());
        assert!(result.is_err());
    }

    #[test]
    fn rejects_empty_format() {
        assert!(render_save_path("/tmp", "", Path::new("/p"), &sample_time()).is_err());
    }

    #[test]
    fn appends_suffix_on_collision() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("shot.png");
        std::fs::write(&first, b"x").unwrap();
        std::fs::write(dir.path().join("shot_1.png"), b"x").unwrap();
        assert_eq!(avoid_collision(first), dir.path().join("shot_2.png"));
    }
}
