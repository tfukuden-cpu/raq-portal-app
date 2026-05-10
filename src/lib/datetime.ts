/**
 * 日時フォーマット用ヘルパー（東京時刻）
 */

const TZ = "Asia/Tokyo";

/** YYYY/MM/DD */
export function formatDateJP(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/-/g, "/");
}

/** HH:MM */
export function formatTimeJP(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** YYYY/MM/DD HH:MM */
export function formatDateTimeJP(d: Date | string): string {
  return `${formatDateJP(d)} ${formatTimeJP(d)}`;
}

/** その日付の0時00分（東京時刻）のISO文字列 */
export function startOfTodayJST(): string {
  const now = new Date();
  const jpDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // YYYY-MM-DD 形式が返る → 東京の0時はUTCの前日15時
  return `${jpDate}T00:00:00+09:00`;
}

/** 同じ日（東京時刻）かどうか */
export function isSameDayJP(a: Date | string, b: Date | string): boolean {
  return formatDateJP(a) === formatDateJP(b);
}
