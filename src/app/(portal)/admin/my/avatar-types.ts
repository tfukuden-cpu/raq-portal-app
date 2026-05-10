export type AvatarConfig = {
  bg:         string;  // 背景色キー
  skin:       number;  // 肌色 0-4
  hair_style: number;  // 髪型 0-4
  hair_color: string;  // 髪色キー
  eyes:       number;  // 目 0-4
  mouth:      number;  // 口 0-3
  cheeks:     boolean; // ほっぺ
};

export const DEFAULT_AVATAR: AvatarConfig = {
  bg:         "sky",
  skin:       0,
  hair_style: 0,
  hair_color: "black",
  eyes:       0,
  mouth:      0,
  cheeks:     true,
};

export const BG_OPTIONS = [
  { key: "sky",    label: "スカイ",   cls: "bg-sky-300" },
  { key: "mint",   label: "ミント",   cls: "bg-emerald-300" },
  { key: "rose",   label: "ローズ",   cls: "bg-rose-300" },
  { key: "lemon",  label: "レモン",   cls: "bg-yellow-300" },
  { key: "lavender",label:"ラベンダー",cls: "bg-violet-300" },
  { key: "peach",  label: "ピーチ",   cls: "bg-orange-200" },
  { key: "coral",  label: "コーラル", cls: "bg-pink-300" },
  { key: "slate",  label: "スレート", cls: "bg-slate-300" },
] as const;

export const BG_HEX: Record<string, string> = {
  sky:      "#7DD3FC",
  mint:     "#6EE7B7",
  rose:     "#FDA4AF",
  lemon:    "#FDE047",
  lavender: "#C4B5FD",
  peach:    "#FED7AA",
  coral:    "#F9A8D4",
  slate:    "#CBD5E1",
};

export const SKIN_COLORS = [
  "#FDDBB4", // ライト
  "#F5C5A3", // ナチュラル
  "#E8A87C", // ウォーム
  "#C68642", // タン
  "#8D5524", // ディープ
];

export const HAIR_COLOR_OPTIONS = [
  { key: "black",  label: "ブラック", hex: "#1A1A1A" },
  { key: "brown",  label: "ブラウン", hex: "#6B3A2A" },
  { key: "camel",  label: "キャメル", hex: "#C19A6B" },
  { key: "blonde", label: "ブロンド", hex: "#F0D060" },
  { key: "red",    label: "レッド",   hex: "#C0392B" },
  { key: "orange", label: "オレンジ", hex: "#E67E22" },
  { key: "pink",   label: "ピンク",   hex: "#FF69B4" },
  { key: "silver", label: "シルバー", hex: "#B0BEC5" },
  { key: "blue",   label: "ブルー",   hex: "#3498DB" },
  { key: "purple", label: "パープル", hex: "#8E44AD" },
  { key: "white",  label: "ホワイト", hex: "#E8E8E8" },
  { key: "green",  label: "グリーン", hex: "#27AE60" },
];

export const HAIR_STYLE_LABELS = ["ショート", "ミディアム", "ロング", "ポニーテール", "スパイキー"];
export const EYE_STYLE_LABELS  = ["ノーマル", "ハッピー", "ビッグ", "ウィンク", "スター"];
export const MOUTH_STYLE_LABELS = ["スマイル", "ビッグスマイル", "ニュートラル", "びっくり"];
