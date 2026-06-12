# RPGキャラスプライトシート再分割スクリプト（連結成分ベース）
# グリッド単純切りだとマス境界をはみ出したキャラ（翼など）が断片化するため、
# 背景除去 → 連結成分ラベリング → 各成分を重心のマスに帰属 → マスごとに合成して切り出す。
# 使い方: $env:SHEET / $env:STARTIDX / $env:COLS / $env:ROWS を設定してから実行
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'SpriteResplitter').Type) {
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;

public static class SpriteResplitter
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

    // 連結成分ラベリング(8近傍) → 重心のマスに帰属 → マスごとに切り出し
    // 戻り値: 警告メッセージのリスト（空なら問題なし）
    public static List<string> SplitByComponents(Bitmap clean, string root, int start, int cols, int rows)
    {
        var warnings = new List<string>();
        int w = clean.Width, h = clean.Height;
        double cw = (double)w / cols, ch = (double)h / rows;

        var data = clean.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int stride = data.Stride;
        byte[] px = new byte[stride * h];
        System.Runtime.InteropServices.Marshal.Copy(data.Scan0, px, 0, px.Length);
        clean.UnlockBits(data);

        int[] label = new int[w * h];
        for (int i = 0; i < label.Length; i++) label[i] = -1;
        var comps = new List<long[]>(); // sumX, sumY, count, minX, minY, maxX, maxY
        var stack = new Stack<int>();

        Func<int, bool> solid = (idx) => px[(idx / w) * stride + (idx % w) * 4 + 3] > 10;

        for (int p = 0; p < w * h; p++)
        {
            if (label[p] >= 0 || !solid(p)) continue;
            int id = comps.Count;
            long[] c = new long[] { 0, 0, 0, w, h, -1, -1 };
            stack.Push(p); label[p] = id;
            while (stack.Count > 0)
            {
                int q = stack.Pop();
                int qx = q % w, qy = q / w;
                c[0] += qx; c[1] += qy; c[2]++;
                if (qx < c[3]) c[3] = qx; if (qy < c[4]) c[4] = qy;
                if (qx > c[5]) c[5] = qx; if (qy > c[6]) c[6] = qy;
                for (int dy = -1; dy <= 1; dy++)
                for (int dx = -1; dx <= 1; dx++)
                {
                    if (dx == 0 && dy == 0) continue;
                    int nx = qx + dx, ny = qy + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    int n = ny * w + nx;
                    if (label[n] >= 0 || !solid(n)) continue;
                    label[n] = id; stack.Push(n);
                }
            }
            comps.Add(c);
        }

        // 各成分を重心のマスに帰属
        int[] compCell = new int[comps.Count];
        for (int i = 0; i < comps.Count; i++)
        {
            long[] c = comps[i];
            double gx = (double)c[0] / c[2], gy = (double)c[1] / c[2];
            int col = Math.Min(cols - 1, Math.Max(0, (int)(gx / cw)));
            int row = Math.Min(rows - 1, Math.Max(0, (int)(gy / ch)));
            compCell[i] = row * cols + col;
            double bw = c[5] - c[3] + 1, bh = c[6] - c[4] + 1;
            if (bw > cw * 1.7 || bh > ch * 1.7)
                warnings.Add(string.Format("component {0} too large ({1}x{2}) — characters may be touching; cell {3}", i, bw, bh, compCell[i]));
        }

        // マスごとに bbox を計算して切り出し
        int pad = 8;
        for (int cell = 0; cell < cols * rows; cell++)
        {
            int minX = w, minY = h, maxX = -1, maxY = -1;
            for (int i = 0; i < comps.Count; i++)
            {
                if (compCell[i] != cell) continue;
                long[] c = comps[i];
                if (c[3] < minX) minX = (int)c[3]; if (c[4] < minY) minY = (int)c[4];
                if (c[5] > maxX) maxX = (int)c[5]; if (c[6] > maxY) maxY = (int)c[6];
            }
            int outIdx = start + cell;
            if (maxX < 0) { warnings.Add(string.Format("cell {0} (char-{1}) has no pixels — NOT saved", cell, outIdx)); continue; }

            minX = Math.Max(0, minX - pad); minY = Math.Max(0, minY - pad);
            maxX = Math.Min(w - 1, maxX + pad); maxY = Math.Min(h - 1, maxY + pad);
            int ow = maxX - minX + 1, oh = maxY - minY + 1;

            var outBmp = new Bitmap(ow, oh, PixelFormat.Format32bppArgb);
            var od = outBmp.LockBits(new Rectangle(0, 0, ow, oh), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            byte[] opx = new byte[od.Stride * oh];
            for (int y = minY; y <= maxY; y++)
            for (int x = minX; x <= maxX; x++)
            {
                int li = label[y * w + x];
                if (li < 0 || compCell[li] != cell) continue; // 他マスの成分は含めない
                int so = y * stride + x * 4;
                int dofs = (y - minY) * od.Stride + (x - minX) * 4;
                opx[dofs] = px[so]; opx[dofs + 1] = px[so + 1]; opx[dofs + 2] = px[so + 2]; opx[dofs + 3] = px[so + 3];
            }
            System.Runtime.InteropServices.Marshal.Copy(opx, 0, od.Scan0, opx.Length);
            outBmp.UnlockBits(od);
            outBmp.Save(System.IO.Path.Combine(root, "char-" + outIdx + ".png"), ImageFormat.Png);
            outBmp.Dispose();
        }
        return warnings;
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
$clean = [SpriteResplitter]::RemoveBackground($src)
$src.Dispose()

$warnings = [SpriteResplitter]::SplitByComponents($clean, $root, $start, $cols, $rows)
$clean.Dispose()

foreach ($warning in $warnings) { Write-Output "WARN [$sheet]: $warning" }
Write-Output "done: $sheet -> char-$start .. char-$($start + $cols * $rows - 1)"
