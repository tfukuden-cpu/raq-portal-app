"use client";

import { useState } from "react";

type ShiftData = {
  shift_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  note?: string | null;
};

export type ShiftChangeLog = {
  shift_date: string;
  action: string;
  before_shift_name: string | null;
  after_shift_name: string | null;
  changed_by_name: string;
  changed_at: string;
};

type Props = {
  shifts: ShiftData[];
  changeLogs?: ShiftChangeLog[];
  holidayRequests?: { request_date: string; status: string }[];
  todayStr: string;
  initialYear: number;
  initialMonth: number;
  minMonth: string;
  maxMonth: string;
  controlledYear?: number;
  controlledMonth?: number;
  onGoMonth?: (delta: number) => void;
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
  className?: string;
};

const WEEKDAY_SHORT = ["日", "月", "火", "水", "木", "金", "土"];

// ── 日本の祝日（2025〜2026） ───────────────────────────────────────────────────
const JP_HOLIDAYS: Record<string, string> = {
  "2025-01-01": "元日",        "2025-01-13": "成人の日",
  "2025-02-11": "建国記念の日", "2025-02-23": "天皇誕生日",
  "2025-02-24": "天皇誕生日振替", "2025-03-20": "春分の日",
  "2025-04-29": "昭和の日",    "2025-05-03": "憲法記念日",
  "2025-05-04": "みどりの日",  "2025-05-05": "こどもの日",
  "2025-05-06": "こどもの日振替", "2025-07-21": "海の日",
  "2025-08-11": "山の日",      "2025-09-15": "敬老の日",
  "2025-09-23": "秋分の日",    "2025-10-13": "スポーツの日",
  "2025-11-03": "文化の日",    "2025-11-23": "勤労感謝の日",
  "2025-11-24": "勤労感謝の日振替",
  "2026-01-01": "元日",        "2026-01-12": "成人の日",
  "2026-02-11": "建国記念の日", "2026-02-23": "天皇誕生日",
  "2026-03-20": "春分の日",    "2026-04-29": "昭和の日",
  "2026-05-03": "憲法記念日",  "2026-05-04": "みどりの日",
  "2026-05-05": "こどもの日",  "2026-07-20": "海の日",
  "2026-08-11": "山の日",      "2026-09-21": "敬老の日",
  "2026-09-23": "秋分の日",    "2026-10-12": "スポーツの日",
  "2026-11-03": "文化の日",    "2026-11-23": "勤労感謝の日",
};

// ── シフトバッジ色（夜空背景に映える半透明＋明色） ─────────────────────────────
function getShiftBadge(name: string | null): { bg: string; text: string; border: string } | null {
  if (!name) return null;
  if (["公休", "休", "公休日"].includes(name))
    return { bg: "bg-sky-500/20",     text: "text-sky-200",     border: "border border-sky-400/50" };
  if (["希望休", "有休", "特別休暇", "代休", "振替休日"].includes(name))
    return { bg: "bg-purple-500/20",  text: "text-purple-200",  border: "border border-purple-400/50" };
  if (["欠勤"].includes(name))
    return { bg: "bg-red-500/25",     text: "text-red-200",     border: "border border-red-400/50" };
  if (name.includes("早番"))
    return { bg: "bg-emerald-500/20", text: "text-emerald-200", border: "border border-emerald-400/50" };
  if (name.includes("遅番"))
    return { bg: "bg-orange-500/20",  text: "text-orange-200",  border: "border border-orange-400/50" };
  return { bg: "bg-amber-400/20",     text: "text-amber-200",   border: "border border-amber-300/50" };
}

function isOff(name: string | null): boolean {
  return ["公休", "休", "公休日", "希望休", "有休", "特別休暇", "代休", "振替休日", "欠勤"].includes(name ?? "");
}

