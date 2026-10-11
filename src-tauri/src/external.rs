use std::{fs, path::Path};

use crate::error::{AppError, AppResult};

/// 同梱した OCR スクリプトを設定フォルダへ配置する。利用者が編集した既存ファイルは残す。
pub fn prepare_ocr_script(config_dir: &Path) -> AppResult<()> {
    let path = config_dir.join("ocr.ps1");
    if path.exists() {
        return Ok(());
    }
    fs::create_dir_all(config_dir)?;
    // Windows 標準の PowerShell 5.1 でも日本語を読めるよう、UTF-8 BOM を付ける。
    fs::write(
        path,
        format!("\u{feff}{}", include_str!("../../assets/ocr.ps1")),
    )?;
    Ok(())
}

/// 引数テンプレートを、空白区切り・ダブルクォートでのまとまりを考慮して分割する。
/// 変数の展開は分割の後に行うので、空白を含むパスでも引数が割れない。
pub fn split_args(template: &str) -> AppResult<Vec<String>> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut has_token = false;
    for ch in template.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                has_token = true;
            }
            c if c.is_whitespace() && !in_quotes => {
                if has_token {
                    args.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            c => {
                current.push(c);
                has_token = true;
            }
        }
    }
    if in_quotes {
        return Err(AppError::msg(format!(
            "引数の引用符が閉じていません: {template}"
        )));
    }
    if has_token {
        args.push(current);
    }
    Ok(args)
}

/// VS Code のタスクと同じ名前の変数を展開する。
pub fn expand(arg: &str, file: &Path, config_dir: &Path) -> String {
    let text = |value: Option<&std::ffi::OsStr>| {
        value
            .map(|v| v.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    let ext = file
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    arg.replace("${fileBasenameNoExtension}", &text(file.file_stem()))
        .replace("${fileBasename}", &text(file.file_name()))
        .replace("${fileDirname}", &text(file.parent().map(Path::as_os_str)))
        .replace("${fileExtname}", &ext)
        .replace("${file}", &file.to_string_lossy())
        .replace("${configDirname}", &config_dir.to_string_lossy())
}

pub fn build_args(template: &str, file: &Path, config_dir: &Path) -> AppResult<Vec<String>> {
    Ok(split_args(template)?
        .iter()
        .map(|arg| expand(arg, file, config_dir))
        .collect())
}

/// CLI の標準出力をクリップボード用の文字列にする。多くの CLI は UTF-8 で出すので UTF-8 として読み、
/// 末尾の改行や Tesseract が付けるページ区切り（\x0c）は落とす。
pub fn stdout_text(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    text.trim_end_matches(['\r', '\n', '\x0c', ' '])
        .replace("\r\n", "\n")
        .replace('\n', "\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_respecting_quotes() {
        assert_eq!(
            split_args(r#"--open "${file}"  -x "" tail"#).unwrap(),
            ["--open", "${file}", "-x", "", "tail"]
        );
    }

    #[test]
    fn rejects_unclosed_quotes() {
        assert!(split_args(r#""${file}"#).is_err());
    }

    #[test]
    fn expands_all_variables_without_splitting_spaces() {
        let file = Path::new("/My Pictures/MinimalShot/shot 1.png");
        let args = build_args(
            r#""${file}" ${fileDirname} ${fileBasename} ${fileBasenameNoExtension}${fileExtname} "${configDirname}/ocr.ps1""#,
            file,
            Path::new("/My Settings/MinimalShot"),
        )
        .unwrap();
        assert_eq!(
            args,
            [
                "/My Pictures/MinimalShot/shot 1.png",
                "/My Pictures/MinimalShot",
                "shot 1.png",
                "shot 1.png",
                "/My Settings/MinimalShot/ocr.ps1",
            ]
        );
    }

    #[test]
    fn bundled_ocr_script_is_available_without_overwriting_customizations() {
        let dir = tempfile::tempdir().unwrap();
        let config_dir = dir.path().join("日本語 settings");
        prepare_ocr_script(&config_dir).unwrap();
        let path = config_dir.join("ocr.ps1");
        let script = fs::read_to_string(&path).unwrap();
        assert!(script.starts_with('\u{feff}'));
        assert!(script.contains("[int]$Scale = 3"));

        fs::write(&path, "custom script").unwrap();
        prepare_ocr_script(&config_dir).unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "custom script");
    }

    #[cfg(windows)]
    #[test]
    fn default_ocr_tool_resizes_input_and_cleans_up_its_temporary_image() {
        use std::os::windows::process::CommandExt;

        let dir = tempfile::tempdir().unwrap();
        let config_dir = dir.path().join("日本語 settings");
        prepare_ocr_script(&config_dir).unwrap();
        let file = dir.path().join("画像 space's $name.png");
        image::RgbaImage::from_pixel(2, 1, image::Rgba([0, 0, 0, 0]))
            .save(&file)
            .unwrap();
        let original = fs::read(&file).unwrap();
        // 認識エンジンだけ置き換え、既定の引数と同梱スクリプトを実際の PowerShell で通す。
        let recognizer = dir.path().join("fake tesseract.ps1");
        fs::write(
            &recognizer,
            r#"param([string]$ImagePath, [string]$OutputBase)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Bitmap]::new($ImagePath)
try {
    $result = "$($image.Width)x$($image.Height);$($image.GetPixel(0, 0).A);$args"
    [System.IO.File]::WriteAllText("$OutputBase.txt", $result)
    [System.IO.File]::WriteAllText("$OutputBase.input-path", $ImagePath)
} finally {
    $image.Dispose()
}
$global:LASTEXITCODE = 0
"#,
        )
        .unwrap();
        let tool = &crate::config::External::default().tools[1];
        let output = std::process::Command::new(&tool.command)
            .args(build_args(&tool.args, &file, &config_dir).unwrap())
            .arg("-TesseractPath")
            .arg(&recognizer)
            .arg("-NoOpen")
            .creation_flags(0x0800_0000)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            fs::read_to_string(file.with_extension("txt")).unwrap(),
            "6x3;255;-l jpn+eng --oem 1 --psm 3"
        );
        let temporary_image = fs::read_to_string(file.with_extension("input-path")).unwrap();
        assert!(!Path::new(&temporary_image).exists());
        assert_eq!(fs::read(file).unwrap(), original);
    }

    #[test]
    fn cleans_cli_output_for_the_clipboard() {
        let raw = "\u{feff}こんにちは\nworld\n\n\x0c".as_bytes();
        assert_eq!(stdout_text(raw), "こんにちは\r\nworld");
    }
}
