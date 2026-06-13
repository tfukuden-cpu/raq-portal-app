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
  1: 0.50, // ★1 かわいい
  2: 0.35, // ★2 妖精亜人・アンデッド
  3: 0.12, // ★3 つよい・魔人悪魔
  4: 0.03, // ★4 ドラゴン幻獣
};

/** レアリティごとの表示設定（演出の色・★文字） */
export type RarityInfo = { label: string; stars: string; color: string };
export const RARITY_INFO: Record<MonsterRarity, RarityInfo> = {
  1: { label: "ノーマル",   stars: "★",    color: "#e2e8f0" },
  2: { label: "レア",       stars: "★★",   color: "#86efac" },
  3: { label: "スーパーレア", stars: "★★★",  color: "#c4b5fd" },
  4: { label: "ウルトラレア", stars: "★★★★", color: "#fcd34d" },
};

/** 1回ぶんの乱数ペア（rarityRoll・pickRoll とも [0,1)）。サーバー側で Math.random() を渡す */
export type GachaRoll = { rarityRoll: number; pickRoll: number };

/** rarityRoll(0〜1) → レアリティ */
export function rarityFromRoll(roll: number): MonsterRarity {
  let acc = 0;
  for (const r of [1, 2, 3, 4] as MonsterRarity[]) {
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

/**
 * count 回ぶんを引く。rolls.length === count を渡すこと。
 * 10連（count === GACHA_TEN_COUNT）で★3以上が1体も出なければ、
 * 最後の1枠を★3以上に置き換える（確定枠）。
 */
export function drawGacha(count: number, rolls: GachaRoll[]): Monster[] {
  const results = rolls.slice(0, count).map(drawOne);

  if (count === GACHA_TEN_COUNT && !results.some(m => m.rarity >= GACHA_TEN_GUARANTEE)) {
    const last = rolls[count - 1] ?? { rarityRoll: 0, pickRoll: 0 };
    // ★3 と ★4 の本来比率（12:3）で確定枠のレアリティを決める
    const guaranteed: MonsterRarity = last.rarityRoll < RARITY_RATES[4] / (RARITY_RATES[3] + RARITY_RATES[4]) ? 4 : 3;
    results[count - 1] = pickMonster(guaranteed, last.pickRoll);
  }
  return results;
}

/** mode → コストと回数 */
export function gachaPlan(mode: "single" | "ten"): { cost: number; count: number } {
  return mode === "ten"
    ? { cost: GACHA_COST_TEN, count: GACHA_TEN_COUNT }
    : { cost: GACHA_COST_SINGLE, count: 1 };
}
