/**
 * PWA アイコン生成スクリプト（依存パッケージ不要）
 * 使い方: node scripts/generate-icons.mjs
 * 出力: public/icons/icon-192.png, public/icons/icon-512.png
 *
 * ※ 本番では実際のロゴ画像（public/icons/ に配置）に差し替えてください。
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "../public/icons");
mkdirSync(outDir, { recursive: true });

// ── 最小 PNG エンコーダ ──────────────────────────────────────────
function crc32(buf) {
  const table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.allocUnsafe(4);
  crcVal.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, typeBytes, data, crcVal]);
}

/**
 * RGBA ピクセル配列から PNG Buffer を生成
 * @param {Uint8Array} pixels - RGBA 順、幅×高さ×4
 * @param {number} width
 * @param {number} height
 */
function encodePng(pixels, width, height) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB (3=RGB, 6=RGBA) — use 6 for RGBA
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // IDAT: filtered scanlines (filter byte 0 = None per row)
  const rowSize = width * 4;
  const raw = Buffer.allocUnsafe((rowSize + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowSize + 1)] = 0; // filter type: None
    for (let x = 0; x < rowSize; x++) {
      raw[y * (rowSize + 1) + 1 + x] = pixels[y * rowSize + x];
    }
  }
  const compressed = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── アイコン描画（角丸 + "R" 文字）──────────────────────────────
function generateIconPixels(size) {
  const pixels = new Uint8Array(size * size * 4);

  // 背景色: 青グラデーション (#2563eb → #1d4ed8)
  const r1 = 0x25, g1 = 0x63, b1 = 0xeb;
  const r2 = 0x1d, g2 = 0x4e, b2 = 0xd8;

  const radius = Math.round(size * 0.18);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // 角丸判定
      const dx = Math.min(x - radius, 0) + Math.min(size - 1 - x - radius, 0);
      const dy = Math.min(y - radius, 0) + Math.min(size - 1 - y - radius, 0);
      const inRounded = dx * dx + dy * dy <= radius * radius;
      const inRect = x >= radius && x < size - radius || y >= radius && y < size - radius;
      const inside = inRect || inRounded;

      if (inside) {
        const t = (x + y) / (size * 2);
        pixels[idx]     = Math.round(r1 + (r2 - r1) * t);
        pixels[idx + 1] = Math.round(g1 + (g2 - g1) * t);
        pixels[idx + 2] = Math.round(b1 + (b2 - b1) * t);
        pixels[idx + 3] = 255;
      } else {
        // 透明（角の外）
        pixels[idx + 3] = 0;
      }
    }
  }

  // "R" を簡単な bitmap で描画
  // フォントレンダリングは複雑なので、シンプルな矩形で "R" を表現
  const cx = Math.round(size * 0.5);
  const cy = Math.round(size * 0.52);
  const charH = Math.round(size * 0.52);
  const charW = Math.round(size * 0.32);
  const stroke = Math.max(2, Math.round(size * 0.065));
  const midY = cy - charH / 2 + charH * 0.42;
  const topY = Math.round(cy - charH / 2);
  const botY = Math.round(cy + charH / 2);
  const leftX = Math.round(cx - charW / 2);
  const rightX = Math.round(cx + charW / 2);

  // 縦棒（左）
  for (let y = topY; y <= botY; y++) {
    for (let s = 0; s < stroke; s++) {
      setWhite(pixels, size, leftX + s, y);
    }
  }
  // 上横棒
  for (let x = leftX; x <= rightX - stroke; x++) {
    for (let s = 0; s < stroke; s++) {
      setWhite(pixels, size, x, topY + s);
    }
  }
  // 中横棒
  const midYi = Math.round(midY);
  for (let x = leftX; x <= rightX - stroke; x++) {
    for (let s = 0; s < stroke; s++) {
      setWhite(pixels, size, x, midYi + s);
    }
  }
  // 右上縦棒（上半分）
  for (let y = topY; y <= midYi + stroke; y++) {
    for (let s = 0; s < stroke; s++) {
      setWhite(pixels, size, rightX - stroke + s, y);
    }
  }
  // 右下斜め棒（足）— 右上から右下へ
  const legLen = botY - midYi;
  for (let i = 0; i <= legLen; i++) {
    const px = Math.round(leftX + stroke + (rightX - leftX - stroke) * (i / legLen));
    const py = midYi + i;
    for (let s = 0; s < stroke; s++) {
      setWhite(pixels, size, px + s, py);
    }
  }

  return pixels;
}

function setWhite(pixels, size, x, y) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const idx = (y * size + x) * 4;
  pixels[idx] = 255;
  pixels[idx + 1] = 255;
  pixels[idx + 2] = 255;
  pixels[idx + 3] = 255;
}

// ── 生成 & 書き出し ──────────────────────────────────────────────
for (const size of [192, 512]) {
  const pixels = generateIconPixels(size);
  const png = encodePng(pixels, size, size);
  writeFileSync(join(outDir, `icon-${size}.png`), png);
  console.log(`✅ 生成: public/icons/icon-${size}.png (${png.length} bytes)`);
}
console.log("\n✨ 完了！本番ではお好みのロゴ画像に差し替えてください。");
