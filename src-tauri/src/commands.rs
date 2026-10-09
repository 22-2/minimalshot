use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::actions;
use crate::capture::Captured;
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

/// ビューアは自分のウィンドウラベルからキャプチャIDを得る。
fn shot_id(window: &WebviewWindow) -> AppResult<u32> {
    window
        .label()
        .strip_prefix(VIEWER_PREFIX)
        .and_then(|id| id.parse().ok())
        .ok_or_else(|| AppError::msg("ビューア以外のウィンドウです"))
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Config {
    state.config()
}

#[tauri::command]
pub fn open_config_folder(app: AppHandle) -> AppResult<()> {
    actions::open_config_folder(&app)
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: Config) -> AppResult<()> {
    let state = app.state::<AppState>();
    // 先に全項目を検証し、不正な設定はファイルに書かない
    hotkeys::parse_hotkeys(&config.hotkeys)?;
    crate::paths::render_save_path(
        &config.storage.directory,
        &config.storage.format,
        std::path::Path::new(""),
        &chrono::Local::now(),
    )?;
    for tool in &config.external.tools {
        if tool.name.trim().is_empty() || tool.command.trim().is_empty() {
            return Err(AppError::msg("外部ツールには名前とコマンドが必要です"));
        }
        crate::external::split_args(&tool.args)?;
    }
    hotkeys::register(&app, &config.hotkeys)?;
    config.save(&state.config_path)?;
    *state.config.lock().unwrap() = config;
    Ok(())
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
pub fn region_session(state: State<'_, AppState>) -> Option<u32> {
    state
        .pending_region
        .lock()
        .unwrap()
        .as_ref()
        .map(|pending| pending.id)
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
        window.show()?;
        window.set_focus()?;
    } else if !window.is_visible()? {
        window.show()?;
        window.set_focus()?;
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
    let captured = {
        let state = app.state::<AppState>();
        let mut pending = state.pending_region.lock().unwrap();
        if pending.as_ref().map(|p| p.id) != Some(session) {
            return Err(AppError::msg("領域選択中ではありません"));
        }
        pending.take().unwrap().captured
    };
    window.hide()?;
    window.emit("region-reset", ())?;
    let image = imaging::crop(&captured.image, rect.x, rect.y, rect.width, rect.height)?;
    let origin = (
        captured.monitor.x + rect.x as i32,
        captured.monitor.y + rect.y as i32,
    );
    tauri::async_runtime::spawn_blocking(move || {
        actions::finish_capture(
            &app,
            Captured {
                image,
                monitor: captured.monitor,
            },
            Some(origin),
        )
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub fn cancel_region(window: WebviewWindow, state: State<'_, AppState>) -> AppResult<()> {
    state.pending_region.lock().unwrap().take();
    window.hide()?;
    window.emit("region-reset", ())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    /// ウィンドウを作るコマンドが同期に戻ると、Windows で固まる不具合が再発する
    #[test]
    fn window_creating_commands_are_async() {
        let source = include_str!("commands.rs");
        for name in ["capture", "finish_region", "open_settings", "save_shot_as"] {
            assert!(
                source.contains(&format!("pub async fn {name}(")),
                "{name} must be an async command"
            );
        }
    }
}
