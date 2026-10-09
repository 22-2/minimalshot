use std::path::{Path, PathBuf};
use std::process::Command;

use arboard::{Clipboard, ImageData};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::capture::{self, Captured};
use crate::config::AutoCopy;
use crate::error::{AppError, AppResult};
use crate::external;
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
fn path_for_tool(app: &AppHandle, id: u32) -> AppResult<PathBuf> {
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

pub fn open_with(app: &AppHandle, id: u32, tool_index: usize) -> AppResult<()> {
    let tool = app
        .state::<AppState>()
        .config()
        .external
        .tools
        .get(tool_index)
        .cloned()
        .ok_or_else(|| AppError::msg("外部ツールが見つかりません"))?;
    let path = path_for_tool(app, id)?;
    Command::new(tool.command.trim())
        .args(external::build_args(&tool.args, &path)?)
        .spawn()
        .map_err(|e| AppError::msg(format!("{} を起動できません: {e}", tool.name)))?;
    Ok(())
}

fn saved_path(app: &AppHandle, id: u32) -> AppResult<PathBuf> {
    app.state::<AppState>().shots.with(id, |shot| {
        shot.saved_path
            .clone()
            .ok_or_else(|| AppError::msg("まだ保存されていません"))
    })
}

/// 保存先のファイルをエクスプローラーで選択した状態で開く。
pub fn reveal(app: &AppHandle, id: u32) -> AppResult<()> {
    let path = saved_path(app, id)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer は引数を独自に解釈するので、/select, とパスをまとめて生のまま渡す
        Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()?;
    }
    #[cfg(not(windows))]
    {
        let dir = path.parent().unwrap_or(&path);
        Command::new("xdg-open").arg(dir).spawn()?;
    }
    Ok(())
}

/// 名前を付けて保存。キャンセルされたら None を返す。
pub fn save_as(app: &AppHandle, id: u32) -> AppResult<Option<PathBuf>> {
    let suggested = paths::render_save_path(
        "",
        &app.state::<AppState>().config().storage.format,
        Path::new(""),
        &chrono::Local::now(),
    )?;
    let file_name = suggested
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "shot.png".into());
    let Some(chosen) = app
        .dialog()
        .file()
        .add_filter("PNG", &["png"])
        .set_file_name(file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut path = chosen
        .into_path()
        .map_err(|e| AppError::msg(e.to_string()))?;
    if path.extension().is_none() {
        path.set_extension("png");
    }
    app.state::<AppState>().shots.with(id, |shot| {
        imaging::write_png(&shot.image, &path)?;
        shot.saved_path = Some(path.clone());
        Ok(())
    })?;
    Ok(Some(path))
}

/// 保存したファイルをごみ箱へ送り、未保存の状態に戻す（画像はビューアに残る）。
pub fn delete_saved(app: &AppHandle, id: u32) -> AppResult<()> {
    let path = saved_path(app, id)?;
    trash::delete(&path)
        .map_err(|e| AppError::msg(format!("{} を削除できません: {e}", path.display())))?;
    app.state::<AppState>().shots.with(id, |shot| {
        shot.saved_path = None;
        Ok(())
    })
}
