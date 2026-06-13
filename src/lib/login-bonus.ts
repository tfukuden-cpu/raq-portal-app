/**
 * ログインボーナス（毎日1回・コインのガチャ）の抽選テーブルと表示設定。
 * サーバーアクション（抽選）とクライアント（演出の色・ラベル）で共用する。
 * "use server" を付けないこと（同期関数を export するため）。
 */
export type BonusTier = "common" | "uncommon" | "rare" | "epic" | "jackpot";

export type BonusTierInfo = {
  coins: number;
  /** 演出の見出し */
  label: string;
  /** コイン文字・光彩の色 */
  color: string;
};

export const BONUS_TIERS: Record<BonusTier, BonusTierInfo> = {
  common:   { coins: 10,  label: "コインを てにいれた！",   color: "#e2e8f0" },
  uncommon: { coins: 30,  label: "おっ、ラッキー！",        color: "#86efac" },
  rare:     { coins: 50,  label: "おたからを はっけん！",   color: "#c4b5fd" },
  epic:     { coins: 100, label: "だいきち！ ごうかボーナス！", color: "#fcd34d" },
  jackpot:  { coins: 500, label: "★ だいあたり！ ★",        color: "#fca5a5" },
};

/**
 * 0〜1 の乱数からティアを決める（サーバーアクションで Math.random() を渡す）。
 * 期待値はおよそ 10*0.5 + 30*0.28 + 50*0.15 + 100*0.05 + 500*0.02 = 35.9 コイン/日
 */
export function rollBonus(rnd: number): BonusTier {
  if (rnd < 0.02) return "jackpot";  //  2%
  if (rnd < 0.07) return "epic";     //  5%
  if (rnd < 0.22) return "rare";     // 15%
  if (rnd < 0.50) return "uncommon"; // 28%
  return "common";                   // 50%
}
