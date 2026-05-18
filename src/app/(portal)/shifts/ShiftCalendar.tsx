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
};

const WEEKDAY_SHORT = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAY_FULL  = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

function isHoliday(name: string | null) {
  return name === "公休" || name === "休" || name === "公休日";
}

function fmtLogAt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ShiftCalendar({
  shifts, changeLogs = [], todayStr, initialYear, initialMonth, minMonth, maxMonth,
}: Props) {
  const [year, setYear]         = useState(initialYear);
  const [month, setMonth]       = useState(initialMonth);
  const [selected, setSelected] = useState<string | null>(todayStr);

  const monthStr  = `${year}-${String(month).padStart(2, "0")}`;
  const canPrev   = monthStr > minMonth;
  const canNext   = monthStr < maxMonth;

  const goMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelected(null);
  };

  const shiftMap = new Map<string, ShiftData>();
  for (const s of shifts) {
    if (s.shift_date.startsWith(monthStr)) shiftMap.set(s.shift_date, s);
  }

  // 変更ログ map (shift_date → logs)
  const logMap = new Map<string, ShiftChangeLog[]>();
  for (const l of changeLogs) {
    const arr = logMap.get(l.shift_date) ?? [];
    arr.push(l);
    logMap.set(l.shift_date, arr);
  }

  const firstDow    = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  // 常に6行（42マス）固定
  const trailing    = 42 - firstDow - daysInMonth;

  let workCount = 0, holidayCount = 0;
  for (let i = 1; i <= daysInMonth; i++) {
    const s = shiftMap.get(`${monthStr}-${String(i).padStart(2, "0")}`);
    if (!s) continue;
    isHoliday(s.shift_name) ? holidayCount++ : workCount++;
  }

  const selShift     = selected ? (shiftMap.get(selected) ?? null) : null;
  const selDow       = selected ? new Date(selected + "T00:00:00+09:00").getDay() : null;
  const [, selMM, selDD] = selected?.split("-") ?? [];
  const selLabel     = selected
    ? `${Number(selMM)}月${Number(selDD)}日（${WEEKDAY_FULL[selDow!]}）`
    : null;
  const selIsHoliday = selShift ? isHoliday(selShift.shift_name) : false;
  const selHasWork   = selShift && !selIsHoliday;

  return (
    <div className="flex flex-col gap-2 h-full">

      {/* 月ナビ */}
      <div className="flex items-center justify-between flex-shrink-0">
        <button type="button" onClick={() => goMonth(-1)} disabled={!canPrev}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors">
          <ChevronLeftIcon className="w-4 h-4 text-zinc-500" />
        </button>
        <div className="text-center">
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            {year}年 {month}月
          </p>
          {(workCount > 0 || holidayCount > 0) && (
            <p className="text-[10px] text-zinc-400">
              出勤 {workCount}日　公休 {holidayCount}日
            </p>
          )}
        </div>
        <button type="button" onClick={() => goMonth(1)} disabled={!canNext}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors">
          <ChevronRightIcon className="w-4 h-4 text-zinc-500" />
        </button>
      </div>

      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7 flex-shrink-0">
        {WEEKDAY_SHORT.map((w, i) => (
          <div key={w} className={`text-center text-[11px] font-semibold py-0.5 ${
            i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-400"
          }`}>{w}</div>
        ))}
      </div>

      {/* グリッド（常に6行 = 42マス） */}
      <div
        className="flex-1 min-h-0 grid grid-cols-7 gap-0.5"
        style={{ gridAutoRows: "1fr" }}
      >
        {Array.from({ length: firstDow }).map((_, i) => <div key={`pre${i}`} />)}

        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
          const ds      = `${monthStr}-${String(d).padStart(2, "0")}`;
          const s       = shiftMap.get(ds);
          const isToday = ds === todayStr;
          const isSel   = ds === selected;
          const dow     = new Date(year, month - 1, d).getDay();
          const hol     = s ? isHoliday(s.shift_name) : false;
          const work    = s && !hol;

          // セル背景（単色：青）
          const cellBg = isSel
            ? work  ? "bg-blue-500 dark:bg-blue-600"
            : hol   ? "bg-zinc-400 dark:bg-zinc-500"
                    : "bg-zinc-200 dark:bg-zinc-600"
            : work  ? "bg-blue-100 dark:bg-blue-900/50 hover:bg-blue-200 dark:hover:bg-blue-900/70"
            : hol   ? "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60";

          const numCls = isSel
            ? "text-white font-bold"
            : isToday
            ? "bg-blue-600 text-white rounded-full"
            : dow === 0 ? "text-red-500 dark:text-red-400"
            : dow === 6 ? "text-blue-500 dark:text-blue-400"
            : work  ? "text-blue-700 dark:text-blue-200 font-semibold"
            : hol   ? "text-zinc-400 dark:text-zinc-500"
                    : "text-zinc-700 dark:text-zinc-300";

          const hasLog = logMap.has(ds);

          return (
            <button
              key={ds}
              type="button"
              onClick={() => setSelected(isSel ? null : ds)}
              className={[
                "flex flex-col items-center justify-center gap-0 rounded-xl transition-colors relative",
                cellBg,
                isToday && !isSel ? "ring-2 ring-blue-400 dark:ring-blue-500 ring-inset" : "",
              ].filter(Boolean).join(" ")}
            >
              <span className={`text-sm w-7 h-6 flex items-center justify-center ${numCls}`}>
                {d}
              </span>
              {work && s?.shift_name && (
                <span className={`text-[9px] leading-none ${isSel ? "text-white/75" : "text-blue-500 dark:text-blue-400"}`}>
                  {s.shift_name.charAt(0)}
                </span>
              )}
              {/* 変更履歴インジケーター */}
              {hasLog && !isSel && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
            </button>
          );
        })}

        {Array.from({ length: trailing }).map((_, i) => <div key={`post${i}`} />)}
      </div>

      {/* 選択日の詳細 */}
      <div className="flex-shrink-0 rounded-2xl bg-zinc-50 dark:bg-zinc-900 px-4 py-3 min-h-[80px] flex flex-col justify-center">
        {!selected && (
          <p className="text-xs text-zinc-400 text-center">日付を選択してください</p>
        )}
        {selected && !selShift && (
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{selLabel}</p>
            <span className="text-xs text-zinc-400">シフト未登録</span>
          </div>
        )}
        {selected && selIsHoliday && (
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{selLabel}</p>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-500">
              公休日
            </span>
          </div>
        )}
        {selected && selHasWork && selShift && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{selLabel}</p>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-300">
                {selShift.shift_name}
              </span>
            </div>
            {(selShift.shift_start || selShift.shift_end) && (
              <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50 leading-tight">
                {selShift.shift_start?.slice(0, 5) ?? "--:--"}
                <span className="text-zinc-300 dark:text-zinc-600 text-lg font-light mx-2">〜</span>
                {selShift.shift_end?.slice(0, 5) ?? "--:--"}
              </p>
            )}
            {selShift.note && (
              <p className="text-xs text-zinc-400">{selShift.note}</p>
            )}
            {/* 変更履歴 */}
            {selected && (logMap.get(selected) ?? []).length > 0 && (
              <div className="pt-1 border-t border-zinc-200 dark:border-zinc-700">
                <p className="text-[10px] text-zinc-400 mb-1 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
                  変更履歴
                </p>
                <div className="space-y-0.5 max-h-24 overflow-y-auto">
                  {(logMap.get(selected) ?? []).map((l, i) => (
                    <p key={i} className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-snug">
                      <span className="font-semibold text-zinc-600 dark:text-zinc-300">{l.changed_by_name}</span>
                      {" が "}
                      {l.action === "delete" ? "削除"
                        : l.action === "create" ? "追加"
                        : `${l.before_shift_name ?? "（なし）"} → ${l.after_shift_name ?? "（なし）"}`}
                      <span className="ml-1 text-zinc-400">{fmtLogAt(l.changed_at)}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
