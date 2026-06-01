"use client";

import { useState } from "react";
import ShiftCalendar, { type ShiftChangeLog } from "./ShiftCalendar";
import HolidayTab from "./HolidayTab";
import RequestClient from "./request/RequestClient";

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
  { key: "shift",   label: "月間カレンダー" },
  { key: "holiday", label: "希望休申請" },
  { key: "request", label: "追加申請" },
];

export default function ShiftsTabs({
  projectId,
  shifts, changeLogs = [], todayStr, initialYear, initialMonth, minMonth, maxMonth,
  holidayRequests, shiftRequests, shiftOpenings,
  holidayOpenDay = null, holidayDeadlineDay = null, holidayMaxDaysPerMonth = null, holidayWeekendLimit = null,
}: Props) {
  const [tab, setTab]     = useState<TabKey>("shift");
  const [year, setYear]   = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);

  const goMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#f4f6fa] dark:bg-zinc-950">

      {/* ── ページヘッダー ── */}
      <div className="max-w-6xl mx-auto w-full px-4 md:px-8 pt-6 pb-4 flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-[22px] md:text-[24px] font-bold text-[#0d1b35] dark:text-white">
          勤務スケジュール
        </h1>
        {/* タブボタン群 */}
        <div className="flex items-center gap-2">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={[
                "px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors whitespace-nowrap",
                tab === key
                  ? "bg-[#0d1b35] text-white shadow-sm"
                  : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── コンテンツ ── */}
      <div className="max-w-6xl mx-auto w-full px-4 md:px-8 pb-28 md:pb-12 flex-1">

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
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
            <HolidayTab
              projectId={projectId}
              holidayRequests={holidayRequests}
              initialYear={year}
              initialMonth={month}
              openDay={holidayOpenDay}
              deadlineDay={holidayDeadlineDay}
              maxDaysPerMonth={holidayMaxDaysPerMonth}
              weekendLimit={holidayWeekendLimit}
            />
          </div>
        )}

        {tab === "request" && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
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
