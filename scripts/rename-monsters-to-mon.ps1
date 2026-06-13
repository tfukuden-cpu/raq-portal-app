# モンスター画像の退避: char-37..108.png → mon-1..72.png（monId = oldId - 36）
# SPEC.md §6-7。基本職100体の生成で char-37..100 が上書きされる前に必ず実行すること。
# コピー方式（元の char-* は残す＝この後の生成で上書きされてOK）。

$root = "C:\dev\raq-portal-app\public\rpg"
$copied = 0
$missing = @()

for ($old = 37; $old -le 108; $old++) {
    $monId = $old - 36
    $src = Join-Path $root "char-$old.png"
    $dst = Join-Path $root "mon-$monId.png"
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $dst -Force
        $copied++
    } else {
        $missing += $old
    }
}

Write-Output "copied: $copied 体 (char-37..108 -> mon-1..72)"
if ($missing.Count -gt 0) {
    Write-Output "WARN: 元ファイルが無い char 番号: $($missing -join ', ')"
}
