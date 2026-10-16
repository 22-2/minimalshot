//! 領域選択の物理座標を固定し、描画を止めずに画面からだけ隠す。
use tauri::WebviewWindow;

use crate::capture::ScreenBounds;
use crate::error::AppResult;

#[cfg(windows)]
mod platform {
    use super::*;
    use crate::error::AppError;
    use std::ffi::c_void;
    use std::sync::atomic::Ordering;
    use tauri::Manager;

    const BOUNDS_SUBCLASS: usize = 1;
    const WM_WINDOWPOSCHANGING: u32 = 0x0046;
    const WM_NCDESTROY: u32 = 0x0082;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;

    #[repr(C)]
    struct WindowPosition {
        window: *mut c_void,
        insert_after: *mut c_void,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        flags: u32,
    }

    type SubclassProc =
        unsafe extern "system" fn(*mut c_void, u32, usize, isize, usize, usize) -> isize;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetForegroundWindow() -> *mut c_void;
        fn SetForegroundWindow(window: *mut c_void) -> i32;
        fn SetWindowPos(
            window: *mut c_void,
            insert_after: *mut c_void,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
    }

    #[link(name = "comctl32")]
    unsafe extern "system" {
        fn SetWindowSubclass(
            window: *mut c_void,
            proc: SubclassProc,
            id: usize,
            data: usize,
        ) -> i32;
        fn GetWindowSubclass(
            window: *mut c_void,
            proc: SubclassProc,
            id: usize,
            data: *mut usize,
        ) -> i32;
        fn RemoveWindowSubclass(window: *mut c_void, proc: SubclassProc, id: usize) -> i32;
        fn DefSubclassProc(
            window: *mut c_void,
            message: u32,
            wparam: usize,
            lparam: isize,
        ) -> isize;
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

    unsafe extern "system" fn keep_bounds(
        window: *mut c_void,
        message: u32,
        wparam: usize,
        lparam: isize,
        id: usize,
        data: usize,
    ) -> isize {
        match message {
            WM_WINDOWPOSCHANGING => {
                let bounds = unsafe { *(data as *const ScreenBounds) };
                let result = unsafe { DefSubclassProc(window, message, wparam, lparam) };
                let position = unsafe { &mut *(lparam as *mut WindowPosition) };
                // DPI 変更時の推奨矩形や OS のサイズ制限より、撮影画像の物理座標を優先する。
                if position.flags & SWP_NOMOVE == 0 {
                    position.x = bounds.x;
                    position.y = bounds.y;
                }
                if position.flags & SWP_NOSIZE == 0 {
                    position.width = bounds.width as i32;
                    position.height = bounds.height as i32;
                }
                result
            }
            WM_NCDESTROY => unsafe {
                RemoveWindowSubclass(window, keep_bounds, id);
                drop(Box::from_raw(data as *mut ScreenBounds));
                DefSubclassProc(window, message, wparam, lparam)
            },
            _ => unsafe { DefSubclassProc(window, message, wparam, lparam) },
        }
    }

    pub fn set_bounds(window: &WebviewWindow, bounds: &ScreenBounds) -> AppResult<()> {
        let bounds = *bounds;
        let target = window.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        // サブクラスとそのデータは窓を所有する UI スレッドだけで操作する。
        window.run_on_main_thread(move || {
            let result = (|| -> AppResult<()> {
                let handle = target.hwnd()?.0;
                let mut data = 0;
                if unsafe { GetWindowSubclass(handle, keep_bounds, BOUNDS_SUBCLASS, &mut data) }
                    != 0
                {
                    unsafe { *(data as *mut ScreenBounds) = bounds };
                } else {
                    let data = Box::into_raw(Box::new(bounds));
                    if unsafe {
                        SetWindowSubclass(handle, keep_bounds, BOUNDS_SUBCLASS, data as usize)
                    } == 0
                    {
                        unsafe { drop(Box::from_raw(data)) };
                        return Err(AppError::msg("領域選択の配置の固定に失敗しました"));
                    }
                }
                // 位置とサイズを1回の同期操作で確定させ、途中の DPI 変更と競合させない。
                if unsafe {
                    SetWindowPos(
                        handle,
                        std::ptr::null_mut(),
                        bounds.x,
                        bounds.y,
                        bounds.width as i32,
                        bounds.height as i32,
                        SWP_NOZORDER | SWP_NOACTIVATE,
                    )
                } == 0
                {
                    return Err(std::io::Error::last_os_error().into());
                }
                Ok(())
            })();
            let _ = sender.send(result);
        })?;
        receiver
            .recv()
            .map_err(|error| AppError::msg(error.to_string()))?
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

    pub fn set_bounds(window: &WebviewWindow, bounds: &ScreenBounds) -> AppResult<()> {
        window.set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))?;
        window.set_size(tauri::PhysicalSize::new(bounds.width, bounds.height))?;
        Ok(())
    }

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

pub use platform::{hide, set_bounds, show};

pub fn prepare(window: &WebviewWindow) -> AppResult<()> {
    hide(window)?;
    // 通常の hide では WebView2 の初回描画が最初の撮影まで延期される。
    // cloak を先に設定するので、show による起動時のちらつきは発生しない。
    #[cfg(windows)]
    window.show()?;
    Ok(())
}
