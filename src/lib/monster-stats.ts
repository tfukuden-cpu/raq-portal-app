/**
 * モンスターのバトル/育成データ（SPEC.md §6-7・バトル機能の土台）。
 * "use server" を付けないこと（同期関数・定数を export するため）。
 *
 * - 6ステータス: HP / こうげき / ぼうぎょ / とくこう / とくぼう / すばやさ
 * - 8属性(+無): 火 水 草 雷 氷 地 風 闇
 * - 5ロール: 基礎能力値の配分が変わる
 * - 基礎能力値はレア度の合計値 × ロール配分 × 個体差(idハッシュ)で算出（baseStats）
 * - レベル(1〜50)＋努力値(EV)で最終能力値を算出（computeStats）
 * - 育成は「所持1体ごと」（staff_partners の行＝インスタンス単位）
 */
import { RPG_MONSTERS, monsterById, type Monster } from "@/lib/rpg-chars";

/* ── ステータス ── */
export type StatKey = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
export type Stats = Record<StatKey, number>;

export const STAT_KEYS: StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];
export const STAT_LABELS: Record<StatKey, string> = {
  hp:  "HP",
  atk: "こうげき",
  def: "ぼうぎょ",
  spa: "とくこう",
  spd: "とくぼう",
  spe: "すばやさ",
};

/* ── 属性（タイプ） ── */
export type Element = "火" | "水" | "草" | "雷" | "氷" | "地" | "風" | "闇" | "無";
export const ELEMENT_INFO: Record<Element, { color: string }> = {
  火: { color: "#f87171" },
  水: { color: "#60a5fa" },
  草: { color: "#4ade80" },
  雷: { color: "#facc15" },
  氷: { color: "#67e8f9" },
  地: { color: "#d6a06a" },
  風: { color: "#86efac" },
  闇: { color: "#a78bfa" },
  無: { color: "#cbd5e1" },
};

/**
 * 属性相性（攻撃属性→防御属性の倍率。1.0が等倍・記載のみ列挙）。
 * バトル実装時に使用（暫定。バランス調整の余地あり）。
 */
export const ELEMENT_STRONG_AGAINST: Record<Element, Element[]> = {
  火: ["草", "氷"],
  水: ["火", "地"],
  草: ["水", "地"],
  雷: ["水", "風"],
  氷: ["草", "風", "地"],
  地: ["火", "雷"],
  風: ["草", "地"],
  闇: ["闇"],
  無: [],
};
export const STRONG_MULT = 1.5;
export const WEAK_MULT = 0.67;
/** 攻撃属性 atk が防御属性 def に与えるダメージ倍率 */
export function elementMultiplier(atk: Element, def: Element): number {
  if (ELEMENT_STRONG_AGAINST[atk]?.includes(def)) return STRONG_MULT;
  if (ELEMENT_STRONG_AGAINST[def]?.includes(atk)) return WEAK_MULT;
  return 1.0;
}

/* ── ロール（基礎値の配分） ── */
export type Role = "アタッカー" | "タンク" | "スピード" | "まほう" | "バランス";
/** [hp, atk, def, spa, spd, spe] の相対ウェイト */
const ROLE_WEIGHTS: Record<Role, Stats> = {
  アタッカー: { hp: 1.0, atk: 1.6, def: 0.8, spa: 0.7, spd: 0.8, spe: 1.3 },
  タンク:     { hp: 1.6, atk: 0.8, def: 1.6, spa: 0.7, spd: 1.4, spe: 0.5 },
  スピード:   { hp: 0.9, atk: 1.2, def: 0.8, spa: 0.9, spd: 0.8, spe: 1.7 },
  まほう:     { hp: 1.0, atk: 0.6, def: 0.9, spa: 1.7, spd: 1.2, spe: 1.0 },
  バランス:   { hp: 1.1, atk: 1.1, def: 1.1, spa: 1.1, spd: 1.1, spe: 1.1 },
};

