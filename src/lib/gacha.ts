/**
 * モンスターガチャの抽選ロジックと表示設定（SPEC.md §6-7）。
 * サーバーアクション（抽選実行）とクライアント（演出の色・ラベル）で共用する。
 * "use server" を付けないこと（同期関数・定数を export するため）。
 *
 * 通貨は login_bonuses.coins。重複所持OK（還元なし）。
 */
import { RPG_MONSTERS, type Monster, type MonsterRarity } from "@/lib/rpg-chars";

/* ── コスト ── */
export const GACHA_COST_SINGLE = 100;
export const GACHA_COST_TEN = 1000;
export const GACHA_TEN_COUNT = 10;
/** 10連で★いくつ以上を1体確定させるか */
export const GACHA_TEN_GUARANTEE = 3 as const;

/* ── 排出率（合計1.0） ── */
export const RARITY_RATES: Record<MonsterRarity, number> = {
  1: 0.50, // ★1 ノーマル（50体）
  2: 0.30, // ★2 レア（40体）
  3: 0.13, // ★3 スーパーレア（30体）
  4: 0.05, // ★4 ウルトラレア（20体）
  5: 0.02, // ★5 レジェンド（10体）
};

/** レアリティごとの表示設定（演出の色・★文字）。色は グレー→緑→青→紫→金 のラダー */
export type RarityInfo = { label: string; stars: string; color: string };
export const RARITY_INFO: Record<MonsterRarity, RarityInfo> = {
  1: { label: "ノーマル",     stars: "★",      color: "#cbd5e1" },
  2: { label: "レア",         stars: "★★",     color: "#6ee7b7" },
  3: { label: "スーパーレア", stars: "★★★",    color: "#93c5fd" },
  4: { label: "ウルトラレア", stars: "★★★★",   color: "#c4b5fd" },
  5: { label: "レジェンド",   stars: "★★★★★", color: "#fcd34d" },
};

/** 1回ぶんの乱数ペア（rarityRoll・pickRoll とも [0,1)）。サーバー側で Math.random() を渡す */
export type GachaRoll = { rarityRoll: number; pickRoll: number };

/** rarityRoll(0〜1) → レアリティ */
export function rarityFromRoll(roll: number): MonsterRarity {
  let acc = 0;
  for (const r of [1, 2, 3, 4, 5] as MonsterRarity[]) {
    acc += RARITY_RATES[r];
    if (roll < acc) return r;
  }
  return 1;
}

/** 指定レアリティのプールから pickRoll(0〜1) で1体選ぶ */
export function pickMonster(rarity: MonsterRarity, pickRoll: number): Monster {
  const pool = RPG_MONSTERS.filter(m => m.rarity === rarity);
  const idx = Math.min(pool.length - 1, Math.floor(pickRoll * pool.length));
  return pool[idx];
}

/** 1回分を引く */
export function drawOne(roll: GachaRoll): Monster {
  return pickMonster(rarityFromRoll(roll.rarityRoll), roll.pickRoll);
}

/** 10連確定枠のレアリティを ★3/★4/★5 の本来比率で按分して決める（roll: 0〜1） */
export function guaranteedRarity(roll: number): MonsterRarity {
  const tiers: MonsterRarity[] = [3, 4, 5];
  const total = tiers.reduce((s, r) => s + RARITY_RATES[r], 0);
  let acc = 0;
  for (const r of tiers) {
    acc += RARITY_RATES[r] / total;
    if (roll < acc) return r;
  }
  return 3;
}

/**
 * count 回ぶんを引く。rolls.length === count を渡すこと。
 * 10連（count === GACHA_TEN_COUNT）で★3以上が1体も出なければ、
 * 最後の1枠を★3以上に置き換える（確定枠）。
 */
export function drawGacha(count: number, rolls: GachaRoll[]): Monster[] {
  const results = rolls.slice(0, count).map(drawOne);

  if (count === GACHA_TEN_COUNT && !results.some(m => m.rarity >= GACHA_TEN_GUARANTEE)) {
    const last = rolls[count - 1] ?? { rarityRoll: 0, pickRoll: 0 };
    // ★3以上（3/4/5）を本来の排出比率で按分して確定枠のレアリティを決める
    results[count - 1] = pickMonster(guaranteedRarity(last.rarityRoll), last.pickRoll);
  }
  return results;
}

/** mode → コストと回数 */
export function gachaPlan(mode: "single" | "ten"): { cost: number; count: number } {
  return mode === "ten"
    ? { cost: GACHA_COST_TEN, count: GACHA_TEN_COUNT }
    : { cost: GACHA_COST_SINGLE, count: 1 };
}
