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
};

const WEEKDAY_SHORT = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAY_FULL  = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

// ── シフトバッジ色 ─────────────────────────────────────────────────────────────

function getShiftBadge(name: string | null): { bg: string; text: string } | null {
  if (!name) return null;
  if (["公休", "休", "公休日"].includes(name))
    return { bg: "bg-blue-50 dark:bg-blue-950/50",   text: "text-blue-600 dark:text-blue-300" };
  if (["希望休", "有休", "特別休暇", "代休", "振替休日", "欠勤"].includes(name))
    return { bg: "bg-zinc-100 dark:bg-zinc-800",      text: "text-zinc-500 dark:text-zinc-400" };
  if (name.includes("早番"))
    return { bg: "bg-green-50 dark:bg-green-950/50",  text: "text-green-700 dark:text-green-300" };
  if (name.includes("遅番"))
    return { bg: "bg-amber-50 dark:bg-amber-950/50",  text: "text-amber-700 dark:text-amber-300" };
  return { bg: "bg-sky-50 dark:bg-sky-950/50",        text: "text-sky-700 dark:text-sky-300" };
}

function isOff(name: string | null): boolean {
  return ["公休", "休", "公休日", "希望休", "有休", "特別休暇", "代休", "振替休日", "欠勤"].includes(name ?? "");
}

function fmtLogAt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ── アイコン ──────────────────────────────────────────────────────────────────

function BriefcaseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
    </svg>
  );
}

function CalendarOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ShiftCalendar({
  shifts, changeLogs = [], todayStr, initialYear, initialMonth, minMonth, maxMonth,
  controlledYear, controlledMonth, onGoMonth,
}: Props) {
  const [internalYear,  setInternalYear]  = useState(initialYear);
  const [internalMonth, setInternalMonth] = useState(initialMonth);
  const [modal, setModal] = useState<string | null>(null);

  const isControlled = controlledYear !== undefined;
  const year  = isControlled ? controlledYear!  : internalYear;
  const month = isControlled ? controlledMonth! : internalMonth;

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const canPrev  = monthStr > minMonth;
  const canNext  = monthStr < maxMonth;

  const goMonth = (delta: number) => {
    if (isControlled && onGoMonth) {
      onGoMonth(delta);
    } else {
      const d = new Date(year, month - 1 + delta, 1);
      setInternalYear(d.getFullYear());
      setInternalMonth(d.getMonth() + 1);
    }
    setModal(null);
  };

  // データ構築
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
    const s = shiftMap.get(`${monthStr}-${String(i).padStart(2, "0")}`);
    if (!s) continue;
    isOff(s.shift_name) ? holidayCount++ : workCount++;
  }

  // モーダル情報
  const modalShift = modal ? shiftMap.get(modal) ?? null : null;
  const modalDow   = modal ? new Date(modal + "T00:00:00+09:00").getDay() : 0;
  const modalLabel = modal ? (() => {
    const [, mm, dd] = modal.split("-");
    return `${Number(mm)}月${Number(dd)}日（${WEEKDAY_FULL[modalDow]}）`;
  })() : "";

  return (
    <>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">

        {/* ── 月ナビ + 統計 ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
          {/* ← 月 年 → */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => goMonth(-1)}
              disabled={!canPrev}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors"
            >
              <ChevronLeftIcon className="w-4 h-4 text-zinc-500" />
            </button>
            <span className="text-[16px] font-bold text-[#0d1b35] dark:text-white tabular-nums w-28 text-center">
              {year}年{month}月
            </span>
            <button
              type="button"
              onClick={() => goMonth(1)}
              disabled={!canNext}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors"
            >
              <ChevronRightIcon className="w-4 h-4 text-zinc-500" />
            </button>
          </div>

          {/* 出勤/公休カウント */}
          {(workCount > 0 || holidayCount > 0) && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                <BriefcaseIcon />
                <span className="text-[13px]">出勤 <span className="font-bold text-[#0d1b35] dark:text-white tabular-nums">{workCount}</span>日</span>
              </div>
              <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                <CalendarOffIcon />
                <span className="text-[13px]">公休 <span className="font-bold text-[#0d1b35] dark:text-white tabular-nums">{holidayCount}</span>日</span>
              </div>
            </div>
          )}
        </div>

        {/* ── 曜日ヘッダー ── */}
        <div className="grid grid-cols-7 border-b border-zinc-100 dark:border-zinc-800">
          {WEEKDAY_SHORT.map((w, i) => (
            <div key={w} className={cx(
              "text-center text-[12px] font-semibold py-2.5",
              i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-zinc-500 dark:text-zinc-400",
            )}>
              {w}
            </div>
          ))}
        </div>

        {/* ── カレンダーグリッド ── */}
        <div className="grid grid-cols-7">

          {/* 先月末の日 */}
          {Array.from({ length: firstDow }, (_, i) => (
            <div key={`pre${i}`} className="border-r border-b border-zinc-50 dark:border-zinc-800/50 p-2 min-h-[72px] md:min-h-[88px]">
              <span className="text-[12px] text-zinc-300 dark:text-zinc-700">
                {prevDays - firstDow + i + 1}
              </span>
            </div>
          ))}

          {/* 当月の日 */}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
            const ds      = `${monthStr}-${String(d).padStart(2, "0")}`;
            const s       = shiftMap.get(ds);
            const isToday = ds === todayStr;
            const dow     = new Date(year, month - 1, d).getDay();
            const badge   = getShiftBadge(s?.shift_name ?? null);
            const hasLog  = logMap.has(ds);

            return (
              <button
                key={ds}
                type="button"
                onClick={() => setModal(ds)}
                className={cx(
                  "relative text-left p-2 min-h-[72px] md:min-h-[88px] border-r border-b transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40",
                  isToday
                    ? "border-2 border-[#0d1b35] dark:border-blue-500 -m-px z-10"
                    : "border-zinc-100 dark:border-zinc-800",
                )}
              >
                {/* 日付数字 */}
                <span className={cx(
                  "text-[13px] font-semibold leading-none",
                  isToday   ? "text-[#0d1b35] dark:text-blue-400"
                  : dow === 0 ? "text-red-500 dark:text-red-400"
                  : dow === 6 ? "text-blue-500 dark:text-blue-400"
                  : "text-zinc-700 dark:text-zinc-300",
                )}>
                  {d}
                </span>

                {/* シフトバッジ */}
                {s?.shift_name && badge && (
                  <div className={cx(
                    "mt-1.5 px-1.5 py-1 rounded-lg text-[11px] font-semibold text-center leading-none w-full",
                    badge.bg, badge.text,
                  )}>
                    {s.shift_name.length > 4 ? s.shift_name.slice(0, 4) : s.shift_name}
                  </div>
                )}

                {/* 変更ログドット */}
                {hasLog && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
                )}
              </button>
            );
          })}

          {/* 来月頭の日 */}
          {Array.from({ length: trailing }, (_, i) => (
            <div key={`post${i}`} className="border-r border-b border-zinc-50 dark:border-zinc-800/50 p-2 min-h-[72px] md:min-h-[88px]">
              <span className="text-[12px] text-zinc-300 dark:text-zinc-700">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 詳細モーダル ── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/40"
          onClick={() => setModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div className={cx(
              "px-5 py-4 flex items-center justify-between",
              modalShift?.shift_name ? (getShiftBadge(modalShift.shift_name)?.bg ?? "bg-zinc-100 dark:bg-zinc-800") : "bg-zinc-50 dark:bg-zinc-800",
            )}>
              <span className={cx(
                "text-[13px] font-semibold",
                modalShift?.shift_name ? (getShiftBadge(modalShift.shift_name)?.text ?? "text-zinc-700") : "text-zinc-500",
              )}>
                {modalLabel}
              </span>
              <span className={cx(
                "text-[15px] font-bold",
                modalShift?.shift_name ? (getShiftBadge(modalShift.shift_name)?.text ?? "text-zinc-700") : "text-zinc-400",
              )}>
                {modalShift?.shift_name ?? "シフト未登録"}
              </span>
            </div>

            {/* ボディ */}
            <div className="px-5 py-5 space-y-3">
              {modalShift?.shift_start && (
                <p className="text-[32px] font-bold tabular-nums text-[#0d1b35] dark:text-white text-center">
                  {modalShift.shift_start.slice(0, 5)}
                  <span className="text-zinc-300 dark:text-zinc-600 text-2xl font-light mx-3">〜</span>
                  {modalShift.shift_end?.slice(0, 5) ?? "--:--"}
                </p>
              )}
              {!modalShift && (
                <p className="text-[13px] text-zinc-400 text-center">シフトは登録されていません</p>
              )}
              {modalShift?.note && (
                <p className="text-[13px] text-zinc-500 dark:text-zinc-400 text-center">{modalShift.note}</p>
              )}

              {/* 変更履歴 */}
              {(logMap.get(modal) ?? []).length > 0 && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-1.5">
                  <p className="text-[11px] text-zinc-400 flex items-center gap-1.5 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                    変更履歴
                  </p>
                  {(logMap.get(modal) ?? []).map((l, i) => (
                    <p key={i} className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
                      <span className="font-semibold text-zinc-600 dark:text-zinc-300">{l.changed_by_name}</span>
                      {" が "}
                      {l.action === "delete" ? "削除"
                        : l.action === "create" ? "追加"
                        : `${l.before_shift_name ?? "（なし）"} → ${l.after_shift_name ?? "（なし）"}`}
                      <span className="ml-1 text-zinc-400">{fmtLogAt(l.changed_at)}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* 閉じるボタン */}
            <div className="px-5 pb-5">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="w-full py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-[13px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
