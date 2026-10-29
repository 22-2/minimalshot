use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use tauri_plugin_global_shortcut::Shortcut;

use crate::capture::{Captured, MonitorGeometry, ScreenBounds};
use crate::config::{Config, ExternalTool};
use crate::editor_pool::EditorPool;
use crate::store::{Shot, ShotStore};
use crate::viewer_pool::ViewerPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureKind {
    Region,
    Window,
    Fullscreen,
    Desktop,
    Clipboard,
}

pub struct PendingRegion {
    pub id: u32,
    pub captured: Captured,
    pub bounds: ScreenBounds,
}

pub struct PendingCapture {
    pub config: Config,
    pub kind: CaptureKind,
    // ビューアをすぐ閉じても、表示後に開始した自動保存・コピーは完了させる。
    pub shot: Arc<Mutex<Shot>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerMenuState {
    pub saved: bool,
    pub pinned: bool,
    pub tools: Vec<ExternalTool>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerMenuLoad {
    pub request_id: u32,
    #[serde(flatten)]
    pub state: ViewerMenuState,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerMenuAction {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
}

/// 右クリックされたビューアと、メニューを出したカーソル位置（物理ピクセル）。
pub struct ViewerMenuRequest {
    pub parent: String,
    pub anchor: tauri::PhysicalPosition<f64>,
    pub load: ViewerMenuLoad,
}

#[derive(Clone)]
pub struct PreviewCapture {
    pub id: u32,
    pub monitor: MonitorGeometry,
    pub origin: Option<(i32, i32)>,
    pub ready: bool,
    pub thumbnail: image::RgbaImage,
}

pub struct AppState {
    pub capture_lock: Mutex<()>,
    pub config: Mutex<Config>,
    pub config_path: PathBuf,
    pub shots: ShotStore,
    pub viewers: Mutex<ViewerPool>,
    pub editors: Mutex<EditorPool>,
    pub region_window_lock: Mutex<()>,
    #[cfg(windows)]
    pub region_previous_foreground: std::sync::atomic::AtomicIsize,
    pub pending_captures: Mutex<HashMap<u32, PendingCapture>>,
    pub pending_capture_sounds: AtomicU32,
    pub previews: Mutex<HashMap<String, PreviewCapture>>,
    pub latest_preview_id: AtomicU32,
    pub save_lock: Mutex<()>,
    pub auto_copy_lock: Mutex<u32>,
    /// 領域選択中の全画面画像。選択が確定するまで保持する。
    pub pending_region: Mutex<Option<PendingRegion>>,
    next_region_id: AtomicU32,
    pub hotkeys: Mutex<Vec<(Shortcut, CaptureKind)>>,
    /// 別ウィンドウで表示中の右クリックメニュー。ウィンドウは1枚を使い回す。
    pub viewer_menu: Mutex<Option<ViewerMenuRequest>>,
    next_viewer_menu_id: AtomicU32,
    /// ビューアの大きさを覚えたが、まだ config.toml へ書いていない。
    pub viewer_size_dirty: AtomicBool,
}

impl AppState {
    pub fn new(config: Config, config_path: PathBuf) -> Self {
        Self {
            capture_lock: Mutex::new(()),
            config: Mutex::new(config),
            config_path,
            shots: ShotStore::default(),
            viewers: Mutex::new(ViewerPool::default()),
            editors: Mutex::new(EditorPool::default()),
            region_window_lock: Mutex::new(()),
            #[cfg(windows)]
            region_previous_foreground: std::sync::atomic::AtomicIsize::new(0),
            pending_captures: Mutex::new(HashMap::new()),
            pending_capture_sounds: AtomicU32::new(0),
            previews: Mutex::new(HashMap::new()),
            latest_preview_id: AtomicU32::new(0),
            save_lock: Mutex::new(()),
            auto_copy_lock: Mutex::new(0),
            pending_region: Mutex::new(None),
            next_region_id: AtomicU32::new(0),
            hotkeys: Mutex::new(Vec::new()),
            viewer_menu: Mutex::new(None),
            next_viewer_menu_id: AtomicU32::new(0),
            viewer_size_dirty: AtomicBool::new(false),
        }
    }

    pub fn config(&self) -> Config {
        self.config.lock().unwrap().clone()
    }

    pub fn next_region_id(&self) -> u32 {
        self.next_region_id.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn next_viewer_menu_id(&self) -> u32 {
        self.next_viewer_menu_id.fetch_add(1, Ordering::Relaxed) + 1
    }
}
