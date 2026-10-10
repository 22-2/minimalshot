# MinimalShot

機能が少ないことを機能にしたスクリーンショットツールです。撮る・浮かべる・渡すだけを行い、画像編集は一切しません。編集はペイントなど、登録した外部ツールに任せます。

## 使い方

| 操作 | 既定のショートカット |
| --- | --- |
| 領域をキャプチャ | `Ctrl+PrintScreen` |
| アクティブウィンドウをキャプチャ | `Alt+PrintScreen` |
| 全画面（カーソルのあるモニター）をキャプチャ | `Shift+PrintScreen` |

`PrintScreen` 単体は OS の動作を残すため上書きしません。撮った画像は枠の薄い独立ウィンドウに浮かび、複数枚を同時に並べられます。ウィンドウはどこを掴んでもドラッグできます。

撮影後に自動保存・コピーを行った場合、完了したアクションの一覧を画像の上に短時間表示します。

ビューアは既定で撮影範囲とほぼ同じ大きさで開き、領域撮影では元の位置に重なります。設定で余白付き表示を選ぶと、960×540（16:9）の窓を基準に開き、画像を最大66%で表示します。ウィンドウの移動はタイトルバーで行います。画像の上ではホイールで拡大・縮小、ドラッグでパン、ダブルクリックで全体表示、Esc で閉じます。

ビューアでは `Ctrl+S` で既定の場所に保存、`Ctrl+Shift+S` で名前を付けて保存できます。

操作はすべて画像の右クリックメニューから行えます。上段に画像コピー・パスコピー・削除のアイコンが並び、「撮影元画面とフィット」で100%の等倍表示に戻せます。外部ツールはタイトルバーの「外部ツールで開く」からも選べます:

- パスのコピー（保存済みのときだけ）／画像をコピー
- 既定の場所に保存／名前を付けて保存／保存したファイルを削除（ごみ箱へ移動）
- 外部ツールで開く（登録したツールから選択。未保存なら一時ファイルを渡します）
- エクスプローラーで開く（保存済みのときだけ）
- 常に最前面に表示
- 設定

トレイアイコンのメニューから、キャプチャ、設定画面、「MinimalShot について」を開けます。「このアプリについて」には実行中のバージョンが表示されます。トレイの右クリックメニューと設定画面の「設定フォルダを開く」から、`config.toml` のあるフォルダをエクスプローラーで開けます。

## 設定

`%APPDATA%\dev.minimashot.app\config.toml` に保存されます。設定画面からも編集できます。

```toml
[hotkeys]
region = ["Ctrl+PrintScreen", "Win+Shift+Z"]
window = ["Alt+PrintScreen"]
fullscreen = ["Shift+PrintScreen"]

[capture]
auto_save = false
auto_copy = "image" # none / image / path（path は保存時のみ）。すべての撮影モードの既定動作

[capture.region]
auto_save = true # 指定しない項目は [capture] の値を引き継ぐ

[storage]
directory = "{pictures}/{appname}"
format = "%Y-%m/%Y-%m-%d_%H-%M-%S.png" # strftime 形式

[viewer]
layout = "source" # source: 撮影元に重ねる / framed: 16:9 の窓に余白付きで表示
always_on_top = false
confirm_on_close = false

# 「外部ツールで開く」に並ぶツール。args では次の変数が使えます:
# ${file} ${fileDirname} ${fileBasename} ${fileBasenameNoExtension} ${fileExtname}
[[external.tools]]
name = "ペイント"
command = "mspaint.exe"
args = '"${file}"'
hide_console = false # true でコンソールウィンドウを出さない
copy_stdout = false  # true で終了を待ち、標準出力をクリップボードへコピー

# 例: Tesseract で文字認識して結果をコピー
[[external.tools]]
name = "文字認識"
command = 'C:\Program Files\Tesseract-OCR\tesseract.exe'
args = '"${file}" stdout -l jpn+eng'
copy_stdout = true
```

`[capture.region]`、`[capture.window]`、`[capture.fullscreen]` でモードごとに既定動作を上書きできます。外部ツールは撮影後にビューアの「外部ツールで開く」から選んで実行します。ホットキーは `Win` / `Windows` を修飾キーとして使え、大文字小文字を区別しません。以前の単一文字列形式も読み込めます。0.0.3 までの `[external] editor = "..."` も読み込めます（ツール1件として扱います）。

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

Windows の実際の WebView2 で、予備窓の事前描画・起動時のちらつき・フォーカス・領域選択の初回と2回目・自動保存を検証する場合は、別のターミナルで `pnpm dev` を起動し、次を実行します。実画面を使う領域選択を2回表示して中止し、テスト用の色画像の窓を開いて一時フォルダへ保存します。通常のアプリの設定やホットキー、クリップボードは使いません。

```sh
cd src-tauri
cargo test --features native-ui-test prewarmed_windows_display_captures_before_auto_save -- --ignored --nocapture
```

UI の文言は `src/locales/ja.json` にまとめ、Rust 側（トレイメニュー）も同じファイルを読みます。色や寸法は `src/styles/tokens.css` のトークンだけを使います。

## リリース

### 開発版（develop の更新ごと）

`develop` に push すると CI が走り、すべて成功したコミットを Development release ワークフローがビルドして公開します。バージョン番号の更新や手動リリース操作は不要です。
開発版の「このアプリについて」には、ビルド開始時の日時を日本時間で表示します。
開発版は `devtools` 機能付きでビルドするため、右クリックメニューの「検証」から開発者ツールを開けます。ビューアでは Shift+右クリックで既定のメニューを出します。

- [開発版をダウンロード](https://github.com/22-2/minimalshot/releases/download/v0.0.0-dev/MinimalShot_dev_x64.exe)
- [開発版の詳細・ビルド元コミット](https://github.com/22-2/minimalshot/releases/tag/v0.0.0-dev)

固定の `v0.0.0-dev` タグと添付 exe を更新するため、配布 URL は変わりません。公開前に develop が先へ進んでいた場合は古いビルドの公開を省き、次の CI 成功を待ちます。CI が失敗した場合は前回の開発版が残ります。

### バージョン付きリリース

`v` で始まるタグ（開発版専用の `v0.0.0-dev` を除く）を push するか、Release ワークフローを `version` 付きで手動実行すると、Windows 用の単体 exe を GitHub Releases に公開します。CI は main へのマージ時に済んでいる前提で、リリースではビルドと公開だけを行います。通常のリリースとタグは残るため、以前のバージョンへ戻せます。

## ロードマップ

- タブ機能（実験的・オフにできる設計）: タブの移動、確認付きの閉じる／一括で閉じる、ホイールでの切り替え、中クリックで閉じる、全ウィンドウのマージ
