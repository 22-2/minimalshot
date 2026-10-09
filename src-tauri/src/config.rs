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
    pub region: String,
    pub window: String,
    pub fullscreen: String,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct External {
    pub editor: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        // PrintScreen 単体は OS 標準の動作を残すため割り当てない
        Self {
            region: "Ctrl+PrintScreen".into(),
            window: "Alt+PrintScreen".into(),
            fullscreen: "Shift+PrintScreen".into(),
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
            editor: "mspaint.exe".into(),
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

[external]
editor = "mspaint.exe"
"#;
        assert_eq!(Config::parse(text).unwrap(), Config::default());
    }

    #[test]
    fn fills_missing_fields_with_defaults() {
        let config = Config::parse("[capture]\nauto_copy = \"path\"\n").unwrap();
        assert_eq!(config.capture.auto_copy, AutoCopy::Path);
        assert!(!config.capture.auto_save);
        assert_eq!(config.external.editor, "mspaint.exe");
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
