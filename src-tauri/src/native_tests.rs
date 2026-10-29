//! Vite と実際の WebView2 を使う検証。ユーザーの設定・ホットキー・クリップボードは使わない。
mod overlay_flicker;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{Manager, State, WebviewWindow};

use crate::capture::{Captured, MonitorGeometry, ScreenBounds};
use crate::config::{AutoCopy, Config};
use crate::state::AppState;
use crate::{actions, commands, windows};

// tauri-build のマニフェストを lib のテスト exe にも取り込む。
// Common Controls v6 が無いと TaskDialogIndirect の解決前に起動が失敗する。
#[link(name = "resource", kind = "static")]
unsafe extern "C" {}

static STARTUP_SHOWS: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[repr(C)]
#[derive(Default)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn SetWinEventHook(
        min: u32,
        max: u32,
        module: isize,
        callback: unsafe extern "system" fn(isize, u32, isize, i32, i32, u32, u32),
        process: u32,
        thread: u32,
        flags: u32,
    ) -> isize;
    fn UnhookWinEvent(hook: isize) -> i32;
    fn GetAncestor(window: isize, flags: u32) -> isize;
    fn GetWindowRect(window: isize, rect: *mut Rect) -> i32;
    fn GetClassNameW(window: isize, name: *mut u16, length: i32) -> i32;
    fn GetForegroundWindow() -> *mut std::ffi::c_void;
    fn GetDpiForWindow(window: *mut std::ffi::c_void) -> u32;
    fn SendMessageW(
        window: *mut std::ffi::c_void,
        message: u32,
        wparam: usize,
        lparam: isize,
    ) -> isize;
}

#[link(name = "dwmapi")]
unsafe extern "system" {
    fn DwmGetWindowAttribute(window: isize, attribute: u32, value: *mut u32, size: u32) -> i32;
}

fn is_cloaked(window: isize) -> bool {
    let mut cloaked = 0;
    let result = unsafe { DwmGetWindowAttribute(window, 14, &mut cloaked, 4) };
    result >= 0 && cloaked != 0
}

unsafe extern "system" fn on_show(
    _: isize,
    _: u32,
    window: isize,
    object: i32,
    child: i32,
    _: u32,
    _: u32,
) {
    // 子要素のアクセシビリティイベントや0サイズの内部窓は表示として数えない。
    if object != 0 || child != 0 || unsafe { GetAncestor(window, 2) } != window {
        return;
    }
    if is_cloaked(window) {
        return;
    }
    let mut rect = Rect::default();
    unsafe {
        GetWindowRect(window, &mut rect);
    }
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return;
    }
    let mut class = [0; 128];
    let length = unsafe { GetClassNameW(window, class.as_mut_ptr(), class.len() as i32) };
    STARTUP_SHOWS.lock().unwrap().push(format!(
        "{} at ({}, {}) {}x{}",
        String::from_utf16_lossy(&class[..length.max(0) as usize]),
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top
    ));
}

struct ShowHook(isize);

impl Drop for ShowHook {
    fn drop(&mut self) {
        unsafe {
            UnhookWinEvent(self.0);
        }
    }
}

#[derive(Default)]
struct FrontendState {
    ready: Mutex<HashSet<String>>,
    shown: Mutex<HashSet<String>>,
    region_shows: Mutex<Vec<u32>>,
    region_started: Mutex<Option<Instant>>,
    region_frames: Mutex<Vec<u32>>,
}

#[tauri::command]
fn region_frame(app: tauri::AppHandle, session: u32) {
    let frontend = app.state::<Arc<FrontendState>>();
    eprintln!(
        "region {session}: two animation frames at {:?}",
        frontend.region_started.lock().unwrap().unwrap().elapsed()
    );
    frontend.region_frames.lock().unwrap().push(session);
}

