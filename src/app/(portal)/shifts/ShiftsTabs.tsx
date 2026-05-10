"use client";

import { useState } from "react";
import ShiftCalendar from "./ShiftCalendar";
import HolidayCalendar from "@/app/(portal)/holidays/HolidayCalendar";
import RequestClient from "./request/RequestClient";

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
  shifts: ShiftData[];
  todayStr: string;
  initialYear: number;
  initialMonth: number;
  minMonth: string;
  maxMonth: string;
  holidayRequests: HolidayRequest[];
  shiftRequests: ShiftRequest[];
  shiftOpenings: ShiftOpening[];
};

type TabKey = "shift" | "holiday" | "request";

const TABS: { key: TabKey; label: string }[] = [
  { key: "shift",   label: "シフト" },
  { key: "holiday", label: "希望休" },
  { key: "request", label: "追加申請" },
];

export default function ShiftsTabs({
  shifts, todayStr, initialYear, initialMonth, minMonth, maxMonth,
  holidayRequests, shiftRequests, shiftOpenings,
}: Props) {
  const [tab, setTab] = useState<TabKey>("shift");

  return (
    <div className="flex flex-col h-full">

      {/* タブバー */}
      <div className="flex gap-0 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0 mb-4">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={[
              "flex-1 py-2.5 text-sm font-semibold transition-all border-b-2 -mb-px",
              tab === key
                ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-50"
                : "border-transparent text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {/* タブコンテンツ */}
      <div className="flex-1 min-h-0">

        {tab === "shift" && (
          <ShiftCalendar
            shifts={shifts}
            todayStr={todayStr}
            initialYear={initialYear}
            initialMonth={initialMonth}
            minMonth={minMonth}
            maxMonth={maxMonth}
          />
        )}

        {tab === "holiday" && (
          <div className="h-full overflow-y-auto">
            <HolidayCalendar
              initialYear={initialYear}
              initialMonth={initialMonth}
              appliedRequests={holidayRequests}
            />
          </div>
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
