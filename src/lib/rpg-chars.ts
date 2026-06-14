/**
 * RPGキャラクター定義（SPEC.md §6-7）
 *
 * 基本職アバター = 20職業 × 5種族 = 100体（画像 public/rpg/char-1..100.png）。
 *   staffs.rpg_character に charId(1..100) を保存。未選択は社員IDハッシュで自動割当。
 * パートナー（モンスター）= 150体（画像 public/rpg/mon-1..150.png）。ガチャで仲間にする。
 *   レアリティ5段階（★1〜★5）。id 昇順＝レア度昇順。排出率は src/lib/gacha.ts。
 *
 * 旧API（RPG_CHARS / rpgCharFor / rpgCharImg）は新100体システムに差し替え済み。
 * シグネチャは互換のまま（My・AppNav・ホーム・打刻端末・休憩室がそのまま動く）。
 */
export type RpgChar = { id: number; label: string };

/* ────────────────────────────────────────────────────────────────────────
 * 基本職アバター（20職業 × 5種族 = 100体）
 * charId = (jobIndex-1)*5 + raceIndex（1..100）／画像 char-{charId}.png
 * ──────────────────────────────────────────────────────────────────────── */

/** 20職業（jobIndex 1〜20・順序固定） */
export const RPG_JOBS = [
  "ゆうしゃ", "せんし", "まほうつかい", "そうりょ", "ぶとうか",
  "とうぞく", "ゆみつかい", "きし", "パラディン", "けんじゃ",
  "おどりこ", "しょうにん", "にんじゃ", "さむらい", "りゅうきし",
  "ガンナー", "ネクロマンサー", "ドルイド", "うらないし", "あそびにん",
] as const;

/** 5種族（raceIndex 1〜5） */
export const RPG_RACES = ["ヒューマン", "エルフ", "ドワーフ", "じゅうじん", "りゅうじん"] as const;

export type JobCharInfo = {
  /** 1〜100 */
  id: number;
  /** 1〜20 */
  jobIndex: number;
  /** 1〜5 */
  raceIndex: number;
  jobLabel: string;
  raceLabel: string;
  /** 「{種族}の{職業}」 例: エルフのまほうつかい */
  label: string;
};

/** 職(1〜20)・種族(1〜5) → charId(1〜100) */
export function jobCharId(jobIndex: number, raceIndex: number): number {
  return (jobIndex - 1) * 5 + raceIndex;
}

/** charId(1〜100) → 職業・種族・ラベル */
export function jobCharInfo(id: number): JobCharInfo {
  const clamped = Math.min(100, Math.max(1, id));
  const jobIndex = Math.floor((clamped - 1) / 5) + 1;
  const raceIndex = ((clamped - 1) % 5) + 1;
  const jobLabel = RPG_JOBS[jobIndex - 1];
  const raceLabel = RPG_RACES[raceIndex - 1];
  return { id: clamped, jobIndex, raceIndex, jobLabel, raceLabel, label: `${raceLabel}の${jobLabel}` };
}

export function jobCharImg(id: number): string {
  return `/rpg/char-${id}.png`;
}

/** 本人選択(1〜100)優先・未選択は staffId ハッシュで 1〜100 に自動割当 */
export function jobCharIdFor(staffId: string, overrideId?: number | null): number {
  if (overrideId && overrideId >= 1 && overrideId <= 100) return overrideId;
  let h = 0;
  for (const ch of staffId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 100) + 1;
}

/** 全100体（id=charId, label="種族の職業"）。キャラ選択UI・一覧表示用 */
export const RPG_CHARS: RpgChar[] = Array.from({ length: 100 }, (_, i) => {
  const info = jobCharInfo(i + 1);
  return { id: info.id, label: info.label };
});

/**
 * 画像URL。基本職アバターは char-{id}.png。
 * （旧シグネチャ互換。新コードは jobCharImg を使ってもよい＝同じ結果）
 */
export function rpgCharImg(id: number): string {
  return `/rpg/char-${id}.png`;
}

/**
 * 本人が選んだキャラ優先。未選択（または範囲外）なら staffId ハッシュで自動割当。
 * 旧シグネチャ互換（戻り値 {id,label}）。中身は新100体システム。
 */