#[tauri::command]
async fn region_png(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    session: u32,
) -> crate::error::AppResult<tauri::ipc::Response> {
    let frontend = app.state::<Arc<FrontendState>>();
    let started = Instant::now();
    eprintln!(
        "region {session}: PNG requested at {:?}",
        frontend.region_started.lock().unwrap().unwrap().elapsed()
    );
    let response = commands::region_png(state, session).await;
    eprintln!("region {session}: PNG encoded in {:?}", started.elapsed());
    response
}

#[tauri::command]
fn viewer_session(window: WebviewWindow, state: State<'_, AppState>) -> Option<u32> {
    window
        .state::<Arc<FrontendState>>()
        .ready
        .lock()
        .unwrap()
        .insert(window.label().to_owned());
    commands::viewer_session(window, state)
}

#[tauri::command]
fn region_session(window: WebviewWindow, state: State<'_, AppState>) -> Option<u32> {
    window
        .state::<Arc<FrontendState>>()
        .ready
        .lock()
        .unwrap()
        .insert(window.label().to_owned());
    commands::region_session(state)
}

#[tauri::command]
fn show_window(
    window: WebviewWindow,
    state: State<'_, AppState>,
    session: Option<u32>,
) -> crate::error::AppResult<()> {
    commands::show_window(window.clone(), state, session)?;
    if window.is_visible()? && !is_cloaked(window.hwnd()?.0 as isize) {
        if window.label() == windows::REGION_LABEL {
            let frontend = window.state::<Arc<FrontendState>>();
            eprintln!(
                "region {session:?}: shown at {:?}",
                frontend.region_started.lock().unwrap().unwrap().elapsed()
            );
            frontend.region_shows.lock().unwrap().push(session.unwrap());
            window.eval(format!("requestAnimationFrame(() => requestAnimationFrame(() => window.__TAURI_INTERNALS__.invoke('region_frame', {{session: {}}})))", session.unwrap()))?;
            return Ok(());
        }
        window
            .state::<Arc<FrontendState>>()
            .shown
            .lock()
            .unwrap()
            .insert(window.label().to_owned());
    }
    Ok(())
}

