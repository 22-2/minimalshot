# tasks.json から呼ぶ、MinimalShot の最新 dev 版を取得して差し替え、再起動する。
# 実行中の exe は置き換えられないため、ダウンロード後にプロセスを停止する。
$ErrorActionPreference = 'Stop'

$executablePath = 'C:\Applications\bins\MinimalShot.exe'
$downloadPath = Join-Path (Split-Path -Parent $executablePath) "MinimalShot.$([guid]::NewGuid()).new"

try {
  # develop の CI が進行中なら、完了するまで待つ。
  while ($true) {
    $runsJson = gh run list --workflow ci.yml --branch develop --event push --status in_progress --json databaseId
    if ($LASTEXITCODE -ne 0) {
      throw 'develop の CI 状態を取得できませんでした。gh auth status で認証状態を確認してください。'
    }

    $runs = @($runsJson | ConvertFrom-Json)
    if ($runs.Count -eq 0) {
      break
    }

    foreach ($run in $runs) {
      Write-Host "develop の CI (#$($run.databaseId)) の完了を待っています..."
      gh run watch $run.databaseId --exit-status
      if ($LASTEXITCODE -ne 0) {
        throw "develop の CI (#$($run.databaseId)) が成功しませんでした。開発版の更新を中止します。"
      }
    }
  }

  # 非公開リポジトリのリリースは GitHub CLI の認証を使って取得する。
  gh release download v0.0.0-dev --repo 22-2/minimalshot --pattern MinimalShot_dev_x64.exe --output $downloadPath
  if ($LASTEXITCODE -ne 0) {
    throw 'MinimalShot のダウンロードに失敗しました。gh auth status で認証状態を確認してください。'
  }

  $processes = @(Get-Process -Name MinimalShot -ErrorAction SilentlyContinue)
  if ($processes.Count -gt 0) {
    # 停止直後に終了しても待機できるよう、取得済みのプロセスをそのまま渡す。
    Stop-Process -InputObject $processes
    Wait-Process -InputObject $processes -Timeout 15
  }

  Move-Item -LiteralPath $downloadPath -Destination $executablePath -Force
  Start-Process -FilePath $executablePath
} finally {
  if (Test-Path -LiteralPath $downloadPath -PathType Leaf) {
    Remove-Item -LiteralPath $downloadPath -Force
  }
}
