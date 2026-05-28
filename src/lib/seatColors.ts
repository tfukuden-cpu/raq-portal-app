/**
 * 座席表セクション色分けユーティリティ
 * ShiftEditGrid の SECTION_SHIFT_COLORS と同じカラーテーブルを使用
 */

export type SeatColorSet = {
  early:  string; // 早番 — 薄色
  late:   string; // 遅番 — 濃色
  def:    string; // デフォルト（早番/遅番なし）
  border: string; // ボーダー色（インジケーター用）
  text:   string; // 前景テキスト色
};

export const SEAT_SECTION_COLORS: Record<string, SeatColorSet> = {
  "SV":       { early: "bg-blue-100 dark:bg-blue-900/50",       late: "bg-blue-300 dark:bg-blue-700/70",       def: "bg-blue-200 dark:bg-blue-800/60",       border: "border-blue-400 dark:border-blue-500",     text: "text-blue-900 dark:text-blue-100" },
  "査定":     { early: "bg-emerald-100 dark:bg-emerald-900/50",  late: "bg-emerald-300 dark:bg-emerald-700/70",  def: "bg-emerald-200 dark:bg-emerald-800/60",  border: "border-emerald-400 dark:border-emerald-500", text: "text-emerald-900 dark:text-emerald-100" },
  "販売":     { early: "bg-orange-100 dark:bg-orange-900/50",    late: "bg-orange-300 dark:bg-orange-700/70",    def: "bg-orange-200 dark:bg-orange-800/60",    border: "border-orange-400 dark:border-orange-500",   text: "text-orange-900 dark:text-orange-100" },
  "MOTA":     { early: "bg-red-100 dark:bg-red-900/50",           late: "bg-red-300 dark:bg-red-700/70",           def: "bg-red-200 dark:bg-red-800/60",           border: "border-red-400 dark:border-red-500",         text: "text-red-900 dark:text-red-100" },
  "リメイク": { early: "bg-pink-100 dark:bg-pink-900/50",        late: "bg-pink-300 dark:bg-pink-700/70",        def: "bg-pink-200 dark:bg-pink-800/60",        border: "border-pink-400 dark:border-pink-500",       text: "text-pink-900 dark:text-pink-100" },
  "ローン":   { early: "bg-violet-100 dark:bg-violet-900/50",    late: "bg-violet-300 dark:bg-violet-700/70",    def: "bg-violet-200 dark:bg-violet-800/60",    border: "border-violet-400 dark:border-violet-500",   text: "text-violet-900 dark:text-violet-100" },
};

export const SEAT_SECTION_FALLBACK: SeatColorSet = {
  early:  "bg-sky-100 dark:bg-sky-900/50",
  late:   "bg-sky-300 dark:bg-sky-700/70",
  def:    "bg-sky-200 dark:bg-sky-800/60",
  border: "border-sky-400 dark:border-sky-500",
  text:   "text-sky-900 dark:text-sky-100",
};

/**
 * 席背景クラスを返す
 * @param section 席のセクション
 * @param shiftName スタッフのシフト名（早番/遅番判定用・省略可）
 */
export function getSeatBgClass(section: string | null | undefined, shiftName?: string | null): string {
  if (!section) return "";
  const c = SEAT_SECTION_COLORS[section] ?? SEAT_SECTION_FALLBACK;
  if (shiftName?.includes("早")) return c.early;
  if (shiftName?.includes("遅")) return c.late;
  return c.def;
}

/**
 * 席ボーダークラスを返す（セクションインジケーター用）
 */
export function getSeatBorderClass(section: string | null | undefined): string {
  if (!section) return "border-zinc-300 dark:border-zinc-600";
  const c = SEAT_SECTION_COLORS[section] ?? SEAT_SECTION_FALLBACK;
  return c.border;
}

/**
 * 席テキストクラスを返す
 */
export function getSeatTextClass(section: string | null | undefined): string {
  if (!section) return "text-zinc-700 dark:text-zinc-200";
  const c = SEAT_SECTION_COLORS[section] ?? SEAT_SECTION_FALLBACK;
  return c.text;
}

/**
 * シフト名の先頭からセクションを解決する
 * 例: "MOTA_遅番_A" → "MOTA"
 *     "ローン_早番" → "ローン"
 *     null          → fallback
 */
export function resolveShiftSection(
  shiftName: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  if (shiftName) {
    for (const sec of Object.keys(SEAT_SECTION_COLORS)) {
      if (shiftName.startsWith(sec)) return sec;
    }
  }
  return fallback ?? null;
}

/**
 * 「セクション（シフト）」形式のラベルを返す
 * 早番/遅番がない場合はセクション名のみ
 * 例: formatSectionShift("査定", "査定_早番_A") → "査定（早番）"
 *     formatSectionShift("SV", null)            → "SV"
 */
export function formatSectionShift(
  section: string | null | undefined,
  shiftName: string | null | undefined,
): string {
  if (!section) return "";
  const shift = shiftName?.includes("早") ? "早番"
              : shiftName?.includes("遅") ? "遅番"
              : null;
  return shift ? `${section}（${shift}）` : section;
}
