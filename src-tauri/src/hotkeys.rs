use std::collections::HashSet;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::config::Hotkeys;
use crate::error::{AppError, AppResult};
use crate::state::{AppState, CaptureKind};

/// 設定文字列をショートカットに変換する。PrintScreen 単体は OS 標準の動作を奪うので拒否する。
pub fn parse_hotkeys(hotkeys: &Hotkeys) -> AppResult<Vec<(Shortcut, CaptureKind)>> {
    let mut seen = HashSet::new();
    let mut parsed = Vec::new();
    for (texts, kind) in [
        (&hotkeys.region, CaptureKind::Region),
        (&hotkeys.window, CaptureKind::Window),
        (&hotkeys.fullscreen, CaptureKind::Fullscreen),
        (&hotkeys.desktop, CaptureKind::Desktop),
    ] {
        for text in texts.iter().filter(|text| !text.trim().is_empty()) {
            // ライブラリは大文字小文字を無視するが Win は別名として受け付けない。
            let normalized = text
                .split('+')
                .map(|part| {
                    if part.trim().eq_ignore_ascii_case("win")
                        || part.trim().eq_ignore_ascii_case("windows")
                    {
                        "Super"
                    } else {
                        part
                    }
                })
                .collect::<Vec<_>>()
                .join("+");
            let shortcut: Shortcut = normalized.parse().map_err(|e| {
                AppError::msg(format!("ショートカット「{text}」を解釈できません: {e}"))
            })?;
            if shortcut.mods.is_empty() {
                return Err(AppError::msg(format!(
                    "ショートカット「{text}」には修飾キーが必要です"
                )));
            }
            if !seen.insert(shortcut.id()) {
                return Err(AppError::msg(format!(
                    "ショートカット「{text}」が重複しています"
                )));
            }
            parsed.push((shortcut, kind));
        }
    }
    Ok(parsed)
}

pub fn register(app: &AppHandle, hotkeys: &Hotkeys) -> AppResult<()> {
    let parsed = parse_hotkeys(hotkeys)?;
    let manager = app.global_shortcut();
    let state = app.state::<AppState>();
    let previous = state.hotkeys.lock().unwrap().clone();
    manager
        .unregister_all()
        .map_err(|e| AppError::msg(e.to_string()))?;
    for (shortcut, _) in &parsed {
        if let Err(error) = manager.register(*shortcut) {
            let _ = manager.unregister_all();
            for (old, _) in &previous {
                let _ = manager.register(*old);
            }
            return Err(AppError::msg(format!(
                "{shortcut} を登録できません: {error}"
            )));
        }
    }
    *state.hotkeys.lock().unwrap() = parsed;
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
            fullscreen: Vec::new(),
            ..Hotkeys::default()
        };
        assert_eq!(parse_hotkeys(&hotkeys).unwrap().len(), 2);
    }

    #[test]
    fn parses_desktop_shortcut_as_a_separate_mode() {
        let hotkeys = Hotkeys {
            desktop: vec!["Ctrl+Alt+PrintScreen".into()],
            ..Hotkeys::default()
        };
        let parsed = parse_hotkeys(&hotkeys).unwrap();
        assert_eq!(parsed.len(), 4);
        assert_eq!(parsed[3].1, CaptureKind::Desktop);
    }

    #[test]
    fn rejects_bare_print_screen() {
        let hotkeys = Hotkeys {
            region: vec!["PrintScreen".into()],
            ..Hotkeys::default()
        };
        assert!(parse_hotkeys(&hotkeys).is_err());
    }

    #[test]
    fn rejects_garbage() {
        let hotkeys = Hotkeys {
            window: vec!["Ctrl+Nope".into()],
            ..Hotkeys::default()
        };
        assert!(parse_hotkeys(&hotkeys).is_err());
    }

    #[test]
    fn accepts_win_and_case_insensitive_multiple_hotkeys() {
        let hotkeys = Hotkeys {
            region: vec!["win+shift+z".into(), "CTRL+alt+X".into()],
            ..Hotkeys::default()
        };
        let parsed = parse_hotkeys(&hotkeys).unwrap();
        assert_eq!(parsed.len(), 4);
        assert_eq!(parsed[0].1, CaptureKind::Region);
        assert_eq!(parsed[1].1, CaptureKind::Region);
        assert_eq!(
            parsed[0].0.id(),
            "Super+Shift+Z".parse::<Shortcut>().unwrap().id()
        );
    }

    #[test]
    fn rejects_duplicate_shortcuts_across_modes() {
        let hotkeys = Hotkeys {
            window: vec!["ctrl+printscreen".into()],
            ..Hotkeys::default()
        };
        assert!(parse_hotkeys(&hotkeys)
            .unwrap_err()
            .to_string()
            .contains("重複"));
    }
}
