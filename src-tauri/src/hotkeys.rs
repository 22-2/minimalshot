use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::config::Hotkeys;
use crate::error::{AppError, AppResult};
use crate::state::{AppState, CaptureKind};

/// 設定文字列をショートカットに変換する。PrintScreen 単体は OS 標準の動作を奪うので拒否する。
pub fn parse_hotkeys(hotkeys: &Hotkeys) -> AppResult<Vec<(Shortcut, CaptureKind)>> {
    [
        (&hotkeys.region, CaptureKind::Region),
        (&hotkeys.window, CaptureKind::Window),
        (&hotkeys.fullscreen, CaptureKind::Fullscreen),
    ]
    .into_iter()
    .filter(|(text, _)| !text.trim().is_empty())
    .map(|(text, kind)| {
        let shortcut: Shortcut = text
            .parse()
            .map_err(|e| AppError::msg(format!("ショートカット「{text}」を解釈できません: {e}")))?;
        if shortcut.mods.is_empty() {
            return Err(AppError::msg(format!(
                "ショートカット「{text}」には修飾キーが必要です"
            )));
        }
        Ok((shortcut, kind))
    })
    .collect()
}

pub fn register(app: &AppHandle, hotkeys: &Hotkeys) -> AppResult<()> {
    let parsed = parse_hotkeys(hotkeys)?;
    let manager = app.global_shortcut();
    manager
        .unregister_all()
        .map_err(|e| AppError::msg(e.to_string()))?;
    for (shortcut, _) in &parsed {
        manager
            .register(*shortcut)
            .map_err(|e| AppError::msg(format!("{shortcut} を登録できません: {e}")))?;
    }
    *app.state::<AppState>().hotkeys.lock().unwrap() = parsed;
    Ok(())
}

pub fn kind_for(app: &AppHandle, shortcut: &Shortcut) -> Option<CaptureKind> {
    app.state::<AppState>()
        .hotkeys
        .lock()
        .unwrap()
        .iter()
        .find(|(registered, _)| registered.id() == shortcut.id())
        .map(|(_, kind)| *kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_hotkeys() {
        let parsed = parse_hotkeys(&Hotkeys::default()).unwrap();
        let kinds: Vec<_> = parsed.iter().map(|(_, k)| *k).collect();
        assert_eq!(
            kinds,
            [
                CaptureKind::Region,
                CaptureKind::Window,
                CaptureKind::Fullscreen
            ]
        );
    }

    #[test]
    fn skips_blank_hotkeys() {
        let hotkeys = Hotkeys {
            fullscreen: String::new(),
            ..Hotkeys::default()
        };
        assert_eq!(parse_hotkeys(&hotkeys).unwrap().len(), 2);
    }

    #[test]
    fn rejects_bare_print_screen() {
        let hotkeys = Hotkeys {
            region: "PrintScreen".into(),
            ..Hotkeys::default()
        };
        assert!(parse_hotkeys(&hotkeys).is_err());
    }

    #[test]
    fn rejects_garbage() {
        let hotkeys = Hotkeys {
            window: "Ctrl+Nope".into(),
            ..Hotkeys::default()
        };
        assert!(parse_hotkeys(&hotkeys).is_err());
    }
}
