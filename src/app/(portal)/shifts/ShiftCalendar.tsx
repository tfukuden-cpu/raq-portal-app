"use client";

import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

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

// ── シフトバッジ色 ─────────────────────────────────────────────────────────────
function getShiftBadge(name: string | null): { bg: string; text: string; border: string } | null {
  if (!name) return null;
  if (["公休", "休", "公休日"].includes(name))
    return { bg: "bg-blue-100 dark:bg-blue-900/50",    text: "text-blue-700 dark:text-blue-200",    border: "border border-blue-200 dark:border-blue-700" };
  if (["希望休", "有休", "特別休暇", "代休", "振替休日"].includes(name))
    return { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-200", border: "border border-purple-200 dark:border-purple-700" };
  if (["欠勤"].includes(name))
    return { bg: "bg-red-100 dark:bg-red-900/40",      text: "text-red-700 dark:text-red-200",       border: "border border-red-200 dark:border-red-700" };
  if (name.includes("早番"))
    return { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-800 dark:text-emerald-200", border: "border border-emerald-200 dark:border-emerald-700" };
  if (name.includes("遅番"))
    return { bg: "bg-orange-100 dark:bg-orange-900/40",   text: "text-orange-800 dark:text-orange-200",   border: "border border-orange-200 dark:border-orange-700" };
  return { bg: "bg-sky-100 dark:bg-sky-900/40",        text: "text-sky-800 dark:text-sky-200",       border: "border border-sky-200 dark:border-sky-700" };
}

function isOff(name: string | null): boolean {
  return ["公休", "休", "公休日", "希望休", "有休", "特別休暇", "代休", "振替休日", "欠勤"].includes(name ?? "");
}

function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

function BriefcaseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}

export default function ShiftCalendar({
  shifts, changeLogs = [], todayStr, initialYear, initialMonth, minMonth, maxMonth,
  controlledYear, controlledMonth, onGoMonth,
  selectedDate, onSelectDate, className = "",
}: Props) {
  const [internalYear,  setInternalYear]  = useState(initialYear);
  const [internalMonth, setInternalMonth] = useState(initialMonth);

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
    <div className={cx("bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 flex flex-col overflow-hidden", className)}>

      {/* 月ナビ + 統計 */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => goMonth(-1)} disabled={!canPrev}
            className="w-8 h-8 flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors">
            <ChevronLeftIcon className="w-4 h-4 text-zinc-500" />
          </button>
          <span className="text-[20px] font-bold text-[#0d1b35] dark:text-white tabular-nums min-w-[120px] text-center">
            {year}年 {month}月
          </span>
          <button type="button" onClick={() => goMonth(1)} disabled={!canNext}
            className="w-8 h-8 flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors">
            <ChevronRightIcon className="w-4 h-4 text-zinc-500" />
          </button>
        </div>
        {(workCount > 0 || holidayCount > 0) && (
          <div className="flex items-center gap-4 text-zinc-500 dark:text-zinc-400">
            <div className="flex items-center gap-1.5">
              <BriefcaseIcon />
              <span className="text-[13px]">出勤 <b className="text-[#0d1b35] dark:text-white">{workCount}</b>日</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CalendarIcon />
              <span className="text-[13px]">公休 <b className="text-[#0d1b35] dark:text-white">{holidayCount}</b>日</span>
            </div>
          </div>
        )}
      </div>

      {/* 曜日ヘッダー */}
      <div className="flex-shrink-0 grid grid-cols-7 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/30">
        {WEEKDAY_SHORT.map((w, i) => (
          <div key={w} className={cx(
            "text-center text-[13px] font-bold py-2",
            i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-zinc-500 dark:text-zinc-400",
          )}>{w}</div>
        ))}
      </div>

      {/* グリッド */}
      <div className="flex-1 min-h-0 grid grid-cols-7" style={{ gridAutoRows: "1fr" }}>

        {/* 先月末 */}
        {Array.from({ length: firstDow }, (_, i) => (
          <div key={`pre${i}`} className="border-r border-b border-zinc-50 dark:border-zinc-800/50 p-1.5">
            <span className="text-[12px] text-zinc-200 dark:text-zinc-700">{prevDays - firstDow + i + 1}</span>
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

          return (
            <button
              key={ds}
              type="button"
              onClick={() => onSelectDate?.(ds)}
              className={cx(
                "relative flex flex-col justify-between p-2.5 border-r border-b transition-all",
                isSel
                  ? "bg-[#0d1b35]/[0.04] dark:bg-blue-950/30"
                  : isToday
                  ? "border-[1.5px] border-[#0d1b35] dark:border-blue-400 z-10 bg-[#0d1b35]/[0.02]"
                  : "border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40",
              )}
            >
              {/* 上部：日付 + 祝日名 */}
              <div>
                <div className="flex items-center justify-between">
                  {isToday ? (
                    <span className="w-8 h-8 rounded-full bg-[#0d1b35] dark:bg-blue-500 text-white text-[15px] font-bold flex items-center justify-center">
                      {d}
                    </span>
                  ) : (
                    <span className={cx(
                      "text-[18px] font-bold leading-none",
                      isRed   ? "text-red-500 dark:text-red-400"
                      : isBlue  ? "text-blue-500 dark:text-blue-400"
                      : isSel   ? "text-[#0d1b35] dark:text-blue-300"
                      : "text-zinc-800 dark:text-zinc-200",
                    )}>
                      {d}
                    </span>
                  )}
                  {hasLog && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                  )}
                </div>
                {holidayName && (
                  <p className="text-[9px] text-red-400 leading-tight mt-0.5 truncate font-medium">{holidayName}</p>
                )}
              </div>

              {/* 下部：シフトバッジ + 時間（常に下揃え） */}
              <div className="mt-1.5">
                {s?.shift_name && badge ? (
                  <>
                    <div className={cx(
                      "py-1 px-1 rounded-lg text-[11px] font-bold text-center leading-tight w-full",
                      badge.bg, badge.text, badge.border,
                    )}>
                      {s.shift_name}
                    </div>
                    {s.shift_start && !["公休","休","公休日","希望休","有休","特別休暇","代休","振替休日","欠勤"].includes(s.shift_name) && (
                      <p className="text-[9px] text-zinc-400 dark:text-zinc-500 tabular-nums text-center mt-0.5 font-medium">
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
          <div key={`post${i}`} className="border-r border-b border-zinc-50 dark:border-zinc-800/50 p-1.5">
            <span className="text-[12px] text-zinc-200 dark:text-zinc-700">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
