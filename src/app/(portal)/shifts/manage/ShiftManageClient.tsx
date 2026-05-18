"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ShiftDayList from "./ShiftDayList";
import ShiftRequestsAdmin from "./ShiftRequestsAdmin";
import ShiftEditGrid, { type ChangeLog } from "./ShiftEditGrid";
import ShiftDraftPlanner from "./ShiftDraftPlanner";
import type { GridDraftEntry } from "../actions";

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
  id: string; staff_name: string; request_date: string;
  shift_name: string | null; shift_start: string | null; shift_end: string | null;
  reason: string | null; status: string;
};
type SlotReq = { section: string; pattern_name: string; shift_date: string; required_count: number };

type Props = {
  projectId: string;
  targetYear: number;
  targetMonth: number;
  allDates: string[];
  defaultDate: string;
  shifts: Shift[];
  activeMembers: Member[];
  shiftPatterns: Pattern[];
  shiftRequests: ShiftRequest[];
  slotRequirements: SlotReq[];
  changeLogs: ChangeLog[];
  initialDraft: GridDraftEntry[] | null;
  draftSavedBy: string | null;
  draftSavedAt: string | null;
};

export default function ShiftManageClient({
  projectId, targetYear, targetMonth, allDates, defaultDate,
  shifts, activeMembers, shiftPatterns, shiftRequests, slotRequirements,
  changeLogs, initialDraft, draftSavedBy, draftSavedAt,
}: Props) {
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [mode, setMode] = useState<"list" | "edit" | "plan">(
    initialDraft !== null && initialDraft.length > 0 ? "edit" : "list"
  );
  const router = useRouter();

  const targetMonthStr = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;

  function handleSaved() {
    setMode("list");
    router.refresh();
  }

  if (mode === "edit") {
    return (
      <div
        className="flex flex-col"
        style={{ height: "calc(100dvh - var(--header-height, 120px) - 60px)" }}
      >
        <ShiftEditGrid
          projectId={projectId}
          targetMonth={targetMonthStr}
          allDates={allDates}
          shifts={shifts}
          activeMembers={activeMembers}
          shiftPatterns={shiftPatterns}
          slotRequirements={slotRequirements}
          changeLogs={changeLogs}
          initialDraft={initialDraft}
          draftSavedBy={draftSavedBy}
          draftSavedAt={draftSavedAt}
          onSaved={handleSaved}
          onCancel={() => setMode("list")}
        />
      </div>
    );
  }

  if (mode === "plan") {
    return (
      <div className="px-4 space-y-4">
        <div className="flex items-center justify-between pt-1">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">仮組設定</h2>
          <button
            onClick={() => setMode("list")}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            ← 戻る
          </button>
        </div>
        <ShiftDraftPlanner
          projectId={projectId}
          targetYear={targetYear}
          targetMonth={targetMonth}
          allDates={allDates}
          shiftPatterns={shiftPatterns}
          slotRequirements={slotRequirements}
          onStartGenerate={() => {
            // P2-2: 仮組生成アクション（今後実装）
            setMode("edit");
          }}
        />
      </div>
    );
  }

  return (
    <>
      <div className="px-4 flex items-center justify-between mb-2 gap-2">
        {/* 下書きバッジ（あれば） */}
        {initialDraft && initialDraft.length > 0 && (
          <button
            onClick={() => setMode("edit")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
            下書きあり — 続きから編集
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setMode("plan")}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors border border-emerald-200 dark:border-emerald-800"
          >
            仮組
          </button>
          <button
            onClick={() => setMode("edit")}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors border border-blue-200 dark:border-blue-800"
          >
            グリッド編集
          </button>
        </div>
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