function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export default function ShiftCalendar({
  shifts, changeLogs = [], todayStr, initialYear, initialMonth, minMonth, maxMonth,
  controlledYear, controlledMonth, onGoMonth,
  selectedDate, onSelectDate, className = "",
  holidayRequests = [],
}: Props) {
  const [internalYear,  setInternalYear]  = useState(initialYear);
  const [internalMonth, setInternalMonth] = useState(initialMonth);

  // 希望休申請マップ（日付→ステータス）
  const holidayReqMap = new Map(holidayRequests.map(r => [r.request_date, r.status]));

  const isControlled = controlledYear !== undefined;
  const year  = isControlled ? controlledYear!  : internalYear;
  const month = isControlled ? controlledMonth! : internalMonth;

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const canPrev  = monthStr > minMonth;
  const canNext  = monthStr < maxMonth;

  const goMonth = (delta: number) => {
    if (isControlled && onGoMonth) { onGoMonth(delta); }
    else {
      const d = new Date(year, month - 1 + delta, 1);
      setInternalYear(d.getFullYear());
      setInternalMonth(d.getMonth() + 1);
    }
  };

  const shiftMap = new Map<string, ShiftData>();
  for (const s of shifts) {
    if (s.shift_date.startsWith(monthStr)) shiftMap.set(s.shift_date, s);
  }

  const logMap = new Map<string, ShiftChangeLog[]>();
  for (const l of changeLogs) {
    const arr = logMap.get(l.shift_date) ?? [];
    arr.push(l);
    logMap.set(l.shift_date, arr);
  }

  const firstDow    = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const prevDays    = new Date(year, month - 1, 0).getDate();
  const trailing    = 42 - firstDow - daysInMonth;

  let workCount = 0, holidayCount = 0;
  for (let i = 1; i <= daysInMonth; i++) {
    const ds = `${monthStr}-${String(i).padStart(2, "0")}`;
    const s  = shiftMap.get(ds);
    if (!s) continue;
    isOff(s.shift_name) ? holidayCount++ : workCount++;
  }

  return (
    <div className={cx("rounded-lg border-2 border-white bg-[#000846] p-[3px] flex flex-col overflow-hidden", className)}>
     <div className="rounded-md border border-white/80 bg-[#000846] flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* 月ナビ + 統計 */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 md:px-5 py-3 border-b border-white/20">
        <div className="flex items-center gap-2 md:gap-3">
          <button type="button" onClick={() => goMonth(-1)} disabled={!canPrev}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/40 text-white/80 hover:bg-white/10 active:scale-95 disabled:opacity-20 transition">
            ◀
          </button>
          <span className="text-[18px] md:text-[20px] font-bold text-amber-300 tabular-nums min-w-[110px] md:min-w-[120px] text-center">
            {year}年 {month}月
          </span>
          <button type="button" onClick={() => goMonth(1)} disabled={!canNext}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/40 text-white/80 hover:bg-white/10 active:scale-95 disabled:opacity-20 transition">
            ▶
          </button>
        </div>
        {(workCount > 0 || holidayCount > 0) && (
          <div className="flex items-center gap-3 md:gap-4">
            <span className="text-[12px] md:text-[13px] text-white/70">
              しゅつげき <b className="text-amber-300 text-[15px]">{workCount}</b>
            </span>
            <span className="text-[12px] md:text-[13px] text-white/70">
              おやすみ <b className="text-sky-300 text-[15px]">{holidayCount}</b>
            </span>
          </div>
        )}
      </div>

      {/* 曜日ヘッダー */}
      <div className="flex-shrink-0 grid grid-cols-7 border-b border-white/20 bg-white/5">
        {WEEKDAY_SHORT.map((w, i) => (
          <div key={w} className={cx(
            "text-center text-[12px] md:text-[13px] font-bold py-2",
            i === 0 ? "text-red-300" : i === 6 ? "text-sky-300" : "text-white/70",
          )}>{w}</div>
        ))}
      </div>

      {/* グリッド */}
      <div className="flex-1 min-h-0 grid grid-cols-7" style={{ gridAutoRows: "1fr" }}>

        {/* 先月末 */}
        {Array.from({ length: firstDow }, (_, i) => (
          <div key={`pre${i}`} className="border-r border-b border-white/5 p-1.5">
            <span className="text-[12px] text-white/15">{prevDays - firstDow + i + 1}</span>
          </div>
        ))}

        {/* 当月 */}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
          const ds          = `${monthStr}-${String(d).padStart(2, "0")}`;
          const s           = shiftMap.get(ds);
          const isToday     = ds === todayStr;
          const isSel       = ds === selectedDate;
          const dow         = new Date(year, month - 1, d).getDay();
          const isHoliday   = !!JP_HOLIDAYS[ds];
          const badge       = getShiftBadge(s?.shift_name ?? null);
          const hasLog      = logMap.has(ds);
          const isRed       = dow === 0 || isHoliday;
          const isBlue      = dow === 6;
          const holidayName = JP_HOLIDAYS[ds];
          const holidayReqStatus = holidayReqMap.get(ds) ?? null;

          return (
            <button
              key={ds}
              type="button"
              onClick={() => onSelectDate?.(ds)}
              className={cx(
                "relative flex flex-col justify-between p-1 md:p-2 border-r border-b border-white/10 transition-all",
                isSel   ? "bg-amber-300/15 ring-1 ring-inset ring-amber-300"
                : isToday ? "bg-white/10"
                :          "hover:bg-white/5",
              )}
            >
              {/* 上部：日付 + 祝日名 */}
              <div>
                <div className="flex items-center justify-between">
                  {isToday ? (
                    <span className="w-5 h-5 md:w-7 md:h-7 rounded-full bg-amber-300 text-[#000846] text-[10px] md:text-[13px] font-bold flex items-center justify-center leading-none">
                      {d}
                    </span>
                  ) : (
                    <span className={cx(
                      "text-[13px] md:text-[17px] font-bold leading-none",
                      isRed   ? "text-red-300"
                      : isBlue  ? "text-sky-300"
                      : "text-white",
                    )}>
                      {d}
                    </span>
                  )}
                  <div className="flex items-center gap-0.5">
                    {hasLog && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-300 flex-shrink-0" />
                    )}
                    {holidayReqStatus && (
                      <span className={cx(
                        "text-[8px] font-bold px-1 py-0.5 rounded leading-none",
                        holidayReqStatus === "approved" ? "bg-purple-400/30 text-purple-200"
                        : holidayReqStatus === "rejected" ? "bg-red-400/30 text-red-200"
                        : "bg-purple-400/15 text-purple-300",
                      )}>
                        {holidayReqStatus === "approved" ? "承認" : holidayReqStatus === "rejected" ? "却下" : "申請"}
                      </span>
                    )}
                  </div>
                </div>
                {holidayName && (
                  <p className="text-[9px] text-red-300/80 leading-tight mt-0.5 truncate font-medium">{holidayName}</p>
                )}
              </div>

              {/* 下部：シフトバッジ + 時間（常に下揃え） */}
              <div className="mt-1.5">
                {s?.shift_name && badge ? (
                  <>
                    <div className={cx(
                      "py-0.5 md:py-1 px-0.5 md:px-1 rounded md:rounded-lg text-[8px] md:text-[11px] font-bold text-center leading-tight w-full",
                      badge.bg, badge.text, badge.border,
                    )}>
                      {s.shift_name}
                    </div>
                    {s.shift_start && !isOff(s.shift_name) && (
                      <p className="text-[9px] text-white/45 tabular-nums text-center mt-0.5 font-medium">
                        {s.shift_start.slice(0,5)}–{s.shift_end?.slice(0,5) ?? "--:--"}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="h-[28px]" /> /* バッジなし日も高さを確保して揃える */
                )}
              </div>
            </button>
          );
        })}

        {/* 来月頭 */}
        {Array.from({ length: trailing }, (_, i) => (
          <div key={`post${i}`} className="border-r border-b border-white/5 p-1.5">
            <span className="text-[12px] text-white/15">{i + 1}</span>
          </div>
        ))}
      </div>
     </div>
    </div>
  );
}
