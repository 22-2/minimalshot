mod actions;
mod capture;
mod commands;
mod config;
mod error;
mod external;
mod hotkeys;
mod i18n;
mod imaging;
mod paths;
mod region_window;
mod state;
mod store;
mod viewer_pool;
mod windows;

#[cfg(all(test, windows, feature = "native-ui-test"))]
mod native_tests;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

use crate::config::Config;
use crate::i18n::t;
use crate::state::{AppState, CaptureKind};

fn report(result: error::AppResult<()>) {
    // 常駐アプリなので、失敗してもプロセスは落とさずログに残す
    if let Err(err) = result {
        eprintln!("[{}] {err}", paths::APP_NAME);
    }
}

fn capture_in_background(app: &AppHandle, kind: CaptureKind) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || report(actions::start_capture(&app, kind)));
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let region = MenuItem::with_id(app, "region", t("tray.region"), true, None::<&str>)?;
    let window = MenuItem::with_id(app, "window", t("tray.window"), true, None::<&str>)?;
    let fullscreen =
        MenuItem::with_id(app, "fullscreen", t("tray.fullscreen"), true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", t("tray.settings"), true, None::<&str>)?;
    let config_folder = MenuItem::with_id(
        app,
        "config_folder",
        t("settings.openConfigFolder"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", t("tray.quit"), true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &region,
            &window,
            &fullscreen,
            &separator,
            &settings,
            &config_folder,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("bundle icon"))
        .tooltip(t("app.name"))
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "region" => capture_in_background(app, CaptureKind::Region),
            "window" => capture_in_background(app, CaptureKind::Window),
            "fullscreen" => capture_in_background(app, CaptureKind::Fullscreen),
            "settings" => report(windows::open_settings(app)),
            "config_folder" => report(actions::open_config_folder(app)),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            report(windows::open_settings(app));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if let Some(kind) = hotkeys::kind_for(app, shortcut) {
                        capture_in_background(app, kind);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("config.toml");
            let config = Config::load_or_create(&config_path)?;
            let hotkeys = config.hotkeys.clone();
            app.manage(AppState::new(config, config_path));
            setup_tray(app.handle())?;
            report(hotkeys::register(app.handle(), &hotkeys));
            let app = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                report(windows::prepare_region(&app));
                report(windows::prepare_viewer(&app));
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // 再表示のたびに WebView2 を起動し直さない。設定の未保存編集は次回 open で再読込する。
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == windows::SETTINGS_LABEL {
                    api.prevent_close();
                    report(window.hide().map_err(Into::into));
                } else if window.label() == windows::REGION_LABEL {
                    api.prevent_close();
                    window
                        .state::<AppState>()
                        .pending_region
                        .lock()
                        .unwrap()
                        .take();
                    if let Some(region) = window
                        .app_handle()
                        .get_webview_window(windows::REGION_LABEL)
                    {
                        report(region_window::hide(&region));
                    }
                    report(window.emit("region-reset", ()).map_err(Into::into));
                }
            }
            if !matches!(event, WindowEvent::Destroyed) {
                return;
            }
            if window.label() == windows::REGION_LABEL {
                window
                    .state::<AppState>()
                    .pending_region
                    .lock()
                    .unwrap()
                    .take();
            }
            let state = window.state::<AppState>();
            let id = state.viewers.lock().unwrap().remove(window.label());
            if let Some(id) = id {
                state.pending_captures.lock().unwrap().remove(&id);
                state.shots.remove(id);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::open_config_folder,
            commands::save_config,
            commands::capture,
            commands::shot_info,
            commands::viewer_session,
            commands::shot_png,
            commands::save_shot,
            commands::copy_shot_image,
            commands::copy_shot_path,
            commands::open_shot_with,
            commands::reveal_shot,
            commands::save_shot_as,
            commands::delete_saved_shot,
            commands::open_settings,
            commands::show_window,
            commands::region_session,
            commands::prepare_region,
            commands::region_png,
            commands::finish_region,
            commands::cancel_region,
        ])
        .build(tauri::generate_context!())
        .expect("error while building MinimalShot");

    app.run(|_app, event| {
        // ウィンドウを全部閉じてもトレイ常駐を続ける（明示的な終了だけ code が入る）
        if let RunEvent::ExitRequested {
            api, code: None, ..
        } = event
        {
            api.prevent_exit();
        }
    });
}

#[cfg(test)]
mod config_tests {
    /// CSP で IPC プロトコルを許可しないと postMessage に落ち、画像のバイナリが壊れて届く。
    #[test]
    fn csp_allows_ipc_protocol() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = conf["app"]["security"]["csp"].as_str().unwrap();
        assert!(
            csp.contains("connect-src ipc: http://ipc.localhost"),
            "{csp}"
        );
    }
}