/** レア度ごとの基礎能力値の合計 */
const RARITY_BASE_TOTAL: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 180,
  2: 240,
  3: 310,
  4: 390,
  5: 470,
};

/* ── レベル＆努力値 ── */
export const LEVEL_MAX = 50;
/** レベルアップごとに獲得する努力値ポイント */
export const EV_PER_LEVEL = 3;
/** 1ステータスあたりの努力値上限 */
export const EV_MAX_PER_STAT = 100;
/** 努力値の合計上限（≒ Lv50 までの獲得量） */
export const EV_MAX_TOTAL = 150;

export type Evs = Stats;
export const ZERO_EVS: Evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/** レベル L に到達するのに必要な累計経験値 */
export function totalExpForLevel(level: number): number {
  let acc = 0;
  for (let l = 1; l < level; l++) acc += Math.round(8 * Math.pow(l, 1.8));
  return acc;
}
/** 次のレベルに必要な経験値（level→level+1） */
export function expToNext(level: number): number {
  if (level >= LEVEL_MAX) return 0;
  return Math.round(8 * Math.pow(level, 1.8));
}
/** 累計経験値からレベルを求める（1〜LEVEL_MAX） */
export function levelFromExp(exp: number): number {
  let lv = 1;
  while (lv < LEVEL_MAX && exp >= totalExpForLevel(lv + 1)) lv++;
  return lv;
}

/** そのレベルで割り振り可能な努力値の総量 */
export function evBudgetForLevel(level: number): number {
  return Math.min(EV_MAX_TOTAL, (level - 1) * EV_PER_LEVEL);
}

/* ── 個体差（idベースの決定的なゆらぎ・±8%） ── */
function variance(id: number, statIndex: number): number {
  const h = ((id * 2654435761) ^ ((statIndex + 1) * 40503)) >>> 0;
  return 0.92 + (h % 17) / 100; // 0.92 〜 1.08
}

/** id → 基礎能力値（レベル1・努力値0の素の値） */
export function baseStats(id: number): Stats {
  const mon = monsterById(id);
  const rarity = (mon?.rarity ?? 1) as 1 | 2 | 3 | 4 | 5;
  const role = monsterBattle(id).role;
  const total = RARITY_BASE_TOTAL[rarity];
  const w = ROLE_WEIGHTS[role];
  const sumW = STAT_KEYS.reduce((s, k) => s + w[k], 0);
  const out = {} as Stats;
  STAT_KEYS.forEach((k, i) => {
    const raw = (total * w[k]) / sumW * variance(id, i);
    out[k] = Math.max(5, Math.round(raw));
  });
  return out;
}

/** 1ステータスのレベル・努力値込みの最終値 */
function statValue(base: number, level: number, ev: number): number {
  return Math.floor(base * (1 + (level - 1) * 0.08)) + ev;
}

/** id・レベル・努力値から最終能力値を算出 */
export function computeStats(id: number, level: number, evs: Partial<Evs> = {}): Stats {
  const base = baseStats(id);
  const out = {} as Stats;
  for (const k of STAT_KEYS) out[k] = statValue(base[k], level, evs[k] ?? 0);
  return out;
}

/** 基礎能力値の合計（図鑑の強さ目安表示用） */
export function baseTotal(id: number): number {
  const b = baseStats(id);
  return STAT_KEYS.reduce((s, k) => s + b[k], 0);
}

/* ────────────────────────────────────────────────────────────────────────
 * 150体ぶんのバトルデータ（属性・ロール・図鑑説明）
 * 画像（MONSTER/sheet1..15.png）の見た目に合わせて設定。id順＝RPG_MONSTERSと一致。
 * ──────────────────────────────────────────────────────────────────────── */
export type MonsterBattle = { id: number; el: Element; role: Role; desc: string };

