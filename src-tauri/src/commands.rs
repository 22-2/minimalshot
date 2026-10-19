use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::actions;
use crate::capture::{Captured, MonitorGeometry};
use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::hotkeys;
use crate::imaging;
use crate::state::{AppState, CaptureKind};
use crate::windows::{REGION_LABEL, VIEWER_PREFIX};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotInfo {
    id: u32,
    width: u32,
    height: u32,
    saved_path: Option<String>,
}

/// 予備の窓にもラベルがあるため、画像IDは割り当て表から取得する。
fn shot_id(window: &WebviewWindow) -> AppResult<u32> {
    window
        .state::<AppState>()
        .viewers
        .lock()
        .unwrap()
        .shot_id(window.label())
        .ok_or_else(|| AppError::msg("画像が割り当てられていません"))
}

#[tauri::command]
pub fn viewer_session(window: WebviewWindow, state: State<'_, AppState>) -> Option<u32> {
    state.viewers.lock().unwrap().shot_id(window.label())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSession {
    id: u32,
    width: u32,
    height: u32,
}

fn editor_shot_id(window: &WebviewWindow) -> AppResult<u32> {
    window
        .state::<AppState>()
        .editors
        .lock()
        .unwrap()
        .shot_id(window.label())
        .ok_or_else(|| AppError::msg("エディタに画像が割り当てられていません"))
}

#[tauri::command]
pub fn editor_session(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Option<EditorSession>> {
    let Some(id) = state.editors.lock().unwrap().shot_id(window.label()) else {
        return Ok(None);
    };
    state
        .shots
        .with(id, |shot| {
            Ok(EditorSession {
                id,
                width: shot.image.width(),
                height: shot.image.height(),
            })
        })
        .map(Some)
}

fn editor_monitor(app: &AppHandle, window: &WebviewWindow) -> AppResult<MonitorGeometry> {
    let monitor = window
        .current_monitor()?
        .or(app.primary_monitor()?)
        .ok_or_else(|| AppError::msg("ディスプレイが見つかりません"))?;
    Ok(MonitorGeometry {
        x: monitor.position().x,
        y: monitor.position().y,
        width: monitor.size().width,
        height: monitor.size().height,
        scale: monitor.scale_factor(),
    })
}

/// ビューアとは別の画像コピーを持たせ、ビューアを閉じても編集を続けられるようにする。
#[tauri::command]
pub async fn open_editor(app: AppHandle, window: WebviewWindow) -> AppResult<()> {
    let viewer_id = shot_id(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let image = state.shots.with(viewer_id, |shot| Ok(shot.image.clone()))?;
        let monitor = editor_monitor(&app, &window)?;
        let editor_id = state.shots.insert(image);
        if let Err(error) = crate::windows::open_editor(&app, editor_id, &monitor) {
            state.shots.remove(editor_id);
            return Err(error);
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Config {
    state.config()
}

#[tauri::command]
pub fn get_default_config() -> Config {
    Config::default()
}

#[tauri::command]
pub fn take_capture_sounds(state: State<'_, AppState>) -> u32 {
    state
        .pending_capture_sounds
        .swap(0, std::sync::atomic::Ordering::Relaxed)
}

#[tauri::command]
pub fn open_config_folder(app: AppHandle) -> AppResult<()> {
    actions::open_config_folder(&app)
}

#[tauri::command]
pub fn open_save_folder(app: AppHandle) -> AppResult<()> {
    actions::open_save_folder(&app)
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: Config) -> AppResult<()> {
    let state = app.state::<AppState>();
    // 先に全項目を検証し、不正な設定はファイルに書かない
    config.validate()?;
    let previous = state.config();
    let tools_changed = previous.external != config.external;
    let previous_hotkeys = previous.hotkeys;
    hotkeys::register(&app, &config.hotkeys)?;
    if let Err(error) = config.save(&state.config_path) {
        let _ = hotkeys::register(&app, &previous_hotkeys);
        return Err(error);
    }
    let tools = config.external.tools.clone();
    *state.config.lock().unwrap() = config;
    if tools_changed {
        app.emit("external-tools-changed", tools)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn export_config(
    app: AppHandle,
    window: WebviewWindow,
    config: Config,
) -> AppResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        config.validate()?;
        let Some(chosen) = app
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("MinimalShot 設定", &["toml"])
            .set_file_name("MinimalShot-settings.toml")
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let mut path = chosen
            .into_path()
            .map_err(|e| AppError::msg(e.to_string()))?;
        if path.extension().is_none() {
            path.set_extension("toml");
        }
        config.save(&path)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn import_config(app: AppHandle, window: WebviewWindow) -> AppResult<Option<Config>> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(chosen) = app
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("MinimalShot 設定", &["toml"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = chosen
            .into_path()
            .map_err(|e| AppError::msg(e.to_string()))?;
        let config = Config::read_import(&path)?;
        // ホットキー登録や書き込みが失敗した場合も、通常の保存と同じ扱いにする。
        save_config(app, config.clone())?;
        Ok(Some(config))
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn capture(app: AppHandle, kind: CaptureKind) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || actions::start_capture(&app, kind))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub fn shot_info(window: WebviewWindow, state: State<'_, AppState>) -> AppResult<ShotInfo> {
    let id = shot_id(&window)?;
    state.shots.with(id, |shot| {
        Ok(ShotInfo {
            id,
            width: shot.image.width(),
            height: shot.image.height(),
            saved_path: shot
                .saved_path
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
        })
    })
}

#[tauri::command]
pub async fn shot_png(window: WebviewWindow, state: State<'_, AppState>) -> AppResult<Response> {
    let id = shot_id(&window)?;
    let image = state.shots.with(id, |shot| Ok(shot.image.clone()))?;
    preview_png(image).await
}

#[tauri::command]
pub async fn editor_png(window: WebviewWindow, state: State<'_, AppState>) -> AppResult<Response> {
    let id = editor_shot_id(&window)?;
    let image = state.shots.with(id, |shot| Ok(shot.image.clone()))?;
    preview_png(image).await
}

async fn preview_png(image: image::RgbaImage) -> AppResult<Response> {
    // PNG 変換中にメインスレッドや ShotStore のロックを占有しない。
    let bytes = tauri::async_runtime::spawn_blocking(move || imaging::encode_png(&image))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn save_shot(app: AppHandle, window: WebviewWindow) -> AppResult<String> {
    let path = actions::save(&app, shot_id(&window)?)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn copy_shot_image(app: AppHandle, window: WebviewWindow) -> AppResult<()> {
    actions::copy_image(&app, shot_id(&window)?)
}

#[tauri::command]
pub fn copy_shot_path(app: AppHandle, window: WebviewWindow) -> AppResult<()> {
    actions::copy_path(&app, shot_id(&window)?)
}

/// 出力をコピーする CLI は終了まで待つので、UI を止めないよう別スレッドで動かす
#[tauri::command]
pub async fn open_shot_with(
    app: AppHandle,
    window: WebviewWindow,
    tool: usize,
) -> AppResult<actions::ToolOutcome> {
    let id = shot_id(&window)?;
    tauri::async_runtime::spawn_blocking(move || actions::open_with(&app, id, tool))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub fn reveal_shot(app: AppHandle, window: WebviewWindow) -> AppResult<()> {
    actions::reveal(&app, shot_id(&window)?)
}

/// ダイアログを待つ間に UI スレッドを塞がないよう async にする
#[tauri::command]
pub async fn save_shot_as(app: AppHandle, window: WebviewWindow) -> AppResult<Option<String>> {
    let path = actions::save_as(&app, shot_id(&window)?)?;
    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn delete_saved_shot(app: AppHandle, window: WebviewWindow) -> AppResult<()> {
    actions::delete_saved(&app, shot_id(&window)?)
}

/// ウィンドウを作るコマンドは必ず async にする。Windows では同期コマンドがメインスレッドで動き、
/// その中で WebView を作ると互いに待ち合って固まる（真っ白で閉じられないウィンドウになる）
#[tauri::command]
pub async fn open_settings(app: AppHandle) -> AppResult<()> {
    crate::windows::open_settings(&app)
}

#[tauri::command]
pub async fn open_about(app: AppHandle) -> AppResult<()> {
    crate::windows::open_about(&app)
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn region_session(state: State<'_, AppState>) -> Option<u32> {
    state
        .pending_region
        .lock()
        .unwrap()
        .as_ref()
        .map(|pending| pending.id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionPreparation {
    width: u32,
    height: u32,
    render_while_hidden: bool,
}

#[tauri::command]
pub async fn prepare_region(window: WebviewWindow) -> AppResult<RegionPreparation> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = window.state::<AppState>();
        // ページが窓の配置より先に起動しても、実寸が確定してから事前描画する。
        let _creation = state.region_window_lock.lock().unwrap();
        let size = window.inner_size()?;
        Ok(RegionPreparation {
            width: size.width,
            height: size.height,
            render_while_hidden: cfg!(windows),
        })
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn region_png(state: State<'_, AppState>, session: u32) -> AppResult<Response> {
    let image = {
        let pending = state.pending_region.lock().unwrap();
        let pending = pending
            .as_ref()
            .filter(|p| p.id == session)
            .ok_or_else(|| AppError::msg("領域選択中ではありません"))?;
        pending.captured.image.clone()
    };
    preview_png(image).await
}

/// フロントエンドの描画完了後に呼ぶ。中止済みの領域選択は遅れて完了しても出さない。
#[tauri::command]
pub fn show_window(
    window: WebviewWindow,
    state: State<'_, AppState>,
    session: Option<u32>,
) -> AppResult<()> {
    if window.label() == REGION_LABEL {
        let pending = state.pending_region.lock().unwrap();
        if pending.as_ref().map(|p| p.id) != session || session.is_none() {
            return Ok(());
        }
        crate::region_window::show(&window)?;
    } else if window.label().starts_with(crate::windows::EDITOR_PREFIX) {
        if state
            .editors
            .lock()
            .unwrap()
            .shot_id(window.label())
            .is_none()
        {
            return Ok(());
        }
        window.show()?;
        window.set_focus()?;
    } else if !window.is_visible()? {
        if window.label().starts_with(VIEWER_PREFIX)
            && state
                .viewers
                .lock()
                .unwrap()
                .shot_id(window.label())
                .is_none()
        {
            return Ok(());
        }
        if window.label().starts_with(VIEWER_PREFIX) {
            // 予備の間はタスクバーにも出さず、画像が準備できた窓だけ登録する。
            window.set_skip_taskbar(false)?;
        }
        window.show()?;
        window.set_focus()?;
        if window.label().starts_with(VIEWER_PREFIX) {
            let id = shot_id(&window)?;
            let pending = state.pending_captures.lock().unwrap().remove(&id);
            let app = window.app_handle().clone();
            let label = window.label().to_owned();
            if let Some(pending) = pending {
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = actions::complete_capture(&app, Some(&label), id, pending) {
                        eprintln!("[{}] {error}", crate::paths::APP_NAME);
                        if let Err(emit_error) =
                            app.emit_to(&label, "shot-error", error.to_string())
                        {
                            eprintln!("[{}] {emit_error}", crate::paths::APP_NAME);
                        }
                    }
                });
            }
            // 次の撮影用の WebView 作成を、今回の表示までの待ちに含めない。
            tauri::async_runtime::spawn_blocking(move || {
                crate::report(crate::windows::prepare_viewer(&app));
            });
        }
    }
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct Rect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[tauri::command]
pub async fn finish_region(
    app: AppHandle,
    window: WebviewWindow,
    rect: Rect,
    session: u32,
) -> AppResult<()> {
    let pending_region = {
        let state = app.state::<AppState>();
        let mut pending = state.pending_region.lock().unwrap();
        if pending.as_ref().map(|p| p.id) != Some(session) {
            return Err(AppError::msg("領域選択中ではありません"));
        }
        pending.take().unwrap()
    };
    crate::region_window::hide(&window)?;
    window.emit("region-reset", ())?;
    let image = imaging::crop(
        &pending_region.captured.image,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
    )?;
    let origin = pending_region.bounds.selection_origin(rect.x, rect.y)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = actions::finish_capture(
            &app,
            Captured {
                image,
                monitor: pending_region.captured.monitor,
            },
            Some(origin),
            CaptureKind::Region,
        );
        if let Err(error) = &result {
            crate::show_capture_error(&app, error);
        }
        result
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub fn cancel_region(window: WebviewWindow, state: State<'_, AppState>) -> AppResult<()> {
    state.pending_region.lock().unwrap().take();
    crate::region_window::hide(&window)?;
    window.emit("region-reset", ())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    /// ウィンドウを作るコマンドが同期に戻ると、Windows で固まる不具合が再発する
    #[test]
    fn window_creating_commands_are_async() {
        let source = include_str!("commands.rs");
        for name in [
            "capture",
            "finish_region",
            "open_editor",
            "open_settings",
            "open_about",
            "save_shot_as",
        ] {
            assert!(
                source.contains(&format!("pub async fn {name}(")),
                "{name} must be an async command"
            );
        }
    }
}
