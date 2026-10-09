use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use arboard::{Clipboard, ImageData};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::capture::{self, Captured};
use crate::config::{AutoCopy, Config};
use crate::error::{AppError, AppResult};
use crate::external;
use crate::imaging;
use crate::paths::{self, APP_NAME};
use crate::state::{AppState, CaptureKind, PendingCapture, PendingRegion};
use crate::store::Shot;
use crate::windows;

pub fn start_capture(app: &AppHandle, kind: CaptureKind) -> AppResult<()> {
    let state = app.state::<AppState>();
    let _capture = state.capture_lock.lock().unwrap();
    match kind {
        CaptureKind::Window => finish_capture(app, capture::focused_window()?, None),
        CaptureKind::Fullscreen => {
            let (x, y) = cursor(app)?;
            finish_capture(app, capture::monitor_at(x, y)?, None)
        }
        CaptureKind::Region => {
            // 選択中のオーバーレイを再撮影しない。初回の読み込み中も重複を避ける。
            if state.pending_region.lock().unwrap().is_some() {
                return Ok(());
            }
            let (x, y) = cursor(app)?;
            let captured = capture::monitor_at(x, y)?;
            let monitor = captured.monitor;
            let session = state.next_region_id();
            *state.pending_region.lock().unwrap() = Some(PendingRegion {
                id: session,
                captured,
            });
            if let Err(error) = windows::open_region_overlay(app, &monitor, session) {
                state.pending_region.lock().unwrap().take();
                return Err(error);
            }
            Ok(())
        }
    }
}

fn cursor(app: &AppHandle) -> AppResult<(i32, i32)> {
    let position = app.cursor_position()?;
    Ok((position.x.round() as i32, position.y.round() as i32))
}

/// 画像を先に表示し、自動保存・コピーは show_window から開始する。
pub fn finish_capture(
    app: &AppHandle,
    captured: Captured,
    origin: Option<(i32, i32)>,
) -> AppResult<()> {
    let state = app.state::<AppState>();
    let config = state.config();
    let dimensions = captured.image.dimensions();
    let id = state.shots.insert(captured.image);

    state.pending_captures.lock().unwrap().insert(
        id,
        PendingCapture {
            config: config.clone(),
            shot: state.shots.get(id)?,
        },
    );
    if let Err(error) = windows::open_viewer(
        app,
        id,
        dimensions,
        &captured.monitor,
        origin,
        config.viewer.always_on_top,
    ) {
        state.pending_captures.lock().unwrap().remove(&id);
        state.shots.remove(id);
        return Err(error);
    }

    Ok(())
}

pub fn complete_capture(
    app: &AppHandle,
    label: &str,
    id: u32,
    pending: PendingCapture,
) -> AppResult<()> {
    let state = app.state::<AppState>();
    let config = pending.config;
    if config.capture.auto_save {
        let path = {
            // 同時撮影でも保存名の衝突回避から書き込みまでを直列化する。
            let _saving = state.save_lock.lock().unwrap();
            let mut shot = pending.shot.lock().unwrap();
            save_image(app, &config, &mut shot)?
        };
        app.emit_to(label, "shot-saved", path.to_string_lossy().as_ref())?;
    }
    if config.capture.auto_copy == AutoCopy::None
        || (config.capture.auto_copy == AutoCopy::Path && !config.capture.auto_save)
    {
        return Ok(());
    }
    // 表示・保存の完了順が逆転しても、古い撮影が新しいクリップボードを上書きしない。
    let mut last_copied = state.auto_copy_lock.lock().unwrap();
    if id < *last_copied {
        return Ok(());
    }
    match config.capture.auto_copy {
        AutoCopy::Image => {
            let image = pending.shot.lock().unwrap().image.clone();
            set_clipboard_image(&image)?;
        }
        AutoCopy::Path => {
            let shot = pending.shot.lock().unwrap();
            let path = shot
                .saved_path
                .as_ref()
                .ok_or_else(|| AppError::msg("まだ保存されていません"))?;
            Clipboard::new()?.set_text(path.to_string_lossy())?;
        }
        AutoCopy::None => {}
    }
    *last_copied = id;
    Ok(())
}

