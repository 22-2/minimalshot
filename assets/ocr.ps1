[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ImagePath,
    [string]$OutputPath,
    [ValidateRange(1, 4)]
    [int]$Scale = 3,
    [ValidateSet(3, 6, 7, 11)]
    [int]$PageSegmentationMode = 3,
    [string]$Languages = 'jpn+eng',
    [string]$TesseractPath = (Join-Path $env:ProgramFiles 'Tesseract-OCR\tesseract.exe'),
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$ImagePath = [System.IO.Path]::GetFullPath($ImagePath)
if (-not $OutputPath) {
    $OutputPath = [System.IO.Path]::ChangeExtension($ImagePath, '.txt')
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if ([System.IO.Path]::GetExtension($OutputPath) -ne '.txt') {
    throw '出力先には .txt ファイルを指定してください。'
}
$outputBase = Join-Path ([System.IO.Path]::GetDirectoryName($OutputPath)) ([System.IO.Path]::GetFileNameWithoutExtension($OutputPath))
$temporaryImagePath = Join-Path ([System.IO.Path]::GetTempPath()) ('minimalshot-ocr-' + [guid]::NewGuid().ToString('N') + '.png')

try {
    Add-Type -AssemblyName System.Drawing
    $sourceImage = [System.Drawing.Bitmap]::new($ImagePath)
    try {
        # DPI の指定だけでは文字の画素数が増えないため、認識用の一時画像を拡大する。
        $scaledImage = [System.Drawing.Bitmap]::new($sourceImage.Width * $Scale, $sourceImage.Height * $Scale)
        try {
            $scaledImage.SetResolution(300, 300)
            $graphics = [System.Drawing.Graphics]::FromImage($scaledImage)
            try {
                $graphics.Clear([System.Drawing.Color]::White)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($sourceImage, 0, 0, $scaledImage.Width, $scaledImage.Height)
            } finally {
                $graphics.Dispose()
            }
            $scaledImage.Save($temporaryImagePath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $scaledImage.Dispose()
        }
    } finally {
        $sourceImage.Dispose()
    }

    & $TesseractPath $temporaryImagePath $outputBase -l $Languages --oem 1 --psm $PageSegmentationMode
    if ($LASTEXITCODE -ne 0) {
        throw "文字認識に失敗しました（終了コード: $LASTEXITCODE）。"
    }
    if (-not $NoOpen) {
        & notepad.exe $OutputPath
    }
} finally {
    if (Test-Path -LiteralPath $temporaryImagePath) {
        Remove-Item -LiteralPath $temporaryImagePath
    }
}
