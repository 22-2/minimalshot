//! Vite と実際の WebView2 を使う検証。ユーザーの設定・ホットキー・クリップボードは使わない。
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{Manager, State, WebviewWindow};

use crate::capture::{Captured, MonitorGeometry};
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
        .manage(frontend.clone())
        .manage(AppState::new(config, directory.path().join("config.toml")))
        .invoke_handler(tauri::generate_handler![
            viewer_session,
            region_session,
            show_window,
            commands::get_config,
            commands::prepare_region,
            commands::shot_info,
            commands::shot_png,
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
                commands::cancel_region(region.clone(), handle.state()).unwrap();
                assert!(is_cloaked(region_handle.0 as isize));
                assert_ne!(
                    unsafe { GetForegroundWindow() },
                    region_handle.0,
                    "cancel left the invisible region focused"
                );
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
            let shown = frontend.shown.lock().unwrap().clone();
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