pub fn save(app: &AppHandle, id: u32) -> AppResult<PathBuf> {
    let state = app.state::<AppState>();
    let config = state.config();
    let _saving = state.save_lock.lock().unwrap();
    state.shots.with(id, |shot| save_image(app, &config, shot))
}

fn save_image(app: &AppHandle, config: &Config, shot: &mut Shot) -> AppResult<PathBuf> {
    if let Some(path) = &shot.saved_path {
        return Ok(path.clone());
    }
    let path = paths::avoid_collision(paths::render_save_path(
        &config.storage.directory,
        &config.storage.format,
        &app.path().picture_dir()?,
        &chrono::Local::now(),
    )?);
    imaging::write_png(&shot.image, &path)?;
    shot.saved_path = Some(path.clone());
    Ok(path)
}

pub fn copy_image(app: &AppHandle, id: u32) -> AppResult<()> {
    let image = app
        .state::<AppState>()
        .shots
        .with(id, |shot| Ok(shot.image.clone()))?;
    set_clipboard_image(&image)
}

fn set_clipboard_image(image: &image::RgbaImage) -> AppResult<()> {
    let (width, height) = image.dimensions();
    Clipboard::new()?.set_image(ImageData {
        width: width as usize,
        height: height as usize,
        bytes: image.as_raw().into(),
    })?;
    Ok(())
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

/// 外部ツールを起動した結果。フロントエンドの通知文を切り替えるために返す。
#[derive(serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolOutcome {
    Launched,
    Copied,
}

pub fn open_with(app: &AppHandle, id: u32, tool_index: usize) -> AppResult<ToolOutcome> {
    let tool = app
        .state::<AppState>()
        .config()
        .external
        .tools
        .get(tool_index)
        .cloned()
        .ok_or_else(|| AppError::msg("外部ツールが見つかりません"))?;
    let path = path_for_tool(app, id)?;
    let mut command = Command::new(tool.command.trim());
    command.args(external::build_args(&tool.args, &path)?);
    // 出力を受け取る CLI にコンソールを出しても空の黒い窓が一瞬見えるだけなので、まとめて隠す
    if tool.hide_console || tool.copy_stdout {
        hide_console(&mut command);
    }
    let cannot_start =
        |e: std::io::Error| AppError::msg(format!("{} を起動できません: {e}", tool.name));

    if !tool.copy_stdout {
        command.spawn().map_err(cannot_start)?;
        return Ok(ToolOutcome::Launched);
    }

    let output = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(cannot_start)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::msg(format!(
            "{} が失敗しました（{}）: {}",
            tool.name,
            output.status,
            stderr.trim()
        )));
    }
    let text = external::stdout_text(&output.stdout);
    if text.is_empty() {
        return Err(AppError::msg(format!("{} の出力が空でした", tool.name)));
    }
    Clipboard::new()?.set_text(text)?;
    Ok(ToolOutcome::Copied)
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

fn saved_path(app: &AppHandle, id: u32) -> AppResult<PathBuf> {
    app.state::<AppState>().shots.with(id, |shot| {
        shot.saved_path
            .clone()
            .ok_or_else(|| AppError::msg("まだ保存されていません"))
    })
}

pub fn open_config_folder(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    let directory = state
        .config_path
        .parent()
        .ok_or_else(|| AppError::msg("設定フォルダが見つかりません"))?;
    std::fs::create_dir_all(directory)?;
    #[cfg(windows)]
    Command::new("explorer.exe").arg(directory).spawn()?;
    #[cfg(not(windows))]
    Command::new("xdg-open").arg(directory).spawn()?;
    Ok(())
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
