use std::path::Path;

use crate::error::{AppError, AppResult};

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
pub fn expand(arg: &str, file: &Path) -> String {
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
}

pub fn build_args(template: &str, file: &Path) -> AppResult<Vec<String>> {
    Ok(split_args(template)?
        .iter()
        .map(|arg| expand(arg, file))
        .collect())
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
        let file = Path::new("/My Pictures/MinimaShot/shot 1.png");
        let args = build_args(
            r#""${file}" ${fileDirname} ${fileBasename} ${fileBasenameNoExtension}${fileExtname}"#,
            file,
        )
        .unwrap();
        assert_eq!(
            args,
            [
                "/My Pictures/MinimaShot/shot 1.png",
                "/My Pictures/MinimaShot",
                "shot 1.png",
                "shot 1.png",
            ]
        );
    }
}
