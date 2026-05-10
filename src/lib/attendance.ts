/**
 * 勤怠計算ロジック
 *
 * ルール:
 *   実働時間  = 退勤 - 出勤 - 休憩時間
 *   残業時間  = 実働 > 8h の超過分
 *   深夜帯    = 22:00〜05:00 に働いた時間（休憩含む）
 *   深夜残業  = 深夜帯のうち 残業に当たる部分
 *   深夜時間  = 深夜帯 - 深夜残業（所定内の深夜労働）
 */

export type DailyRecord = {
  date: string;               // YYYY-MM-DD
  clockIn: string | null;     // HH:MM (JST)
  clockOut: string | null;    // HH:MM (JST)
  breakMinutes: number;       // 休憩（分）
  actualMinutes: number;      // 実働（分）
  overtimeMinutes: number;    // 残業（分）
  nightMinutes: number;       // 深夜・所定内（分）
  nightOvertimeMinutes: number; // 深夜残業（分）
};

export type StaffMonthlySummary = {
  staffId: string;
  staffName: string;
  workDays: number;
  actualMinutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  nightOvertimeMinutes: number;
};

type Punch = {
  punch_type: string;
  recorded_at: string; // ISO timestamptz
};

// ── 内部ユーティリティ ──────────────────────────────────

/** 区間 [a1,a2] と [b1,b2] の重複分数 */
function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/**
 * 深夜帯（22:00-05:00）と労働時間の重複を計算
 * start/end は baseDate の JST 深夜0時からの分数
 * 翌日跨ぎは 1440+ で表現
 */
function nightOverlapMin(start: number, end: number): number {
  return (
    overlap(start, end,    0,  300) + // 00:00-05:00（早朝出勤）
    overlap(start, end, 1320, 1440) + // 22:00-24:00
    overlap(start, end, 1440, 1740) + // 翌00:00-05:00
    overlap(start, end, 2760, 2880) + // 翌22:00-24:00（長時間シフト）
    overlap(start, end, 2880, 3180)   // 翌々00:00-05:00
  );
}

/** ISO文字列 → baseDate JST 深夜0時からの分数 */
function toMinFromBase(isoStr: string, baseDate: string): number {
  const dt  = new Date(isoStr);
  const base = new Date(baseDate + "T00:00:00+09:00");
  return (dt.getTime() - base.getTime()) / 60000;
}

/** 分数 → HH:MM 文字列 */
function minToHHMM(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ── 公開 API ──────────────────────────────────────────────

/**
 * 1日分のパンチログから勤怠レコードを計算
 * @param date  YYYY-MM-DD (JST)
 * @param punches その日のパンチログ全件
 */
export function calcDailyRecord(date: string, punches: Punch[]): DailyRecord {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  const clockInEntry  = sorted.find((p) => p.punch_type === "clock_in");
  const clockOutEntry = [...sorted].reverse().find((p) => p.punch_type === "clock_out");

  if (!clockInEntry) {
    return { date, clockIn: null, clockOut: null,
      breakMinutes: 0, actualMinutes: 0, overtimeMinutes: 0,
      nightMinutes: 0, nightOvertimeMinutes: 0 };
  }
  if (!clockOutEntry) {
    return { date, clockIn: minToHHMM(clockInEntry.recorded_at), clockOut: null,
      breakMinutes: 0, actualMinutes: 0, overtimeMinutes: 0,
      nightMinutes: 0, nightOvertimeMinutes: 0 };
  }

  // 休憩時間（break_start / break_end のペア）
  const bStarts = sorted.filter((p) => p.punch_type === "break_start");
  const bEnds   = sorted.filter((p) => p.punch_type === "break_end");
  let breakMinutes = 0;
  for (let i = 0; i < Math.min(bStarts.length, bEnds.length); i++) {
    const bs = new Date(bStarts[i].recorded_at).getTime();
    const be = new Date(bEnds[i].recorded_at).getTime();
    if (be > bs) breakMinutes += (be - bs) / 60000;
  }
  breakMinutes = Math.round(breakMinutes);

  const ciMin = toMinFromBase(clockInEntry.recorded_at,  date);
  const coMin = toMinFromBase(clockOutEntry.recorded_at, date);

  if (coMin <= ciMin) {
    return { date,
      clockIn:  minToHHMM(clockInEntry.recorded_at),
      clockOut: minToHHMM(clockOutEntry.recorded_at),
      breakMinutes, actualMinutes: 0, overtimeMinutes: 0,
      nightMinutes: 0, nightOvertimeMinutes: 0 };
  }

  const actualMinutes   = Math.max(0, Math.round(coMin - ciMin - breakMinutes));
  const overtimeMinutes = Math.max(0, actualMinutes - 480); // 8h = 480min

  // 残業開始時刻（近似: 出勤 + 8h実働 + 休憩分）
  const overtimeStart = ciMin + 480 + breakMinutes;

  // 深夜帯の計算
  const nightTotal    = nightOverlapMin(ciMin, coMin);
  const nightOvertime = nightOverlapMin(overtimeStart, coMin);

  // nightOvertime が nightTotal を超えないようにクランプ
  const nightOvertimeMinutes = Math.round(Math.min(nightOvertime, nightTotal, overtimeMinutes));
  const nightMinutes         = Math.round(Math.max(0, nightTotal - nightOvertimeMinutes));

  return {
    date,
    clockIn:  minToHHMM(clockInEntry.recorded_at),
    clockOut: minToHHMM(clockOutEntry.recorded_at),
    breakMinutes,
    actualMinutes,
    overtimeMinutes,
    nightMinutes,
    nightOvertimeMinutes,
  };
}

/** 月次サマリーを集計 */
export function calcMonthlySummary(
  staffId: string,
  staffName: string,
  records: DailyRecord[]
): StaffMonthlySummary {
  const worked = records.filter((r) => r.clockIn && r.clockOut);
  return {
    staffId,
    staffName,
    workDays:            worked.length,
    actualMinutes:       worked.reduce((s, r) => s + r.actualMinutes,       0),
    overtimeMinutes:     worked.reduce((s, r) => s + r.overtimeMinutes,     0),
    nightMinutes:        worked.reduce((s, r) => s + r.nightMinutes,        0),
    nightOvertimeMinutes:worked.reduce((s, r) => s + r.nightOvertimeMinutes,0),
  };
}

/** 分 → "H:MM" 表示（例: 90 → "1:30"） */
export function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** 分 → "X時間Y分" 表示 */
export function fmtMinJP(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}
