# RPGキャラスプライトシート汎用分割スクリプト
# 使い方: $env:SHEET / $env:STARTIDX / $env:COLS / $env:ROWS を設定してから実行
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'SpriteSplitter').Type) {
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;

public static class SpriteSplitter
{
    public static Bitmap RemoveBackground(Bitmap src)
    {
        int w = src.Width, h = src.Height;
        var dst = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(dst)) { g.DrawImage(src, 0, 0, w, h); }

        var data = dst.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int stride = data.Stride;
        byte[] px = new byte[stride * h];
        System.Runtime.InteropServices.Marshal.Copy(data.Scan0, px, 0, px.Length);

        bool[] visited = new bool[w * h];
        var queue = new Queue<int>();

        Func<int, bool> isBg = (idx) =>
        {
            int o = (idx / w) * stride + (idx % w) * 4;
            byte b = px[o], gch = px[o + 1], r = px[o + 2];
            int max = Math.Max(r, Math.Max(gch, b));
            int min = Math.Min(r, Math.Min(gch, b));
            return min > 195 && (max - min) < 22;
        };

        for (int x = 0; x < w; x++) { queue.Enqueue(x); queue.Enqueue((h - 1) * w + x); }
        for (int y = 0; y < h; y++) { queue.Enqueue(y * w); queue.Enqueue(y * w + (w - 1)); }

        while (queue.Count > 0)
        {
            int idx = queue.Dequeue();
            if (idx < 0 || idx >= w * h || visited[idx] || !isBg(idx)) continue;
            visited[idx] = true;
            int o = (idx / w) * stride + (idx % w) * 4;
            px[o + 3] = 0;
            int cx = idx % w, cy = idx / w;
            if (cx > 0) queue.Enqueue(idx - 1);
            if (cx < w - 1) queue.Enqueue(idx + 1);
            if (cy > 0) queue.Enqueue(idx - w);
            if (cy < h - 1) queue.Enqueue(idx + w);
        }

        System.Runtime.InteropServices.Marshal.Copy(px, 0, data.Scan0, px.Length);
        dst.UnlockBits(data);
        return dst;
    }
}
"@ -ReferencedAssemblies System.Drawing
}

$root  = "C:\dev\raq-portal-app\public\rpg"
$sheet = $env:SHEET
$start = [int]$env:STARTIDX
$cols  = [int]$env:COLS
$rows  = [int]$env:ROWS

$src = [System.Drawing.Bitmap]::FromFile("$root\$sheet")
$clean = [SpriteSplitter]::RemoveBackground($src)
$src.Dispose()

function Get-TrimmedCell {
  param([System.Drawing.Bitmap]$cell)
  $minX = $cell.Width; $minY = $cell.Height; $maxX = -1; $maxY = -1
  $bd = $cell.LockBits((New-Object System.Drawing.Rectangle 0, 0, $cell.Width, $cell.Height), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($bd.Stride * $cell.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length)
  for ($y = 0; $y -lt $cell.Height; $y++) {
    $rowOff = $y * $bd.Stride
    for ($x = 0; $x -lt $cell.Width; $x++) {
      if ($bytes[$rowOff + $x * 4 + 3] -gt 10) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $cell.UnlockBits($bd)
  if ($maxX -lt 0) { return $cell.Clone() }
  $pad = 8
  $minX = [Math]::Max(0, $minX - $pad); $minY = [Math]::Max(0, $minY - $pad)
  $maxX = [Math]::Min($cell.Width - 1, $maxX + $pad); $maxY = [Math]::Min($cell.Height - 1, $maxY + $pad)
  $rect = New-Object System.Drawing.Rectangle $minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1)
  return $cell.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

$cw = [int][Math]::Floor($clean.Width / $cols)
$ch = [int][Math]::Floor($clean.Height / $rows)
$i = $start
foreach ($row in 0..($rows - 1)) {
  foreach ($col in 0..($cols - 1)) {
    $rect = New-Object System.Drawing.Rectangle ($col * $cw), ($row * $ch), $cw, $ch
    $cell = $clean.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $trimmed = Get-TrimmedCell $cell
    $trimmed.Save("$root\char-$i.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $trimmed.Dispose(); $cell.Dispose()
    $i++
  }
}
$clean.Dispose()
Write-Output "done: char-$start .. char-$($i - 1)"
