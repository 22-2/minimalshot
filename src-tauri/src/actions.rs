use std::path::PathBuf;
use std::process::Command;

use arboard::{Clipboard, ImageData};
use tauri::{AppHandle, Manager};

use crate::capture::{self, Captured};
use crate::config::AutoCopy;
use crate::error::{AppError, AppResult};
use crate::imaging;
use crate::paths::{self, APP_NAME};
use crate::state::{AppState, CaptureKind};
use crate::windows;

pub fn start_capture(app: &AppHandle, kind: CaptureKind) -> AppResult<()> {
    match kind {
        CaptureKind::Window => finish_capture(app, capture::focused_window()?, None),
        CaptureKind::Fullscreen => {
            let (x, y) = cursor(app)?;
            finish_capture(app, capture::monitor_at(x, y)?, None)
        }
        CaptureKind::Region => {
            let (x, y) = cursor(app)?;
            let captured = capture::monitor_at(x, y)?;
            let monitor = captured.monitor;
            *app.state::<AppState>().pending_region.lock().unwrap() = Some(captured);
            windows::open_region_overlay(app, &monitor)
        }
    }
}

fn cursor(app: &AppHandle) -> AppResult<(i32, i32)> {
    let position = app.cursor_position()?;
    Ok((position.x.round() as i32, position.y.round() as i32))
}

/// 撮影した画像を登録し、設定に応じて保存・コピーしてからビューアを出す。
pub fn finish_capture(
    app: &AppHandle,
    captured: Captured,
    origin: Option<(i32, i32)>,
) -> AppResult<()> {
    let state = app.state::<AppState>();
    let config = state.config();
    let dimensions = captured.image.dimensions();
    let id = state.shots.insert(captured.image);

    if config.capture.auto_save {
        save(app, id)?;
    }
    match config.capture.auto_copy {
        AutoCopy::None => {}
        AutoCopy::Image => copy_image(app, id)?,
        // パスは保存したときだけ存在するので、未保存ならコピーしない
        AutoCopy::Path if config.capture.auto_save => copy_path(app, id)?,
        AutoCopy::Path => {}
    }

    windows::open_viewer(
        app,
        id,
        dimensions,
        &captured.monitor,
        origin,
        config.viewer.always_on_top,
    )
}

pub fn save(app: &AppHandle, id: u32) -> AppResult<PathBuf> {
    let state = app.state::<AppState>();
    let config = state.config();
    let pictures = app.path().picture_dir()?;
    state.shots.with(id, |shot| {
        if let Some(path) = &shot.saved_path {
            return Ok(path.clone());
        }
        let path = paths::avoid_collision(paths::render_save_path(
            &config.storage.directory,
            &config.storage.format,
            &pictures,
            &chrono::Local::now(),
        )?);
        imaging::write_png(&shot.image, &path)?;
        shot.saved_path = Some(path.clone());
        Ok(path)
    })
}

pub fn copy_image(app: &AppHandle, id: u32) -> AppResult<()> {
    app.state::<AppState>().shots.with(id, |shot| {
        let (width, height) = shot.image.dimensions();
        Clipboard::new()?.set_image(ImageData {
            width: width as usize,
            height: height as usize,
            bytes: shot.image.as_raw().into(),
        })?;
        Ok(())
    })
}

pub fn copy_path(app: &AppHandle, id: u32) -> AppResult<()> {
    let path = app.state::<AppState>().shots.with(id, |shot| {
        shot.saved_path
            .clone()
            .ok_or_else(|| AppError::msg("まだ保存されていません"))
    })?;
    Clipboard::new()?.set_text(path.to_string_lossy())?;
    Ok(())
}

/// 外部ツールへ渡すパス。未保存なら一時フォルダに書き出し、保存設定には影響させない。
fn path_for_editor(app: &AppHandle, id: u32) -> AppResult<PathBuf> {
    app.state::<AppState>().shots.with(id, |shot| {
        if let Some(path) = &shot.saved_path {
            return Ok(path.clone());
        }
        let path = std::env::temp_dir()
            .join(APP_NAME)
            .join(format!("shot-{}-{id}.png", std::process::id()));
        imaging::write_png(&shot.image, &path)?;
        Ok(path)
    })
}

pub fn open_in_editor(app: &AppHandle, id: u32) -> AppResult<()> {
    let editor = app.state::<AppState>().config().external.editor;
    if editor.trim().is_empty() {
        return Err(AppError::msg("外部ツールが設定されていません"));
    }
    let path = path_for_editor(app, id)?;
    Command::new(editor.trim())
        .arg(path)
        .spawn()
        .map_err(|e| AppError::msg(format!("{editor} を起動できません: {e}")))?;
    Ok(())
}