const BATTLE_DATA: MonsterBattle[] = [
  // ★1
  { id: 1,  el: "地", role: "タンク",     desc: "三つの目で暗闇を見通す、土を掘る小さなモグラ。" },
  { id: 2,  el: "草", role: "スピード",   desc: "驚くと襟を広げて威嚇する、すばしっこいトカゲ。" },
  { id: 3,  el: "地", role: "タンク",     desc: "鉱石の塊が脚を生やした姿。硬い体が自慢。" },
  { id: 4,  el: "闇", role: "スピード",   desc: "ぼろぼろの翼で夜空を舞う小さなコウモリ。" },
  { id: 5,  el: "草", role: "バランス",   desc: "蔦をまとった猫のような魔物。尾がくるりと丸まる。" },
  { id: 6,  el: "水", role: "まほう",     desc: "顔の前に水の泡をたくわえる不思議な甲虫。" },
  { id: 7,  el: "水", role: "タンク",     desc: "珊瑚が育った赤い蟹。鋏は意外と力強い。" },
  { id: 8,  el: "闇", role: "スピード",   desc: "光るものを集める黒い烏。鋭い眼光をもつ。" },
  { id: 9,  el: "地", role: "タンク",     desc: "脇腹の大きな眼で背後も見張る小さな犀。" },
  { id: 10, el: "草", role: "バランス",   desc: "蔦をまとった黄金虫。たくさんの脚で歩き回る。" },
  { id: 11, el: "草", role: "アタッカー", desc: "葉のトゲを背負った小猪。猛然と突進する。" },
  { id: 12, el: "水", role: "まほう",     desc: "一滴の水が命を宿した姿。ぽたぽた雫を落とす。" },
  { id: 13, el: "火", role: "タンク",     desc: "殻に溶岩の熱を秘めたカタツムリ。ゆっくり進む。" },
  { id: 14, el: "地", role: "アタッカー", desc: "鋭いトゲ毛と牙をもつ凶暴なモグラ。" },
  { id: 15, el: "風", role: "アタッカー", desc: "羽がトゲのように尖った猛禽の幼鳥。" },
  { id: 16, el: "水", role: "タンク",     desc: "クラゲの傘をかぶった蟹。傘の中に珊瑚が透ける。" },
  { id: 17, el: "水", role: "アタッカー", desc: "鋭い牙をもつ獺。背に苔の根を生やす。" },
  { id: 18, el: "草", role: "タンク",     desc: "古い切り株に魂が宿った小さな魔物。" },
  { id: 19, el: "地", role: "バランス",   desc: "まんまるな体に大きな鋏をもつ蜘蛛。" },
  { id: 20, el: "氷", role: "スピード",   desc: "氷の毛をまとった猫。冷たい吐息を吐く。" },
  { id: 21, el: "風", role: "スピード",   desc: "蝶のような大きな耳で、かすかな音も聞き逃さない。" },
  { id: 22, el: "地", role: "タンク",     desc: "紫の結晶を背負ったダンゴムシ。丸まって身を守る。" },
  { id: 23, el: "草", role: "バランス",   desc: "背に葦を生やした緑のトカゲ竜の幼体。" },
  { id: 24, el: "草", role: "タンク",     desc: "キノコの傘を背負った蟹。胞子をまき散らす。" },
  { id: 25, el: "地", role: "アタッカー", desc: "背中のトゲを逆立てて威嚇するヤモリ。" },
  { id: 26, el: "火", role: "スピード",   desc: "燃えるような緋色の襟をもつ素早いトカゲ。" },
  { id: 27, el: "地", role: "タンク",     desc: "岩をまとった蛙。大きな口で何でも飲み込む。" },
  { id: 28, el: "地", role: "アタッカー", desc: "二本の大きな牙をもつ球体の蜘蛛。" },
  { id: 29, el: "雷", role: "まほう",     desc: "もこもこの体に電気をためる綿毛の魔物。" },
  { id: 30, el: "草", role: "バランス",   desc: "苔と角を生やした森の鹿。きのこも生える。" },
  { id: 31, el: "水", role: "アタッカー", desc: "陸も歩く魚。よだれを垂らしながら獲物を狙う。" },
  { id: 32, el: "地", role: "タンク",     desc: "背に鉱石を抱えた蜘蛛。脚の力が強い。" },
  { id: 33, el: "草", role: "タンク",     desc: "背中から木の根を生やした白いモグラ。" },
  { id: 34, el: "地", role: "タンク",     desc: "甲羅にトゲを生やした亀。守りが固い。" },
  { id: 35, el: "風", role: "スピード",   desc: "もふもふの体に透明な虫の羽をもつ獣。" },
  { id: 36, el: "地", role: "タンク",     desc: "砂を巻き上げて進む岩甲羅の亀。" },
  { id: 37, el: "草", role: "バランス",   desc: "枝の角を生やした鳥竜。赤い眼が光る。" },
  { id: 38, el: "水", role: "スピード",   desc: "水流のたてがみをもつ猫。素早く泳ぐ。" },
  { id: 39, el: "地", role: "アタッカー", desc: "鋏をもつ節足の甲殻獣。素早く這い回る。" },
  { id: 40, el: "氷", role: "バランス",   desc: "氷の羽をもつ小鳥。冷気をまとう。" },
  { id: 41, el: "地", role: "タンク",     desc: "石の鎧をまとった獣。硬さは折り紙付き。" },
  { id: 42, el: "水", role: "まほう",     desc: "光る提灯で獲物を誘う深海のトカゲ。" },
  { id: 43, el: "地", role: "タンク",     desc: "トゲだらけの殻をもつカタツムリ。" },
  { id: 44, el: "火", role: "スピード",   desc: "尾に火の玉をともす素早いネズミ。" },
  { id: 45, el: "草", role: "バランス",   desc: "苔とキノコをまとった蜘蛛。鋏をもつ。" },
  { id: 46, el: "草", role: "まほう",     desc: "背にキノコを生やした蛙。毒の胞子をまく。" },
  { id: 47, el: "水", role: "まほう",     desc: "紫のヒレをもつイモリ。水辺にひそむ。" },
  { id: 48, el: "草", role: "タンク",     desc: "ぷるぷるした緑の塊。意外としぶとい。" },
  { id: 49, el: "水", role: "アタッカー", desc: "鋭い背ビレと牙をもつ魚竜。" },
  { id: 50, el: "氷", role: "タンク",     desc: "氷晶の装甲をまとったトカゲ。" },
  // ★2
  { id: 51, el: "地", role: "タンク",     desc: "六角形の甲をまとう硬い甲虫。" },
  { id: 52, el: "草", role: "まほう",     desc: "紅いキノコ傘の魔物。牙のある口で笑う。" },
  { id: 53, el: "草", role: "タンク",     desc: "茨のトゲを生やした殻をもつカタツムリ。" },
  { id: 54, el: "水", role: "アタッカー", desc: "鋭い牙が並ぶ青い肉食魚。" },
  { id: 55, el: "氷", role: "アタッカー", desc: "水晶のような棘を逆立てるハリネズミ。" },
  { id: 56, el: "草", role: "スピード",   desc: "緑の羽をもつ森の蜂。素早く飛び回る。" },
  { id: 57, el: "草", role: "アタッカー", desc: "獲物に噛みつく食虫植物の魔物。" },
  { id: 58, el: "地", role: "タンク",     desc: "硬い鱗で全身を守るセンザンコウ。" },
  { id: 59, el: "水", role: "タンク",     desc: "どろどろと這う緑の軟体。目だけが光る。" },
  { id: 60, el: "水", role: "バランス",   desc: "青い斑点の甲羅をもつ蟹。鋏が鋭い。" },
  { id: 61, el: "水", role: "まほう",     desc: "クラゲと蛸が混ざったような海の魔物。" },
  { id: 62, el: "火", role: "タンク",     desc: "背に炎をたぎらせる岩の獣。" },
  { id: 63, el: "草", role: "バランス",   desc: "立派な角をもつ森の大鹿。" },
  { id: 64, el: "闇", role: "まほう",     desc: "紫の炎をまとう骸骨のトカゲ。死してなお動く。" },
  { id: 65, el: "風", role: "タンク",     desc: "もこもこの羊。ふわふわの毛が衝撃を吸う。" },
  { id: 66, el: "地", role: "アタッカー", desc: "背中のトゲと牙で身を守る蛙。" },
  { id: 67, el: "水", role: "タンク",     desc: "貝殻を背負った宿借り。硬い鋏をもつ。" },
  { id: 68, el: "闇", role: "スピード",   desc: "角を生やした闇のフクロウ。眼が妖しく光る。" },
  { id: 69, el: "水", role: "まほう",     desc: "青く発光するクラゲ。漂いながら毒を放つ。" },
  { id: 70, el: "地", role: "タンク",     desc: "トゲ甲羅と牙をもつ亀竜。" },
  { id: 71, el: "草", role: "バランス",   desc: "立派な角をもつ茶色い大鹿。" },
  { id: 72, el: "氷", role: "タンク",     desc: "結晶の棘を生やした獣。冷気をまとう。" },
  { id: 73, el: "水", role: "バランス",   desc: "ヒレをもつ青いトカゲ竜。水を操る。" },
  { id: 74, el: "地", role: "アタッカー", desc: "イガのようなトゲ甲をもつ蟹。" },
  { id: 75, el: "闇", role: "まほう",     desc: "妖しい紫の翅をもつ大きな蛾。鱗粉で惑わす。" },
  { id: 76, el: "水", role: "タンク",     desc: "目柄を伸ばす軟体の魔物。牙をもつ。" },
  { id: 77, el: "地", role: "タンク",     desc: "装甲のように硬い鱗で身を丸めるアルマジロ。" },
  { id: 78, el: "水", role: "アタッカー", desc: "鋸のような牙が並ぶ獰猛な魚。" },
  { id: 79, el: "闇", role: "スピード",   desc: "コウモリの翼をもつ小竜。素早く飛ぶ。" },
  { id: 80, el: "水", role: "まほう",     desc: "光る提灯で誘う毛むくじゃらのアンコウ獣。" },
  { id: 81, el: "地", role: "タンク",     desc: "三本の角と襟をもつ角竜。突進が得意。" },
  { id: 82, el: "火", role: "スピード",   desc: "赤い羽をもつ蜂のような甲虫。" },
  { id: 83, el: "草", role: "まほう",     desc: "頭に花を咲かせる食虫植物の魔物。" },
  { id: 84, el: "地", role: "タンク",     desc: "結晶の棘を生やした岩甲羅の亀。" },
  { id: 85, el: "水", role: "まほう",     desc: "赤い核をもつ青いクラゲ。星のように輝く。" },
  { id: 86, el: "火", role: "スピード",   desc: "オレンジの鶏冠をもつ素早いトカゲ。" },
  { id: 87, el: "闇", role: "まほう",     desc: "紅紫の翅をもつもふもふの蛾。" },
  { id: 88, el: "火", role: "まほう",     desc: "青く燃える炎の精。冷たく揺らめく。" },
  { id: 89, el: "草", role: "アタッカー", desc: "葉のトゲを背負った猪。森を駆ける。" },
  { id: 90, el: "闇", role: "アタッカー", desc: "毒の尾をもつ大きなサソリ。" },
  // ★3
  { id: 91,  el: "火", role: "タンク",     desc: "溶岩の殻をもつ巨大なカタツムリの主。" },
  { id: 92,  el: "氷", role: "アタッカー", desc: "氷の牙とたてがみをもつ白い狼。" },
  { id: 93,  el: "火", role: "タンク",     desc: "溶岩を宿した巨大な切り株の魔物。" },
  { id: 94,  el: "火", role: "アタッカー", desc: "背の大きな帆で熱を集めるトカゲ竜。" },
  { id: 95,  el: "風", role: "スピード",   desc: "虫の羽で宙を舞う紫の蛙。" },
  { id: 96,  el: "水", role: "タンク",     desc: "珊瑚が育った巨大な蟹。鋏は岩をも砕く。" },
  { id: 97,  el: "草", role: "バランス",   desc: "背に羊歯を茂らせた四足の竜。" },
  { id: 98,  el: "地", role: "タンク",     desc: "古代の紋様が刻まれた丸い岩の魔物。" },
  { id: 99,  el: "雷", role: "まほう",     desc: "雷雲をまとった獣。空から雷を落とす。" },
  { id: 100, el: "水", role: "アタッカー", desc: "鋭いヒレと牙をもつ大きな魚竜。" },
  { id: 101, el: "氷", role: "タンク",     desc: "水晶の甲羅をもつ亀。光を反射する。" },
  { id: 102, el: "火", role: "まほう",     desc: "溶けた溶岩のように漂う灼熱のクラゲ。" },
  { id: 103, el: "地", role: "タンク",     desc: "長い牙をもつ巨大な象のような獣。" },
  { id: 104, el: "火", role: "タンク",     desc: "赤い装甲をまとった巨大な甲虫。" },
  { id: 105, el: "闇", role: "まほう",     desc: "翅に大きな目玉模様をもつ蛾。見る者を惑わす。" },
  { id: 106, el: "草", role: "タンク",     desc: "無数の目と触手をもつ歩く植物。" },
  { id: 107, el: "水", role: "バランス",   desc: "珊瑚の棘をまとった海の竜。" },
  { id: 108, el: "地", role: "アタッカー", desc: "巻いた尾と棘の背をもつ大ネズミ。" },
  { id: 109, el: "地", role: "タンク",     desc: "鋼鉄の装甲を組み合わせた機械じみた獣。" },
  { id: 110, el: "火", role: "まほう",     desc: "青い炎が渦巻く霊の塊。冷たく燃える。" },
  { id: 111, el: "闇", role: "まほう",     desc: "提灯のような光る球をいくつもぶら下げた蜘蛛。" },
  { id: 112, el: "草", role: "タンク",     desc: "背に毒キノコを生やした巨大な猪。" },
  { id: 113, el: "火", role: "タンク",     desc: "溶岩の甲羅を背負う巨大な亀。" },
  { id: 114, el: "水", role: "まほう",     desc: "青く輝く東洋の水竜。水流を自在に操る。" },
  { id: 115, el: "水", role: "まほう",     desc: "泡が集まって命を得た青い魔物。" },
  { id: 116, el: "氷", role: "バランス",   desc: "氷晶の角をもつ白い鹿。" },
  { id: 117, el: "地", role: "アタッカー", desc: "鋭い針を逆立てた紫の猪。" },
  { id: 118, el: "地", role: "アタッカー", desc: "大きな顎をもつ凶暴な蟹の魔物。" },
  { id: 119, el: "草", role: "まほう",     desc: "複数の食虫花を伸ばす植物の魔物。" },
  { id: 120, el: "風", role: "スピード",   desc: "虹色の翼をもつ気高い鳥竜。" },
  // ★4
  { id: 121, el: "闇", role: "アタッカー", desc: "紫の炎をまとう漆黒の魔獣。闇を統べる。" },
  { id: 122, el: "氷", role: "タンク",     desc: "青い水晶の鎧をまとう守護の巨人。" },
  { id: 123, el: "闇", role: "まほう",     desc: "無数の目と触手をもつ魔王。視線で射すくめる。" },
  { id: 124, el: "火", role: "タンク",     desc: "背に火山を背負う灼熱の犀。" },
  { id: 125, el: "草", role: "スピード",   desc: "紫と緑の体をもつ魔の蜂。猛毒の針で襲う。" },
  { id: 126, el: "水", role: "まほう",     desc: "提灯のような器官をもつ青い蛟の王。" },
  { id: 127, el: "草", role: "アタッカー", desc: "巨大な食虫花と茨を従える植物の王。" },
  { id: 128, el: "闇", role: "アタッカー", desc: "影と紫煙をまとう魔狼。" },
  { id: 129, el: "水", role: "タンク",     desc: "甲羅から滝を流す苔むした巨大な亀。" },
  { id: 130, el: "水", role: "バランス",   desc: "青く長い体をもつ威厳ある東洋の竜。" },
  { id: 131, el: "氷", role: "アタッカー", desc: "青い結晶の鱗をもつ気高き竜。" },
  { id: 132, el: "闇", role: "まほう",     desc: "豪奢な翅をもつ魔の蝶。鱗粉で幻惑する。" },
  { id: 133, el: "闇", role: "まほう",     desc: "宇宙のような瞳と触手をもつ深淵の魔物。" },
  { id: 134, el: "火", role: "タンク",     desc: "炎を噴き上げる溶岩甲羅の巨亀。" },
  { id: 135, el: "水", role: "バランス",   desc: "海を統べる青緑の長い竜。" },
  { id: 136, el: "草", role: "まほう",     desc: "大輪の花を咲かせ茨を操る植物の王。" },
  { id: 137, el: "氷", role: "アタッカー", desc: "水晶の翅と鎌をもつ蟷螂の魔物。" },
  { id: 138, el: "水", role: "タンク",     desc: "星空の模様をまとい宙を泳ぐ大鯨。" },
  { id: 139, el: "風", role: "アタッカー", desc: "青い嵐と角をまとう竜。" },
  { id: 140, el: "地", role: "タンク",     desc: "全身を棘で覆った針の王。" },
  // ★5
  { id: 141, el: "氷", role: "タンク",     desc: "ダイヤのような青い結晶の鱗をまとう伝説の竜。" },
  { id: 142, el: "闇", role: "まほう",     desc: "荘厳な翅をもつ魔蝶の王。見る者を魅了する。" },
  { id: 143, el: "闇", role: "まほう",     desc: "宇宙の瞳と無数の触手をもつ星座の王。" },
  { id: 144, el: "火", role: "アタッカー", desc: "燃える鬣をなびかせ背に火山を宿す紅蓮の獣王。" },
  { id: 145, el: "水", role: "バランス",   desc: "蒼い海を統べる長大な竜。" },
  { id: 146, el: "草", role: "まほう",     desc: "大輪の花を抱く植物の神。豊穣をもたらす。" },
  { id: 147, el: "氷", role: "アタッカー", desc: "ダイヤの結晶の翅と鎌をもつ究極の蟷螂。" },
  { id: 148, el: "風", role: "タンク",     desc: "星空をまとい大空を悠然と泳ぐ伝説の翼鯨。" },
  { id: 149, el: "火", role: "アタッカー", desc: "青き炎をまとい角を生やした炎の竜。" },
  { id: 150, el: "地", role: "タンク",     desc: "黄金に輝く金剛の棘をまとう最強の獣王。ガチャの頂点。" },
];

const BATTLE_MAP = new Map<number, MonsterBattle>(BATTLE_DATA.map(b => [b.id, b]));
const FALLBACK_BATTLE: Omit<MonsterBattle, "id"> = { el: "無", role: "バランス", desc: "" };

/** id → バトルデータ（属性・ロール・図鑑説明） */
export function monsterBattle(id: number): MonsterBattle {
  return BATTLE_MAP.get(id) ?? { id, ...FALLBACK_BATTLE };
}

/** 図鑑1体ぶんの全情報（identity + battle + 基礎値） */
export type MonsterDex = Monster & MonsterBattle & { base: Stats; baseTotal: number };
export function monsterDex(id: number): MonsterDex | undefined {
  const mon = monsterById(id);
  if (!mon) return undefined;
  const b = monsterBattle(id);
  const base = baseStats(id);
  return { ...mon, ...b, base, baseTotal: STAT_KEYS.reduce((s, k) => s + base[k], 0) };
}

/** 全モンスターの図鑑データ（一覧用） */
export const MONSTER_DEX: MonsterDex[] = RPG_MONSTERS.map(m => monsterDex(m.id)!);
