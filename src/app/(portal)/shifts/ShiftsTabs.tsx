"use client";

import { useState } from "react";
import ShiftCalendar, { type ShiftChangeLog } from "./ShiftCalendar";
import HolidayTab from "./HolidayTab";
import RequestClient from "./request/RequestClient";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

// ── 型定義 ──────────────────────────────────────────────
type ShiftData = {
  shift_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  note?: string | null;
};

type HolidayRequest = {
  id: string;
  request_date: string;
  status: string;
  note: string | null;
};

type ShiftRequest = {
  id: string;
  request_date: string;
  opening_id: string | null;
  preferred_start: string | null;
  preferred_end: string | null;
  reason: string | null;
  status: string;
  created_at: string;
};

type ShiftOpening = {
  id: string;
  opening_date: string;
  shift_name: string;
  shift_start: string;
  shift_end: string;
  capacity: number;
  note: string | null;
};

type Props = {
  projectId: string;
  shifts: ShiftData[];
  changeLogs?: ShiftChangeLog[];
  todayStr: string;
  initialYear: number;
  initialMonth: number;
  minMonth: string;
  maxMonth: string;
  holidayRequests: HolidayRequest[];
  shiftRequests: ShiftRequest[];
  shiftOpenings: ShiftOpening[];
  holidayOpenDay?: number | null;
  holidayDeadlineDay?: number | null;
  holidayMaxDaysPerMonth?: number | null;
  holidayWeekendLimit?: number | null;
};

type TabKey = "shift" | "holiday" | "request";

const TABS: { key: TabKey; label: string }[] = [
  { key: "shift",   label: "シフト" },
  { key: "holiday", label: "希望休" },
  { key: "request", label: "追加申請" },
];

export default function ShiftsTabs({
  projectId,
  shifts, changeLogs = [], todayStr, initialYear, initialMonth, minMonth, maxMonth,
  holidayRequests, shiftRequests, shiftOpenings,
  holidayOpenDay = null, holidayDeadlineDay = null, holidayMaxDaysPerMonth = null, holidayWeekendLimit = null,
}: Props) {
  const [tab, setTab] = useState<TabKey>("shift");
  // シフトタブの月ナビ状態（ShiftCalendar に渡す制御値）
  const [year, setYear]   = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const canPrev  = monthStr > minMonth;
  const canNext  = monthStr < maxMonth;

  const goMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  return (
    <div className="flex flex-col h-full">

      {/* ── 固定ヘッダー（タイトル・タブ・月ナビ） ── */}
      <div className="sticky top-0 z-30 shrink-0 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        {/* タイトル行 */}
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">シフト</h1>
        </div>
        {/* タブバー */}
        <div className="max-w-5xl mx-auto flex overflow-x-auto px-4 -mx-0 mt-2" style={{ scrollbarWidth: "none" }}>
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={[
                "px-4 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors flex-shrink-0",
                tab === key
                  ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
        {/* シフトタブ：月ナビ固定エリア */}
        {tab === "shift" && (
          <div className="max-w-5xl mx-auto flex items-center justify-center gap-3 px-4 py-2 border-t border-zinc-100 dark:border-zinc-800">
            <button type="button" onClick={() => goMonth(-1)} disabled={!canPrev}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors">
              <ChevronLeftIcon className="w-4 h-4 text-zinc-500" />
            </button>
            <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-50 w-24 text-center">
              {year}年 {month}月
            </span>
            <button type="button" onClick={() => goMonth(1)} disabled={!canNext}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors">
              <ChevronRightIcon className="w-4 h-4 text-zinc-500" />
            </button>
          </div>
        )}
      </div>

      {/* ── タブコンテンツ ── */}
      <div className="flex-1 min-h-0 px-4 pt-2">

        {tab === "shift" && (
          <ShiftCalendar
            shifts={shifts}
            changeLogs={changeLogs}
            todayStr={todayStr}
            initialYear={initialYear}
            initialMonth={initialMonth}
            minMonth={minMonth}
            maxMonth={maxMonth}
            controlledYear={year}
            controlledMonth={month}
            onGoMonth={goMonth}
          />
        )}

        {tab === "holiday" && (
          <HolidayTab
            projectId={projectId}
            holidayRequests={holidayRequests}
            initialYear={initialYear}
            initialMonth={initialMonth}
            openDay={holidayOpenDay}
            deadlineDay={holidayDeadlineDay}
            maxDaysPerMonth={holidayMaxDaysPerMonth}
            weekendLimit={holidayWeekendLimit}
          />
        )}

        {tab === "request" && (
          <div className="h-full overflow-y-auto">
            <RequestClient
              openings={shiftOpenings}
              existingRequests={shiftRequests}
              todayStr={todayStr}
              initialYear={initialYear}
              initialMonth={initialMonth}
            />
          </div>
        )}
      </div>
    </div>
  );
}
