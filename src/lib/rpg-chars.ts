/**
 * RPGキャラクター定義（休憩室・myページ共用）
 * 画像: public/rpg/char-{id}.png（透過PNG・ChatGPT生成をスクリプトで分割）
 * id は char ファイル番号と一致させること（DBの staffs.rpg_character に保存される）
 */
export type RpgChar = { id: number; label: string };

export const RPG_CHARS: RpgChar[] = [
  // ── 基本職（初期6体） ──
  { id: 1,  label: "ゆうしゃ" },
  { id: 2,  label: "せんし" },
  { id: 3,  label: "まほうつかい" },
  { id: 4,  label: "そうりょ" },
  { id: 5,  label: "ぶとうか" },
  { id: 6,  label: "あそびにん" },
  // ── 追加職（第2弾） ──
  { id: 7,  label: "けんじゃ" },
  { id: 8,  label: "とうぞく" },
  { id: 9,  label: "しょうにん" },
  { id: 10, label: "おどりこ" },
  { id: 11, label: "きし" },
  { id: 12, label: "ゆみつかい" },
  // ── 上級職 ──
  { id: 13, label: "パラディン" },
  { id: 14, label: "バーサーカー" },
  { id: 15, label: "にんじゃ" },
  { id: 16, label: "さむらい" },
  { id: 17, label: "りゅうきし" },
  { id: 18, label: "ハンター" },
  { id: 19, label: "かいぞく" },
  { id: 20, label: "ガンナー" },
  { id: 21, label: "れんきんじゅつし" },
  { id: 22, label: "ぎんゆうしじん" },
  { id: 23, label: "モンク" },
  { id: 24, label: "ネクロマンサー" },
  // ── 魔法・支援職 ──
  { id: 25, label: "ドルイド" },
  { id: 26, label: "シャーマン" },
  { id: 27, label: "ビショップ" },
  { id: 28, label: "サモナー" },
  { id: 29, label: "タイムメイジ" },
  { id: 30, label: "ダークナイト" },
  { id: 31, label: "ホーリーナイト" },
  { id: 32, label: "うらないし" },
  { id: 33, label: "がくしゃ" },
  { id: 34, label: "くすし" },
  { id: 35, label: "ふなのり" },
  { id: 36, label: "りょうりにん" },
  // ── かわいいモンスター ──
  { id: 37, label: "スライム" },
  { id: 38, label: "ゴブリン" },
  { id: 39, label: "コボルト" },
  { id: 40, label: "オーク" },
  { id: 41, label: "マンドラゴラ" },
  { id: 42, label: "キラービー" },
  { id: 43, label: "マタンゴ" },
  { id: 44, label: "サボテンダー" },
  { id: 45, label: "こうもり" },
  { id: 46, label: "おばけキャンドル" },
  { id: 47, label: "ミミック" },
  { id: 48, label: "かかし" },
  // ── つよいモンスター ──
  { id: 49, label: "ゴーレム" },
  { id: 50, label: "ガーゴイル" },
  { id: 51, label: "ミノタウロス" },
  { id: 52, label: "ワーウルフ" },
  { id: 53, label: "リザードマン" },
  { id: 54, label: "オーガ" },
  { id: 55, label: "トロール" },
  { id: 56, label: "サイクロプス" },
  { id: 57, label: "デュラハン" },
  { id: 58, label: "キメラ" },
  { id: 59, label: "オルトロス" },
  { id: 60, label: "シェルモンスター" },
  // ── ドラゴン・幻獣 ──
  { id: 61, label: "レッドドラゴン" },
  { id: 62, label: "ブルードラゴン" },
  { id: 63, label: "ワイバーン" },
  { id: 64, label: "グリフォン" },
  { id: 65, label: "ユニコーン" },
  { id: 66, label: "フェニックス" },
  { id: 67, label: "ケルベロス" },
  { id: 68, label: "ヒドラ" },
  { id: 69, label: "ペガサス" },
  { id: 70, label: "フェンリル" },
  { id: 71, label: "ベヒーモス" },
  { id: 72, label: "リヴァイアサン" },
  // ── 魔人・悪魔 ──
  { id: 73, label: "ランプのまじん" },
  { id: 74, label: "デーモン" },
  { id: 75, label: "イフリート" },
  { id: 76, label: "ジン" },
  { id: 77, label: "サキュバス" },
  { id: 78, label: "インプ" },
  { id: 79, label: "バフォメット" },
  { id: 80, label: "デビルナイト" },
  { id: 81, label: "ダークロード" },
  { id: 82, label: "かげのまじん" },
  { id: 83, label: "アークデーモン" },
  { id: 84, label: "まおう" },
  // ── 妖精・亜人 ──
  { id: 85, label: "フェアリー" },
  { id: 86, label: "エルフ" },
  { id: 87, label: "ダークエルフ" },
  { id: 88, label: "ドワーフ" },
  { id: 89, label: "ホビット" },
  { id: 90, label: "マーメイド" },
  { id: 91, label: "ハーピー" },
  { id: 92, label: "ラミア" },
  { id: 93, label: "ケンタウロス" },
  { id: 94, label: "サテュロス" },
  { id: 95, label: "ノーム" },
  { id: 96, label: "ピクシー" },
  // ── アンデッド・なかまたち ──
  { id: 97,  label: "スケルトン" },
  { id: 98,  label: "ゾンビ" },
  { id: 99,  label: "ゴースト" },
  { id: 100, label: "ミイラ" },
  { id: 101, label: "ヴァンパイア" },
  { id: 102, label: "リッチ" },
  { id: 103, label: "デスナイト" },
  { id: 104, label: "バンシー" },
  { id: 105, label: "ウィスプ" },
  { id: 106, label: "パンプキンヘッド" },
  { id: 107, label: "スノーマン" },
  { id: 108, label: "テディベア" },
];

export function rpgCharImg(id: number): string {
  return `/rpg/char-${id}.png`;
}

/** 本人が選んだキャラ優先。未選択なら staffId ハッシュで自動割当 */
export function rpgCharFor(staffId: string, overrideId?: number | null): RpgChar {
  if (overrideId) {
    const found = RPG_CHARS.find(c => c.id === overrideId);
    if (found) return found;
  }
  let h = 0;
  for (const ch of staffId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return RPG_CHARS[h % RPG_CHARS.length];
}
