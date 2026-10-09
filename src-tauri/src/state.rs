use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use tauri_plugin_global_shortcut::Shortcut;

use crate::capture::Captured;
use crate::config::Config;
use crate::store::{Shot, ShotStore};
use crate::viewer_pool::ViewerPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureKind {
    Region,
    Window,
    Fullscreen,
}

pub struct PendingRegion {
    pub id: u32,
    pub captured: Captured,
}

pub struct PendingCapture {
    pub config: Config,
    // ビューアをすぐ閉じても、表示後に開始した自動保存・コピーは完了させる。
    pub shot: Arc<Mutex<Shot>>,
}

pub struct AppState {
    pub capture_lock: Mutex<()>,
    pub config: Mutex<Config>,
    pub config_path: PathBuf,
    pub shots: ShotStore,
    pub viewers: Mutex<ViewerPool>,
    pub region_window_lock: Mutex<()>,
    #[cfg(windows)]
    pub region_previous_foreground: std::sync::atomic::AtomicIsize,
    pub pending_captures: Mutex<HashMap<u32, PendingCapture>>,
    pub save_lock: Mutex<()>,
    pub auto_copy_lock: Mutex<u32>,
    /// 領域選択中のモニター画像。選択が確定するまで保持する。
    pub pending_region: Mutex<Option<PendingRegion>>,
    next_region_id: AtomicU32,
    pub hotkeys: Mutex<Vec<(Shortcut, CaptureKind)>>,
}

impl AppState {
    pub fn new(config: Config, config_path: PathBuf) -> Self {
        Self {
            capture_lock: Mutex::new(()),
            config: Mutex::new(config),
            config_path,
            shots: ShotStore::default(),
            viewers: Mutex::new(ViewerPool::default()),
            region_window_lock: Mutex::new(()),
            #[cfg(windows)]
            region_previous_foreground: std::sync::atomic::AtomicIsize::new(0),
            pending_captures: Mutex::new(HashMap::new()),
            save_lock: Mutex::new(()),
            auto_copy_lock: Mutex::new(0),
            pending_region: Mutex::new(None),
            next_region_id: AtomicU32::new(0),
            hotkeys: Mutex::new(Vec::new()),
        }
    }

    pub fn config(&self) -> Config {
        self.config.lock().unwrap().clone()
    }

    pub fn next_region_id(&self) -> u32 {
        self.next_region_id.fetch_add(1, Ordering::Relaxed) + 1
    }
}
