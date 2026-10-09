use std::sync::OnceLock;

use serde_json::Value;

// フロントエンドと同じ言語ファイルを使い、文言の置き場所を1つにする
const JA: &str = include_str!("../../src/locales/ja.json");

fn messages() -> &'static Value {
    static MESSAGES: OnceLock<Value> = OnceLock::new();
    MESSAGES.get_or_init(|| serde_json::from_str(JA).expect("ja.json must be valid JSON"))
}

/// `tray.quit` のようなドット区切りのキーで文言を引く。無いキーはキー名をそのまま返す。
pub fn t(key: &str) -> String {
    key.split('.')
        .try_fold(messages(), |node, part| node.get(part))
        .and_then(Value::as_str)
        .map_or_else(|| key.to_string(), str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_nested_keys() {
        assert_eq!(t("tray.quit"), "終了");
    }

    #[test]
    fn falls_back_to_key() {
        assert_eq!(t("tray.nope"), "tray.nope");
    }
}