export function rpgCharFor(staffId: string, overrideId?: number | null): RpgChar {
  const id = jobCharIdFor(staffId, overrideId);
  return RPG_CHARS[id - 1];
}

/* ────────────────────────────────────────────────────────────────────────
 * パートナー（モンスター150体・ガチャ専用）
 * mon 1〜150（画像 public/rpg/mon-1..150.png）。ガチャで仲間にする。
 * レアリティ5段階＝体数ピラミッド:
 *   ★1 ノーマル(1〜50・50体) / ★2 レア(51〜90・40体) / ★3 スーパーレア(91〜120・30体)
 *   ★4 ウルトラレア(121〜140・20体) / ★5 レジェンド(141〜150・10体)
 * id は連番（id 昇順＝レア度昇順）。排出率は src/lib/gacha.ts の RARITY_RATES。
 * ラベルは実際の生成画像（MONSTER/sheet1..15.png）に合わせた造語名。各シート左上→右→下＝id順。
 * ──────────────────────────────────────────────────────────────────────── */
export type MonsterRarity = 1 | 2 | 3 | 4 | 5;
export type Monster = { id: number; label: string; rarity: MonsterRarity };

export const RPG_MONSTERS: Monster[] = [
  // ── ★1 ノーマル（mon 1〜50） ──
  // S1 (1-10)
  { id: 1,  label: "ミツメモグラ",   rarity: 1 },
  { id: 2,  label: "エリマキリザ",   rarity: 1 },
  { id: 3,  label: "ガンセキマル",   rarity: 1 },
  { id: 4,  label: "ヤミコウモリ",   rarity: 1 },
  { id: 5,  label: "ツタネコ",       rarity: 1 },
  { id: 6,  label: "アワダマムシ",   rarity: 1 },
  { id: 7,  label: "サンゴガニ",     rarity: 1 },
  { id: 8,  label: "クロハガラス",   rarity: 1 },
  { id: 9,  label: "メダマサイ",     rarity: 1 },
  { id: 10, label: "ツタコガネ",     rarity: 1 },
  // S2 (11-20)
  { id: 11, label: "ハトゲイノコ",   rarity: 1 },
  { id: 12, label: "シズクダマ",     rarity: 1 },
  { id: 13, label: "ヨウガンマイマイ", rarity: 1 },
  { id: 14, label: "トゲモグラ",     rarity: 1 },
  { id: 15, label: "トゲバネドリ",   rarity: 1 },
  { id: 16, label: "クラゲガニ",     rarity: 1 },
  { id: 17, label: "キバウソ",       rarity: 1 },
  { id: 18, label: "キリカブこぞう", rarity: 1 },
  { id: 19, label: "マルグモ",       rarity: 1 },
  { id: 20, label: "コオリネコ",     rarity: 1 },
  // S3 (21-30)
  { id: 21, label: "ハネミミネズミ", rarity: 1 },
  { id: 22, label: "クリスタダンゴ", rarity: 1 },
  { id: 23, label: "アシトカゲ",     rarity: 1 },
  { id: 24, label: "キノコガニ",     rarity: 1 },
  { id: 25, label: "トゲヤモリ",     rarity: 1 },
  { id: 26, label: "ヒオドシリザ",   rarity: 1 },
  { id: 27, label: "イワガエル",     rarity: 1 },
  { id: 28, label: "キバグモ",       rarity: 1 },
  { id: 29, label: "デンキワタ",     rarity: 1 },
  { id: 30, label: "コケジカ",       rarity: 1 },
  // S4 (31-40)
  { id: 31, label: "ヨダレウオ",     rarity: 1 },
  { id: 32, label: "コウセキグモ",   rarity: 1 },
  { id: 33, label: "ネモグラ",       rarity: 1 },
  { id: 34, label: "トゲガメ",       rarity: 1 },
  { id: 35, label: "モフバネ",       rarity: 1 },
  { id: 36, label: "スナガメ",       rarity: 1 },
  { id: 37, label: "エダツノドリ",   rarity: 1 },
  { id: 38, label: "ミズネコ",       rarity: 1 },
  { id: 39, label: "ハサミムカデ",   rarity: 1 },
  { id: 40, label: "コオリドリ",     rarity: 1 },
  // S5 (41-50)
  { id: 41, label: "イシヨロイ",     rarity: 1 },
  { id: 42, label: "チョウチントカゲ", rarity: 1 },
  { id: 43, label: "トゲマイマイ",   rarity: 1 },
  { id: 44, label: "ヒダマネズミ",   rarity: 1 },
  { id: 45, label: "キノコグモ",     rarity: 1 },
  { id: 46, label: "キノコガエル",   rarity: 1 },
  { id: 47, label: "ムラサキイモリ", rarity: 1 },
  { id: 48, label: "ミドロ",         rarity: 1 },
  { id: 49, label: "セビレウオ",     rarity: 1 },
  { id: 50, label: "コオリヨロイ",   rarity: 1 },
  // ── ★2 レア（mon 51〜90） ──
  // S6 (51-60)
  { id: 51, label: "ロッカクムシ",   rarity: 2 },
  { id: 52, label: "ベニカサ",       rarity: 2 },
  { id: 53, label: "イバラマイマイ", rarity: 2 },
  { id: 54, label: "アオキバウオ",   rarity: 2 },
  { id: 55, label: "スイショウハリ", rarity: 2 },
  { id: 56, label: "モリバチ",       rarity: 2 },
  { id: 57, label: "カミツキソウ",   rarity: 2 },
  { id: 58, label: "ヨロイセンザン", rarity: 2 },
  { id: 59, label: "ヌメドロ",       rarity: 2 },
  { id: 60, label: "アオボシガニ",   rarity: 2 },
  // S7 (61-70)
  { id: 61, label: "クラゲダコ",     rarity: 2 },
  { id: 62, label: "ホムライシ",     rarity: 2 },
  { id: 63, label: "オオヅノジカ",   rarity: 2 },
  { id: 64, label: "ホネトカゲ",     rarity: 2 },
  { id: 65, label: "ワタヒツジ",     rarity: 2 },
  { id: 66, label: "トゲガエル",     rarity: 2 },
  { id: 67, label: "ヤドカニ",       rarity: 2 },
  { id: 68, label: "ツノフクロウ",   rarity: 2 },
  { id: 69, label: "アオクラゲ",     rarity: 2 },
  { id: 70, label: "キバガメ",       rarity: 2 },
  // S8 (71-80)
  { id: 71, label: "オオジカ",       rarity: 2 },
  { id: 72, label: "クリスタケモノ", rarity: 2 },
  { id: 73, label: "ミズリュウ",     rarity: 2 },
  { id: 74, label: "イガグリガニ",   rarity: 2 },
  { id: 75, label: "ヨウガ",         rarity: 2 },
  { id: 76, label: "メダマドロ",     rarity: 2 },
  { id: 77, label: "ヨロイアルマ",   rarity: 2 },
  { id: 78, label: "ノコギリウオ",   rarity: 2 },
  { id: 79, label: "コウモリリュウ", rarity: 2 },
  { id: 80, label: "アンコウジュウ", rarity: 2 },
  // S9 (81-90)
  { id: 81, label: "ミツヅノ",       rarity: 2 },
  { id: 82, label: "アカハネムシ",   rarity: 2 },
  { id: 83, label: "ハナクイ",       rarity: 2 },
  { id: 84, label: "イワガメ",       rarity: 2 },
  { id: 85, label: "ホシクラゲ",     rarity: 2 },
  { id: 86, label: "トサカトカゲ",   rarity: 2 },
  { id: 87, label: "ベニガ",         rarity: 2 },
  { id: 88, label: "アオホムラ",     rarity: 2 },
  { id: 89, label: "モリイノ",       rarity: 2 },
  { id: 90, label: "ドクサソリ",     rarity: 2 },
  // ── ★3 スーパーレア（mon 91〜120） ──
  // S10 (91-100)
  { id: 91,  label: "ヌシマイマイ",   rarity: 3 },
  { id: 92,  label: "ヒョウガロウ",   rarity: 3 },
  { id: 93,  label: "ヨウガンカブ",   rarity: 3 },
  { id: 94,  label: "ホバンリュウ",   rarity: 3 },
  { id: 95,  label: "ハネガエル",     rarity: 3 },
  { id: 96,  label: "サンゴオオガニ", rarity: 3 },
  { id: 97,  label: "シダリュウ",     rarity: 3 },
  { id: 98,  label: "イワダマ",       rarity: 3 },
  { id: 99,  label: "ライウンジュウ", rarity: 3 },
  { id: 100, label: "オオウオリュウ", rarity: 3 },
  // S11 (101-110)
  { id: 101, label: "スイショウガメ", rarity: 3 },
  { id: 102, label: "マグマクラゲ",   rarity: 3 },
  { id: 103, label: "オオキバジュウ", rarity: 3 },
  { id: 104, label: "アカヨロイムシ", rarity: 3 },
  { id: 105, label: "メダマガ",       rarity: 3 },
  { id: 106, label: "ヒャクメソウ",   rarity: 3 },
  { id: 107, label: "サンゴリュウ",   rarity: 3 },
  { id: 108, label: "ハリオネズミ",   rarity: 3 },
  { id: 109, label: "コウテツジュウ", rarity: 3 },
  { id: 110, label: "アオビダマ",     rarity: 3 },
  // S12 (111-120)
  { id: 111, label: "チョウチングモ", rarity: 3 },
  { id: 112, label: "キノコイノシシ", rarity: 3 },
  { id: 113, label: "ヨウガンガメ",   rarity: 3 },
  { id: 114, label: "スイリュウ",     rarity: 3 },
  { id: 115, label: "ミナワ",         rarity: 3 },
  { id: 116, label: "ヒョウショウジカ", rarity: 3 },
  { id: 117, label: "ハリイノシシ",   rarity: 3 },
  { id: 118, label: "クチバケガニ",   rarity: 3 },
  { id: 119, label: "クビナガバナ",   rarity: 3 },
  { id: 120, label: "ニジドリ",       rarity: 3 },
  // ── ★4 ウルトラレア（mon 121〜140） ──
  // S13 (121-130)
  { id: 121, label: "ヤミエンマ",     rarity: 4 },
  { id: 122, label: "クリスタロード", rarity: 4 },
  { id: 123, label: "ヒャクメオウ",   rarity: 4 },
  { id: 124, label: "エンザイ",       rarity: 4 },
  { id: 125, label: "マバチ",         rarity: 4 },
  { id: 126, label: "ミズチオウ",     rarity: 4 },
  { id: 127, label: "クイツキオウ",   rarity: 4 },
  { id: 128, label: "ヤミロウ",       rarity: 4 },
  { id: 129, label: "タキガメ",       rarity: 4 },
  { id: 130, label: "ソウリュウ",     rarity: 4 },
  // S14 (131-140)
  { id: 131, label: "スイショウリュウ", rarity: 4 },
  { id: 132, label: "マチョウ",       rarity: 4 },
  { id: 133, label: "アビスアイ",     rarity: 4 },
  { id: 134, label: "エンガメ",       rarity: 4 },
  { id: 135, label: "ウミリュウ",     rarity: 4 },
  { id: 136, label: "ハナオウ",       rarity: 4 },
  { id: 137, label: "スイショウカマ", rarity: 4 },
  { id: 138, label: "ヨゾラクジラ",   rarity: 4 },
  { id: 139, label: "セイランリュウ", rarity: 4 },
  { id: 140, label: "イバラオウ",     rarity: 4 },
  // ── ★5 レジェンド（mon 141〜150） ──
  // S15 (141-150)
  { id: 141, label: "ダイヤリュウ",   rarity: 5 },
  { id: 142, label: "マオウチョウ",   rarity: 5 },
  { id: 143, label: "セイザオウ",     rarity: 5 },
  { id: 144, label: "グレンオウ",     rarity: 5 },
  { id: 145, label: "ソウカイリュウ", rarity: 5 },
  { id: 146, label: "ハナガミオウ",   rarity: 5 },
  { id: 147, label: "ダイヤカマ",     rarity: 5 },
  { id: 148, label: "ソラクジラ",     rarity: 5 },
  { id: 149, label: "カエンリュウ",   rarity: 5 },
  { id: 150, label: "コンゴウオウ",   rarity: 5 },
];

export function monsterImg(id: number): string {
  return `/rpg/mon-${id}.png`;
}

export function monsterById(id: number): Monster | undefined {
  return RPG_MONSTERS.find(m => m.id === id);
}
