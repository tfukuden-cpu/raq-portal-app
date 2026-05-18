"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ShiftDayList from "./ShiftDayList";
import ShiftRequestsAdmin from "./ShiftRequestsAdmin";
import ShiftEditGrid from "./ShiftEditGrid";

type Shift = {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  note: string | null;
};

type Member = { id: string; name: string; role: string; section: string | null };

type Pattern = {
  name: string;
  required_count: number;
  required_weekday: number | null;
  required_weekend: number | null;
  section: string | null;
  start_time: string | null;
  end_time: string | null;
};

type ShiftRequest = {
  id: string;
  staff_name: string;
  request_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  reason: string | null;
  status: string;
};

type SlotReq = { section: string; pattern_name: string; shift_date: string; required_count: number };

type Props = {
  projectId: string;
  allDates: string[];
  defaultDate: string;
  shifts: Shift[];
  activeMembers: Member[];
  shiftPatterns: Pattern[];
  shiftRequests: ShiftRequest[];
  slotRequirements: SlotReq[];
  targetYear: number;
  targetMonth: number;
};

export default function ShiftManageClient({
  projectId,
  allDates,
  defaultDate,
  shifts,
  activeMembers,
  shiftPatterns,
  shiftRequests,
  slotRequirements,
  targetYear,
  targetMonth,
}: Props) {
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [editMode, setEditMode] = useState(false);
  const router = useRouter();

  function enterEditMode() {
    setEditMode(true);
  }

  function exitEditMode() {
    setEditMode(false);
  }

  function handleSaved() {
    setEditMode(false);
    router.refresh();
  }

  if (editMode) {
    return (
      <div
        className="flex flex-col"
        style={{ height: "calc(100dvh - var(--header-height, 120px) - 60px)" }}
      >
        <ShiftEditGrid
          projectId={projectId}
          allDates={allDates}
          shifts={shifts}
          activeMembers={activeMembers}
          shiftPatterns={shiftPatterns}
          slotRequirements={slotRequirements}
          onSaved={handleSaved}
          onCancel={exitEditMode}
        />
      </div>
    );
  }

  return (
    <>
      {/* グリッド編集ボタン */}
      <div className="px-4 flex justify-end mb-2">
        <button
          onClick={enterEditMode}
          className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors border border-blue-200 dark:border-blue-800"
        >
          グリッド編集
        </button>
      </div>

      <div className="px-4">
        <ShiftRequestsAdmin requests={shiftRequests} />
      </div>

      <ShiftDayList
        allDates={allDates}
        shifts={shifts}
        activeMembers={activeMembers}
        shiftPatterns={shiftPatterns}
        slotRequirements={slotRequirements}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        projectId={projectId}
        targetYear={targetYear}
        targetMonth={targetMonth}
      />
    </>
  );
}
