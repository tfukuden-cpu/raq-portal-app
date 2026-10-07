/** 配置人数に数えない運用上のシフト名 → 稼働実績の出力に書き出すシフト名。
 *
 *  「他案件」は、別案件で稼働した日の実績をこの案件に残すために使っている運用上の名前。
 *  shift_patterns に存在しないのでシフト表の配置人数には数えられないが、
 *  稼働実績としては実際に入っていたシフトの名前で書き出したい。
 *  （2026-10-06 ユーザー判断：別案件稼働は査定早番として出力する） */
const SHIFT_NAME_ALIASES: Record<string, string> = {
  "他案件": "査定早番",
};

/** 稼働実績の出力に使うシフト名。別名が無ければそのまま返す。
 *  ※ shift_patterns の時刻補完は元の名前で引くこと（別名には時刻が無い）。 */
export function exportShiftName(name: string | null | undefined): string {
  const n = name ?? "";
  return SHIFT_NAME_ALIASES[n] ?? n;
}
