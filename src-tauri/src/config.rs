use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// アプリ設定。`config.toml` と1対1に対応し、そのままフロントエンドにも渡す。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Config {
    pub hotkeys: Hotkeys,
    pub capture: Capture,
    pub storage: Storage,
    pub viewer: Viewer,
    pub external: External,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Hotkeys {
    #[serde(deserialize_with = "one_or_many")]
    pub region: Vec<String>,
    #[serde(deserialize_with = "one_or_many")]
    pub window: Vec<String>,
    #[serde(deserialize_with = "one_or_many")]
    pub fullscreen: Vec<String>,
}

fn one_or_many<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Value {
        One(String),
        Many(Vec<String>),
    }
    Ok(match Value::deserialize(deserializer)? {
        Value::One(value) => vec![value],
        Value::Many(values) => values,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AutoCopy {
    None,
    #[default]
    Image,
    Path,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Capture {
    pub auto_save: bool,
    pub auto_copy: AutoCopy,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<CaptureOverride>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<CaptureOverride>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fullscreen: Option<CaptureOverride>,
}

/// モード別の指定項目だけを `[capture]` の既定値に上書きする。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct CaptureOverride {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_save: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_copy: Option<AutoCopy>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureActions {
    pub auto_save: bool,
    pub auto_copy: AutoCopy,
}

impl Capture {
    pub fn actions_for(&self, kind: crate::state::CaptureKind) -> CaptureActions {
        let override_ = match kind {
            crate::state::CaptureKind::Region => &self.region,
            crate::state::CaptureKind::Window => &self.window,
            crate::state::CaptureKind::Fullscreen => &self.fullscreen,
        };
        CaptureActions {
            auto_save: override_
                .as_ref()
                .and_then(|v| v.auto_save)
                .unwrap_or(self.auto_save),
            auto_copy: override_
                .as_ref()
                .and_then(|v| v.auto_copy)
                .unwrap_or(self.auto_copy),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Storage {
    pub directory: String,
    pub format: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Viewer {
    pub always_on_top: bool,
    pub confirm_on_close: bool,
    pub layout: ViewerLayout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ViewerLayout {
    #[default]
    Source,
    Framed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "ExternalFile")]
pub struct External {
    pub tools: Vec<ExternalTool>,
}

/// 「外部ツールで開く」に並ぶ1項目。`args` は `${file}` などの変数を含む1行の引数。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExternalTool {
    pub name: String,
    pub command: String,
    #[serde(default = "default_args")]
    pub args: String,
    /// CLI を起動したときに黒いコンソールウィンドウを出さない。
    #[serde(default)]
    pub hide_console: bool,
    /// 終了を待って標準出力をクリップボードへコピーする（OCR などの CLI 向け）。
    #[serde(default)]
    pub copy_stdout: bool,
}

fn default_args() -> String {
    "\"${file}\"".into()
}

/// 読み込み専用の形。0.0.3 までの `editor = "..."` も受け付け、ツール1件として扱う。
#[derive(Deserialize)]
struct ExternalFile {
    tools: Option<Vec<ExternalTool>>,
    editor: Option<String>,
}

impl From<ExternalFile> for External {
    fn from(file: ExternalFile) -> Self {
        if let Some(tools) = file.tools {
            return Self { tools };
        }
        match file.editor {
            Some(editor) if !editor.trim().is_empty() => Self {
                tools: vec![ExternalTool {
                    name: editor.clone(),
                    command: editor,
                    args: default_args(),
                    hide_console: false,
                    copy_stdout: false,
                }],
            },
            Some(_) => Self { tools: Vec::new() },
            None => Self::default(),
        }
    }
}

impl Default for Hotkeys {
    fn default() -> Self {
        // PrintScreen 単体は OS 標準の動作を残すため割り当てない
        Self {
            region: vec!["Ctrl+PrintScreen".into()],
            window: vec!["Alt+PrintScreen".into()],
            fullscreen: vec!["Shift+PrintScreen".into()],
        }
    }
}

impl Default for Storage {
    fn default() -> Self {
        Self {
            directory: "{pictures}/{appname}".into(),
            format: "%Y-%m/%Y-%m-%d_%H-%M-%S.png".into(),
        }
    }
}

impl Default for External {
    fn default() -> Self {
        Self {
            tools: vec![ExternalTool {
                name: "ペイント".into(),
                command: "mspaint.exe".into(),
                args: default_args(),
                hide_console: false,
                copy_stdout: false,
            }],
        }
    }
}

impl Config {
    pub fn parse(text: &str) -> AppResult<Self> {
        Ok(toml::from_str(text)?)
    }

    pub fn to_toml(&self) -> AppResult<String> {
        Ok(toml::to_string_pretty(self)?)
    }

    /// ファイルが無ければ既定値を書き出して返す。壊れたファイルは既定値で隠さずエラーにする。
    pub fn load_or_create(path: &Path) -> AppResult<Self> {
        if !path.exists() {
            let config = Self::default();
            config.save(path)?;
            return Ok(config);
        }
        Self::parse(&fs::read_to_string(path)?)
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, self.to_toml()?)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_reference_config() {
        let text = r#"
[hotkeys]
region = "Ctrl+PrintScreen"
window = "Alt+PrintScreen"
fullscreen = "Shift+PrintScreen"

[capture]
auto_save = false
auto_copy = "image"

[storage]
directory = "{pictures}/{appname}"
format = "%Y-%m/%Y-%m-%d_%H-%M-%S.png"

[viewer]
always_on_top = false
confirm_on_close = false

[[external.tools]]
name = "ペイント"
command = "mspaint.exe"
args = '"${file}"'
"#;
        assert_eq!(Config::parse(text).unwrap(), Config::default());
    }

    #[test]
    fn fills_missing_fields_with_defaults() {
        let config = Config::parse("[capture]\nauto_copy = \"path\"\n").unwrap();
        assert_eq!(config.capture.auto_copy, AutoCopy::Path);
        assert!(!config.capture.auto_save);
        assert_eq!(config.external, External::default());
        assert_eq!(config.viewer.layout, ViewerLayout::Source);
    }

    #[test]
    fn framed_viewer_layout_round_trips() {
        let config = Config::parse("[viewer]\nlayout = \"framed\"\n").unwrap();
        assert_eq!(config.viewer.layout, ViewerLayout::Framed);
        assert_eq!(Config::parse(&config.to_toml().unwrap()).unwrap(), config);
    }

    #[test]
    fn migrates_legacy_editor() {
        let config = Config::parse("[external]\neditor = \"C:/Tools/paint.net.exe\"\n").unwrap();
        assert_eq!(
            config.external.tools,
            [ExternalTool {
                name: "C:/Tools/paint.net.exe".into(),
                command: "C:/Tools/paint.net.exe".into(),
                args: "\"${file}\"".into(),
                hide_console: false,
                copy_stdout: false,
            }]
        );
    }

    #[test]
    fn reads_tool_output_options() {
        let text = r#"
[[external.tools]]
name = "OCR"
command = "tesseract.exe"
args = '"${file}" stdout -l jpn+eng'
hide_console = true
copy_stdout = true
"#;
        let tool = &Config::parse(text).unwrap().external.tools[0];
        assert!(tool.hide_console && tool.copy_stdout);
    }

    #[test]
    fn keeps_an_explicitly_empty_tool_list() {
        let config = Config::parse("[external]\ntools = []\n").unwrap();
        assert!(config.external.tools.is_empty());
    }

    #[test]
    fn mode_actions_inherit_only_unspecified_defaults() {
        // 0.0.9 までの auto_tools は読み飛ばし、保存し直すと消える
        let config = Config::parse(
            r#"
[capture]
auto_save = true
auto_copy = "image"
auto_tools = ["OCR"]
[capture.region]
auto_copy = "none"
auto_tools = []
"#,
        )
        .unwrap();
        let region = config
            .capture
            .actions_for(crate::state::CaptureKind::Region);
        assert!(region.auto_save);
        assert_eq!(region.auto_copy, AutoCopy::None);
        let window = config
            .capture
            .actions_for(crate::state::CaptureKind::Window);
        assert_eq!(window.auto_copy, AutoCopy::Image);
        assert_eq!(Config::parse(&config.to_toml().unwrap()).unwrap(), config);
    }

    #[test]
    fn legacy_single_hotkey_is_read_as_list() {
        let config = Config::parse("[hotkeys]\nregion = \"win+shift+z\"\n").unwrap();
        assert_eq!(config.hotkeys.region, ["win+shift+z"]);
        assert_eq!(Config::parse(&config.to_toml().unwrap()).unwrap(), config);
    }

    #[test]
    fn rejects_unknown_auto_copy() {
        assert!(Config::parse("[capture]\nauto_copy = \"both\"\n").is_err());
    }

    #[test]
    fn round_trips_through_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/config.toml");
        let created = Config::load_or_create(&path).unwrap();
        assert!(path.exists());

        let mut changed = created.clone();
        changed.capture.auto_save = true;
        changed.save(&path).unwrap();
        assert_eq!(Config::load_or_create(&path).unwrap(), changed);
    }
}