fn wait_for(description: &str, condition: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while !condition() {
        assert!(Instant::now() < deadline, "timed out: {description}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
#[ignore = "needs Windows desktop and pnpm dev on localhost:1420; opens region overlays and synthetic image windows"]
fn prewarmed_windows_display_captures_before_auto_save() {
    STARTUP_SHOWS.lock().unwrap().clear();
    // 自プロセスの EVENT_OBJECT_SHOW を起動前から監視し、一瞬だけ出る窓も検出する。
    let hook =
        ShowHook(unsafe { SetWinEventHook(0x8002, 0x8002, 0, on_show, std::process::id(), 0, 0) });
    assert_ne!(hook.0, 0);
    let directory = tempfile::tempdir().unwrap();
    let frontend = Arc::new(FrontendState::default());
    let mut config = Config::default();
    config.capture.auto_copy = AutoCopy::None;
    config.capture.auto_save = true;
    config.storage.directory = directory.path().to_string_lossy().into_owned();
    config.storage.format = "shot.png".into();
    let mut context = tauri::generate_context!();
    // 起動済みの MinimalShot の WebView データにも触れない。
    context.config_mut().identifier = format!("dev.minimalshot.native-test-{}", std::process::id());
    let app = tauri::Builder::default()
        .any_thread()
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            crate::setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<AppState>();
                crate::release_capture_preview(&state, window.label());
                let id = state.viewers.lock().unwrap().remove(window.label());
                if let Some(id) = id {
                    state.shots.remove(id);
                }
            }
        })
        .manage(frontend.clone())
        .manage(AppState::new(config, directory.path().join("config.toml")))
        .invoke_handler(tauri::generate_handler![
            viewer_session,
            region_session,
            show_window,
            commands::get_config,
            commands::take_capture_sounds,
            commands::prepare_region,
            commands::shot_info,
            commands::shot_png,
            commands::capture_preview_png,
            commands::show_capture_preview,
            commands::open_capture_preview,
            region_png,
            region_frame,
        ])
        .build(context)
        .unwrap();
    let handle = app.handle().clone();
    let worker = std::thread::spawn(move || {
        // 途中の assert 失敗でもテスト用イベントループを終了する。
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let foreground = unsafe { GetForegroundWindow() };
            windows::prepare_region(&handle).unwrap();
            windows::prepare_viewer(&handle).unwrap();
            wait_for("prewarmed frontends", || {
                frontend.ready.lock().unwrap().len() >= 2
            });
            assert!(handle
                .webview_windows()
                .values()
                .all(|window| !window.is_visible().unwrap()
                    || is_cloaked(window.hwnd().unwrap().0 as isize)));
            assert_eq!(
                unsafe { GetForegroundWindow() },
                foreground,
                "preparation stole focus"
            );
            assert!(frontend.shown.lock().unwrap().is_empty());
            let startup = STARTUP_SHOWS.lock().unwrap().clone();
            assert!(startup.is_empty(), "unexpected startup window: {startup:?}");
            let monitor = handle.primary_monitor().unwrap().unwrap();
            let geometry = MonitorGeometry {
                x: monitor.position().x,
                y: monitor.position().y,
                width: monitor.size().width,
                height: monitor.size().height,
                scale: monitor.scale_factor(),
            };
            let state = handle.state::<AppState>();
            let region = handle.get_webview_window(windows::REGION_LABEL).unwrap();
            let region_handle = region.hwnd().unwrap();
            for count in 1..=2 {
                *frontend.region_started.lock().unwrap() = Some(Instant::now());
                actions::start_capture(&handle, crate::state::CaptureKind::Region).unwrap();
                eprintln!(
                    "region {count}: capture and configure returned at {:?}",
                    frontend.region_started.lock().unwrap().unwrap().elapsed()
                );
                wait_for("region presentation", || {
                    frontend.region_shows.lock().unwrap().len() == count
                });
                wait_for("region frames", || {
                    frontend.region_frames.lock().unwrap().len() == count
                });
                assert_eq!(region.hwnd().unwrap(), region_handle);
                let bounds = state
                    .pending_region
                    .lock()
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .bounds;
                assert_eq!(
                    region.outer_position().unwrap(),
                    tauri::PhysicalPosition::new(bounds.x, bounds.y)
                );
                assert_eq!(
                    region.inner_size().unwrap(),
                    tauri::PhysicalSize::new(bounds.width, bounds.height)
                );
                // DPI 変更時に1画面内の推奨矩形が来ても、全画面の配置を維持する。
                let dpi = unsafe { GetDpiForWindow(region_handle.0) };
                let changed_dpi = if dpi == 96 { 144 } else { 96 };
                for next_dpi in [changed_dpi, dpi] {
                    let mut suggested = Rect {
                        left: geometry.x,
                        top: geometry.y,
                        right: geometry.x + geometry.width as i32 / 2,
                        bottom: geometry.y + geometry.height as i32 / 2,
                    };
                    unsafe {
                        SendMessageW(
                            region_handle.0,
                            0x02e0, // WM_DPICHANGED
                            (next_dpi | (next_dpi << 16)) as usize,
                            (&mut suggested as *mut Rect) as isize,
                        );
                    }
                    assert_eq!(
                        region.outer_position().unwrap(),
                        tauri::PhysicalPosition::new(bounds.x, bounds.y),
                        "DPI change moved the overlay onto one monitor"
                    );
                    assert_eq!(
                        region.inner_size().unwrap(),
                        tauri::PhysicalSize::new(bounds.width, bounds.height),
                        "DPI change compressed the desktop image"
                    );
                }
                let monitors = handle.available_monitors().unwrap();
                for monitor in monitors {
                    assert!(monitor.position().x >= bounds.x && monitor.position().y >= bounds.y);
                    assert!(
                        i64::from(monitor.position().x) + i64::from(monitor.size().width)
                            <= i64::from(bounds.x) + i64::from(bounds.width)
                    );
                    assert!(
                        i64::from(monitor.position().y) + i64::from(monitor.size().height)
                            <= i64::from(bounds.y) + i64::from(bounds.height)
                    );
                }
                commands::cancel_region(region.clone(), handle.state()).unwrap();
                assert!(is_cloaked(region_handle.0 as isize));
                assert_ne!(
                    unsafe { GetForegroundWindow() },
                    region_handle.0,
                    "cancel left the invisible region focused"
                );
                if count == 1 {
                    // 画面構成が変わった後も同じ窓を使い回し、次の撮影で配置を更新できる。
                    let changed_bounds = ScreenBounds {
                        x: -640,
                        y: -360,
                        width: 640,
                        height: 360,
                    };
                    crate::region_window::set_bounds(&region, &changed_bounds).unwrap();
                    assert_eq!(
                        region.outer_position().unwrap(),
                        tauri::PhysicalPosition::new(-640, -360)
                    );
                    assert_eq!(
                        region.inner_size().unwrap(),
                        tauri::PhysicalSize::new(640, 360)
                    );
                    assert!(is_cloaked(region_handle.0 as isize));
                }
            }
            // 保存先を意図的に待たせても、2枚とも先に表示できることを確認する。
            let saving = state.save_lock.lock().unwrap();
            for count in 1..=2 {
                wait_for("next spare frontend", || {
                    handle.webview_windows().iter().any(|(label, window)| {
                        let unassigned = state.viewers.lock().unwrap().shot_id(label).is_none();
                        label.starts_with(windows::VIEWER_PREFIX)
                            && unassigned
                            && !window.is_visible().unwrap()
                            && frontend.ready.lock().unwrap().contains(label)
                    })
                });
                let started = Instant::now();
                actions::finish_capture(
                    &handle,
                    Captured {
                        image: image::RgbaImage::from_pixel(
                            640,
                            360,
                            image::Rgba([40 * count as u8, 90, 130, 255]),
                        ),
                        monitor: geometry,
                    },
                    None,
                    crate::state::CaptureKind::Fullscreen,
                )
                .unwrap();
                wait_for("capture presentation", || {
                    frontend.shown.lock().unwrap().len() == count
                });
                eprintln!(
                    "prewarmed capture {count}: {:?} until show (WebView2)",
                    started.elapsed()
                );
                assert!(state
                    .shots
                    .with(count as u32, |shot| Ok(shot.saved_path.is_none()))
                    .unwrap());
            }
            drop(saving);
            wait_for("automatic saves", || {
                (1..=2).all(|id| {
                    state
                        .shots
                        .with(id, |shot| Ok(shot.saved_path.is_some()))
                        .unwrap()
                })
            });
            let first = state
                .shots
                .with(1, |shot| Ok(shot.saved_path.clone().unwrap()))
                .unwrap();
            let second = state
                .shots
                .with(2, |shot| Ok(shot.saved_path.clone().unwrap()))
                .unwrap();
            assert_ne!(first, second);
            assert!(first.is_file() && second.is_file());
            let imported = image::RgbaImage::from_pixel(32, 24, image::Rgba([10, 20, 30, 70]));
            actions::open_clipboard_image(&handle, imported.clone()).unwrap();
            wait_for("clipboard image presentation", || {
                frontend.shown.lock().unwrap().len() == 3
            });
            state
                .shots
                .with(3, |shot| {
                    assert_eq!(shot.image, imported);
                    assert!(
                        shot.saved_path.is_none(),
                        "clipboard import unexpectedly auto-saved"
                    );
                    Ok(())
                })
                .unwrap();
            let shown = frontend.shown.lock().unwrap().clone();
            state.config.lock().unwrap().capture.open_viewer = false;
            wait_for("spare after clipboard import", || {
                handle.webview_windows().iter().any(|(label, _)| {
                    label.starts_with(windows::VIEWER_PREFIX)
                        && state.viewers.lock().unwrap().shot_id(label).is_none()
                        && frontend.ready.lock().unwrap().contains(label)
                })
            });
            let windows_before = handle.webview_windows().len();
            let shots_before = state.shots.len();
            actions::finish_capture(
                &handle,
                Captured {
                    image: imported.clone(),
                    monitor: geometry,
                },
                None,
                crate::state::CaptureKind::Fullscreen,
            )
            .unwrap();
            assert_eq!(frontend.shown.lock().unwrap().len(), 3);
            assert_eq!(handle.webview_windows().len(), windows_before + 1);
            assert_eq!(state.shots.len(), shots_before + 1);
            assert!(state.pending_captures.lock().unwrap().is_empty());
            let preview = handle
                .get_webview_window(&format!("{}4", windows::PREVIEW_PREFIX))
                .unwrap();
            wait_for("capture preview is visible", || {
                preview.is_visible().unwrap_or(false)
            });
            let work = handle.primary_monitor().unwrap().unwrap();
            let work = work.work_area();
            let position = preview.outer_position().unwrap();
            let size = preview.outer_size().unwrap();
            assert!(position.x >= work.position.x && position.y >= work.position.y);
            assert!(
                i64::from(position.x) + i64::from(size.width)
                    <= i64::from(work.position.x) + i64::from(work.size.width)
            );
            assert!(
                i64::from(position.y) + i64::from(size.height)
                    <= i64::from(work.position.y) + i64::from(work.size.height)
            );
            preview
                .eval("document.querySelector('.capture-preview').click()")
                .unwrap();
            wait_for("preview opens its image", || {
                state.viewers.lock().unwrap().shot_id("viewer-4") == Some(4)
                    || handle
                        .webview_windows()
                        .keys()
                        .any(|label| state.viewers.lock().unwrap().shot_id(label) == Some(4))
            });
            let viewer = handle
                .webview_windows()
                .into_iter()
                .find(|(label, _)| state.viewers.lock().unwrap().shot_id(label) == Some(4))
                .unwrap()
                .1;
            wait_for("preview viewer is visible", || {
                viewer.is_visible().unwrap_or(false)
            });
            assert!(state
                .shots
                .with(4, |shot| Ok(shot.saved_path.is_some()))
                .unwrap());
            viewer.destroy().unwrap();
            wait_for("preview viewer releases its image", || {
                state.shots.len() == shots_before
            });
            let hidden_path = directory.path().join("shot_2.png");
            assert_eq!(image::open(&hidden_path).unwrap().into_rgba8(), imported);
            // 保存失敗時もプレビューは表示され、閉じたら画像を解放する。
            state.config.lock().unwrap().storage.directory = first.to_string_lossy().into_owned();
            assert!(actions::finish_capture(
                &handle,
                Captured {
                    image: imported,
                    monitor: geometry
                },
                None,
                crate::state::CaptureKind::Fullscreen,
            )
            .is_err());
            assert!(handle
                .get_webview_window(&format!("{}5", windows::PREVIEW_PREFIX))
                .is_some());
            windows::dismiss_capture_previews(&handle);
            wait_for("failed preview releases its image", || {
                state.shots.len() == shots_before
            });
            assert!(state.pending_captures.lock().unwrap().is_empty());
            for label in shown {
                handle
                    .get_webview_window(&label)
                    .unwrap()
                    .destroy()
                    .unwrap();
            }
        }));
        handle.exit(0);
        result
    });
    assert_eq!(app.run_return(|_, _| {}), 0);
    if let Err(error) = worker.join().unwrap() {
        std::panic::resume_unwind(error);
    }
}
