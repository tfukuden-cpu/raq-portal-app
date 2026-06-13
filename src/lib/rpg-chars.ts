/**
 * RPGキャラクター定義（SPEC.md §6-7）
 *
 * 基本職アバター = 20職業 × 5種族 = 100体（画像 public/rpg/char-1..100.png）。
 *   staffs.rpg_character に charId(1..100) を保存。未選択は社員IDハッシュで自動割当。
 * パートナー（モンスター）= 72体（画像 public/rpg/mon-1..72.png）。ガチャで仲間にする。
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
 * パートナー（モンスター72体・ガチャ専用）
 * mon 1〜72。旧 char-37..108 を mon-1..72 にリネーム（monId = oldId - 36）。
 * レアリティ＝カテゴリ: ★1 かわいい / ★2 妖精亜人・アンデッド / ★3 つよい・魔人悪魔 / ★4 ドラゴン幻獣
 * ──────────────────────────────────────────────────────────────────────── */
export type MonsterRarity = 1 | 2 | 3 | 4;
export type Monster = { id: number; label: string; rarity: MonsterRarity };

export const RPG_MONSTERS: Monster[] = [
  // ── ★1 かわいいモンスター（mon 1〜12 / 旧37〜48） ──
  { id: 1,  label: "スライム",        rarity: 1 },
  { id: 2,  label: "ゴブリン",        rarity: 1 },
  { id: 3,  label: "コボルト",        rarity: 1 },
  { id: 4,  label: "オーク",          rarity: 1 },
  { id: 5,  label: "マンドラゴラ",    rarity: 1 },
  { id: 6,  label: "キラービー",      rarity: 1 },
  { id: 7,  label: "マタンゴ",        rarity: 1 },
  { id: 8,  label: "サボテンダー",    rarity: 1 },
  { id: 9,  label: "こうもり",        rarity: 1 },
  { id: 10, label: "おばけキャンドル", rarity: 1 },
  { id: 11, label: "ミミック",        rarity: 1 },
  { id: 12, label: "かかし",          rarity: 1 },
  // ── ★3 つよいモンスター（mon 13〜24 / 旧49〜60） ──
  { id: 13, label: "ゴーレム",        rarity: 3 },
  { id: 14, label: "ガーゴイル",      rarity: 3 },
  { id: 15, label: "ミノタウロス",    rarity: 3 },
  { id: 16, label: "ワーウルフ",      rarity: 3 },
  { id: 17, label: "リザードマン",    rarity: 3 },
  { id: 18, label: "オーガ",          rarity: 3 },
  { id: 19, label: "トロール",        rarity: 3 },
  { id: 20, label: "サイクロプス",    rarity: 3 },
  { id: 21, label: "デュラハン",      rarity: 3 },
  { id: 22, label: "キメラ",          rarity: 3 },
  { id: 23, label: "オルトロス",      rarity: 3 },
  { id: 24, label: "シェルモンスター", rarity: 3 },
  // ── ★4 ドラゴン・幻獣（mon 25〜36 / 旧61〜72） ──
  { id: 25, label: "レッドドラゴン",  rarity: 4 },
  { id: 26, label: "ブルードラゴン",  rarity: 4 },
  { id: 27, label: "ワイバーン",      rarity: 4 },
  { id: 28, label: "グリフォン",      rarity: 4 },
  { id: 29, label: "ユニコーン",      rarity: 4 },
  { id: 30, label: "フェニックス",    rarity: 4 },
  { id: 31, label: "ケルベロス",      rarity: 4 },
  { id: 32, label: "ヒドラ",          rarity: 4 },
  { id: 33, label: "ペガサス",        rarity: 4 },
  { id: 34, label: "フェンリル",      rarity: 4 },
  { id: 35, label: "ベヒーモス",      rarity: 4 },
  { id: 36, label: "リヴァイアサン",  rarity: 4 },
  // ── ★3 魔人・悪魔（mon 37〜48 / 旧73〜84） ──
  { id: 37, label: "ランプのまじん",  rarity: 3 },
  { id: 38, label: "デーモン",        rarity: 3 },
  { id: 39, label: "イフリート",      rarity: 3 },
  { id: 40, label: "ジン",            rarity: 3 },
  { id: 41, label: "サキュバス",      rarity: 3 },
  { id: 42, label: "インプ",          rarity: 3 },
  { id: 43, label: "バフォメット",    rarity: 3 },
  { id: 44, label: "デビルナイト",    rarity: 3 },
  { id: 45, label: "ダークロード",    rarity: 3 },
  { id: 46, label: "かげのまじん",    rarity: 3 },
  { id: 47, label: "アークデーモン",  rarity: 3 },
  { id: 48, label: "まおう",          rarity: 3 },
  // ── ★2 妖精・亜人（mon 49〜60 / 旧85〜96） ──
  { id: 49, label: "フェアリー",      rarity: 2 },
  { id: 50, label: "エルフ",          rarity: 2 },
  { id: 51, label: "ダークエルフ",    rarity: 2 },
  { id: 52, label: "ドワーフ",        rarity: 2 },
  { id: 53, label: "ホビット",        rarity: 2 },
  { id: 54, label: "マーメイド",      rarity: 2 },
  { id: 55, label: "ハーピー",        rarity: 2 },
  { id: 56, label: "ラミア",          rarity: 2 },
  { id: 57, label: "ケンタウロス",    rarity: 2 },
  { id: 58, label: "サテュロス",      rarity: 2 },
  { id: 59, label: "ノーム",          rarity: 2 },
  { id: 60, label: "ピクシー",        rarity: 2 },
  // ── ★2 アンデッド（mon 61〜72 / 旧97〜108） ──
  { id: 61, label: "スケルトン",      rarity: 2 },
  { id: 62, label: "ゾンビ",          rarity: 2 },
  { id: 63, label: "ゴースト",        rarity: 2 },
  { id: 64, label: "ミイラ",          rarity: 2 },
  { id: 65, label: "ヴァンパイア",    rarity: 2 },
  { id: 66, label: "リッチ",          rarity: 2 },
  { id: 67, label: "デスナイト",      rarity: 2 },
  { id: 68, label: "バンシー",        rarity: 2 },
  { id: 69, label: "ウィスプ",        rarity: 2 },
  { id: 70, label: "パンプキンヘッド", rarity: 2 },
  { id: 71, label: "スノーマン",      rarity: 2 },
  { id: 72, label: "テディベア",      rarity: 2 },
];

export function monsterImg(id: number): string {
  return `/rpg/mon-${id}.png`;
}

export function monsterById(id: number): Monster | undefined {
  return RPG_MONSTERS.find(m => m.id === id);
}
