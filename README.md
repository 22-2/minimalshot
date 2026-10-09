# MinimaShot

機能が少ないことを機能にしたスクリーンショットツールです。撮る・浮かべる・渡すだけを行い、画像編集は一切しません。編集はペイントなど、登録した外部ツールに任せます。

## 使い方

| 操作 | 既定のショートカット |
| --- | --- |
| 領域をキャプチャ | `Ctrl+PrintScreen` |
| アクティブウィンドウをキャプチャ | `Alt+PrintScreen` |
| 全画面（カーソルのあるモニター）をキャプチャ | `Shift+PrintScreen` |

`PrintScreen` 単体は OS の動作を残すため上書きしません。撮った画像は枠の薄い独立ウィンドウに浮かび、複数枚を同時に並べられます。ウィンドウはどこを掴んでもドラッグできます。

ウィンドウの移動はタイトルバーで行います。画像の上ではホイールで拡大・縮小、ドラッグでパン、ダブルクリックで全体表示、Esc で閉じます。

画像の右クリックメニュー（下部バーのボタンからも同じ項目を選べます）:

- パスのコピー（保存済みのときだけ）／画像をコピー
- 既定の場所に保存／名前を付けて保存／保存したファイルを削除（ごみ箱へ移動）
- 外部ツールで開く（登録したツールから選択。未保存なら一時ファイルを渡します）
- エクスプローラーで開く（保存済みのときだけ）
- 設定

トレイアイコンのメニューから、キャプチャと設定画面を開けます。

## 設定

`%APPDATA%\dev.minimashot.app\config.toml` に保存されます。設定画面からも編集できます。

```toml
[hotkeys]
region = "Ctrl+PrintScreen"
window = "Alt+PrintScreen"
fullscreen = "Shift+PrintScreen"

[capture]
auto_save = false
auto_copy = "image" # none / image / path（path は保存時のみ）

[storage]
directory = "{pictures}/{appname}"
format = "%Y-%m/%Y-%m-%d_%H-%M-%S.png" # strftime 形式

[viewer]
always_on_top = false
confirm_on_close = false

# 「外部ツールで開く」に並ぶツール。args では次の変数が使えます:
# ${file} ${fileDirname} ${fileBasename} ${fileBasenameNoExtension} ${fileExtname}
[[external.tools]]
name = "ペイント"
command = "mspaint.exe"
args = '"${file}"'
```

0.0.3 までの `[external] editor = "..."` も読み込めます（ツール1件として扱います）。

## 開発

Rust + Tauri 2 + React + TypeScript。キャプチャ・保存・クリップボード・外部プロセス起動は Rust 側、設定画面と画像ビューアは TypeScript 側が担当します。

```sh
pnpm install
pnpm tauri dev        # 起動
pnpm typecheck
pnpm test             # Vitest
pnpm test:e2e         # Playwright（Tauri IPC をモック）
cd src-tauri && cargo test
```

UI の文言は `src/locales/ja.json` にまとめ、Rust 側（トレイメニュー）も同じファイルを読みます。色や寸法は `src/styles/tokens.css` のトークンだけを使います。

## リリース

`v` で始まるタグを push するか、Release ワークフローを `version` 付きで手動実行すると、Windows 用の単体 exe を GitHub Releases に公開します。CI は main へのマージ時に済んでいる前提で、リリースではビルドと公開だけを行います。

## ロードマップ

- タブ機能（実験的・オフにできる設計）: タブの移動、確認付きの閉じる／一括で閉じる、ホイールでの切り替え、中クリックで閉じる、全ウィンドウのマージ
