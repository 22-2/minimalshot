//! 領域選択の描画を止めずに、画面からだけ隠す。
use tauri::WebviewWindow;

use crate::error::AppResult;

#[cfg(windows)]
mod platform {
    use super::*;
    use crate::error::AppError;
    use std::ffi::c_void;
    use std::sync::atomic::Ordering;
    use tauri::Manager;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetForegroundWindow() -> *mut c_void;
        fn SetForegroundWindow(window: *mut c_void) -> i32;
    }

    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmSetWindowAttribute(
            window: *mut c_void,
            attribute: u32,
            value: *const c_void,
            size: u32,
        ) -> i32;
    }

    fn cloak(window: &WebviewWindow, hidden: bool) -> AppResult<()> {
        let value = i32::from(hidden);
        // DWMWA_CLOAK: ユーザーには見えないまま DWM の合成対象に残す。
        let result = unsafe {
            DwmSetWindowAttribute(window.hwnd()?.0, 13, (&value as *const i32).cast(), 4)
        };
        if result < 0 {
            return Err(AppError::msg(format!(
                "領域選択の表示切替に失敗しました: {result:#x}"
            )));
        }
        Ok(())
    }

    pub fn hide(window: &WebviewWindow) -> AppResult<()> {
        cloak(window, true)?;
        window.set_focusable(false)?;
        // cloak は通常の hide と違ってアクティブ窓を切り替えない。
        // 見えない領域選択にキー入力が残らないよう、撮影前の窓へ戻す。
        if unsafe { GetForegroundWindow() } == window.hwnd()?.0 {
            let previous = window
                .state::<crate::state::AppState>()
                .region_previous_foreground
                .swap(0, Ordering::Relaxed);
            if previous != 0 {
                unsafe {
                    SetForegroundWindow(previous as *mut c_void);
                }
            }
        }
        Ok(())
    }

    pub fn show(window: &WebviewWindow) -> AppResult<()> {
        let foreground = unsafe { GetForegroundWindow() };
        if foreground != window.hwnd()?.0 {
            window
                .state::<crate::state::AppState>()
                .region_previous_foreground
                .store(foreground as isize, Ordering::Relaxed);
        }
        window.set_focusable(true)?;
        cloak(window, false)?;
        window.set_focus()?;
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    pub fn hide(window: &WebviewWindow) -> AppResult<()> {
        window.hide()?;
        Ok(())
    }

    pub fn show(window: &WebviewWindow) -> AppResult<()> {
        window.show()?;
        window.set_focus()?;
        Ok(())
    }
}

pub use platform::{hide, show};

pub fn prepare(window: &WebviewWindow) -> AppResult<()> {
    hide(window)?;
    // 通常の hide では WebView2 の初回描画が最初の撮影まで延期される。
    // cloak を先に設定するので、show による起動時のちらつきは発生しない。
    #[cfg(windows)]
    window.show()?;
    Ok(())
}
