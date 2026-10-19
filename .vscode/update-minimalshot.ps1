# tasks.json から呼ぶ、MinimalShot の最新 dev 版を取得して差し替え、再起動する。
# 実行中の exe は置き換えられないため、ダウンロード後にプロセスを停止する。
$ErrorActionPreference = 'Stop'

$executablePath = 'C:\Applications\bins\MinimalShot.exe'
$downloadPath = Join-Path (Split-Path -Parent $executablePath) "MinimalShot.$([guid]::NewGuid()).new"

try {
  # CI と開発版ビルドの状態を定期確認し、完了後に処理を続ける。
  $waitedForCi = $false
  while ($true) {
    $runsJson = gh run list --workflow ci.yml --branch develop --event push --json databaseId,status,conclusion,updatedAt --limit 100
    if ($LASTEXITCODE -ne 0) {
      throw 'develop の CI 状態を取得できませんでした。gh auth status で認証状態を確認してください。'
    }

    $runs = @($runsJson | ConvertFrom-Json)
    $activeRuns = @($runs | Where-Object { $_.status -in @('queued', 'in_progress', 'requested', 'waiting', 'pending') })
    if ($activeRuns.Count -gt 0) {
      if (-not $waitedForCi) {
        Write-Host 'develop の CI が実行中です。完了まで5秒間隔で確認します...'
      }
      $waitedForCi = $true
      Start-Sleep -Seconds 5
      continue
    }

    # 起動時点ですでに終了している CI も確認し、失敗した版の代わりに古い exe を入れない。
    $latestRun = $runs | Select-Object -First 1
    if ($null -eq $latestRun) {
      throw 'develop の CI 実行を確認できませんでした。開発版の更新を中止します。'
    }

    if ($latestRun.status -eq 'completed') {
      if ($latestRun.conclusion -ne 'success') {
        throw "develop の CI (#$($latestRun.databaseId)) は $($latestRun.conclusion) で終了しました。開発版の更新を中止します。"
      }
      break
    }

    Start-Sleep -Seconds 5
  }

  # CI 成功後に別 workflow が開発版をビルド・公開するため、その開始時刻以降の run を待つ。
  # 起動時にすでに CI が終わっていても、ビルド中の古い exe を取らないよう毎回確認する。
  $ciCompletedAt = [DateTimeOffset]::Parse($latestRun.updatedAt)
  $waitedForRelease = $false
  while ($true) {
    $releaseRunsJson = gh run list --workflow development-release.yml --event workflow_run --json databaseId,status,conclusion,createdAt --limit 20
    if ($LASTEXITCODE -ne 0) {
      throw '開発版リリースの状態を取得できませんでした。'
    }

    $releaseRuns = @($releaseRunsJson | ConvertFrom-Json)
    $releaseRun = $releaseRuns |
      Where-Object { [DateTimeOffset]::Parse($_.createdAt) -ge $ciCompletedAt } |
      Select-Object -First 1
    if ($null -eq $releaseRun) {
      if (-not $waitedForRelease) {
        Write-Host 'CI は成功しました。対応する開発版ビルドの開始を待っています...'
        $waitedForRelease = $true
      }
      Start-Sleep -Seconds 5
      continue
    }

    if ($releaseRun.status -in @('queued', 'in_progress', 'requested', 'waiting', 'pending')) {
      if (-not $waitedForRelease) {
        Write-Host '開発版をビルド・公開しています。完了まで5秒間隔で確認します...'
        $waitedForRelease = $true
      }
      Start-Sleep -Seconds 5
      continue
    }

    if ($releaseRun.conclusion -ne 'success') {
      throw "開発版リリース (#$($releaseRun.databaseId)) は $($releaseRun.conclusion) で終了しました。更新を中止します。"
    }
    break
  }

  # 非公開リポジトリのリリースは GitHub CLI の認証を使って取得する。
  gh release download v0.0.0-dev --repo 22-2/minimalshot --pattern MinimalShot_dev_x64.exe --output $downloadPath
  if ($LASTEXITCODE -ne 0) {
    throw 'MinimalShot のダウンロードに失敗しました。gh auth status で認証状態を確認してください。'
  }

  # 名前ではなく差し替え先の exe のパスで対象を決め、止め損ねや再起動した個体も拾う。
  $getRunning = {
    @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
      try { $_.Path -eq $executablePath } catch { $false }
    })
  }
  # 終了待ちだけでは、ハンドルの解放やウイルス対策の走査が済む前に置き換えて失敗する。
  # 起動中の個体が残っていれば止め直しながら、置き換えに成功するまで再試行する。
  $deadline = (Get-Date).AddSeconds(30)
  while ($true) {
    $remaining = & $getRunning
    if ($remaining.Count -gt 0) {
      Stop-Process -InputObject $remaining -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 300
    } else {
      try {
        # 同じフォルダ内の一時ファイルを上書き移動し、既存 exe を置き換える。
        [System.IO.File]::Move($downloadPath, $executablePath, $true)
        break
      } catch [System.UnauthorizedAccessException], [System.IO.IOException] {
        if ((Get-Date) -ge $deadline) {
          throw "MinimalShot.exe を置き換えられませんでした。他のプロセスが使用中の可能性があります: $($_.Exception.Message)"
        }
        Start-Sleep -Milliseconds 500
      }
    }
    if ((Get-Date) -ge $deadline) {
      throw 'MinimalShot を終了できませんでした。更新を中止します。'
    }
  }

  Start-Process -FilePath $executablePath
} finally {
  if (Test-Path -LiteralPath $downloadPath -PathType Leaf) {
    Remove-Item -LiteralPath $downloadPath -Force
  }
}
