use std::path::PathBuf;
use std::sync::Mutex;

use tauri_plugin_global_shortcut::Shortcut;

use crate::capture::Captured;
use crate::config::Config;
use crate::store::ShotStore;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureKind {
    Region,
    Window,
    Fullscreen,
}

pub struct AppState {
    pub config: Mutex<Config>,
    pub config_path: PathBuf,
    pub shots: ShotStore,
    /// 領域選択中のモニター画像。選択が確定するまで保持する。
    pub pending_region: Mutex<Option<Captured>>,
    pub hotkeys: Mutex<Vec<(Shortcut, CaptureKind)>>,
}

impl AppState {
    pub fn new(config: Config, config_path: PathBuf) -> Self {
        Self {
            config: Mutex::new(config),
            config_path,
            shots: ShotStore::default(),
            pending_region: Mutex::new(None),
            hotkeys: Mutex::new(Vec::new()),
        }
    }

    pub fn config(&self) -> Config {
        self.config.lock().unwrap().clone()
    }
}
