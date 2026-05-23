"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ShiftDayList from "./ShiftDayList";
import ShiftRequestsAdmin from "./ShiftRequestsAdmin";
import ShiftEditGrid, { type ChangeLog } from "./ShiftEditGrid";
import { clearGridDraftAction, type GridDraftEntry } from "../actions";

type Shift = {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  note: string | null;
};
type Member = { id: string; name: string; role: string; section: string | null; sections: string[] };
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
type OffRequest = { staff_id: string; request_date: string; priority: string };

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
  absenceSet: Set<string>;
  initialDraft: GridDraftEntry[] | null;
  draftSavedBy: string | null;
  draftSavedAt: string | null;
  offRequests: OffRequest[];
};

function fmtAt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ShiftManageClient({
  projectId, targetYear, targetMonth, allDates, defaultDate,
  shifts, activeMembers, shiftPatterns, shiftRequests, slotRequirements,
  changeLogs, absenceSet, initialDraft, draftSavedBy, draftSavedAt,
  offRequests,
}: Props) {
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [showDraftModal, setShowDraftModal] = useState(false);
  // 実際にグリッドへ渡すドラフト（新規 = null、続きから = initialDraft）
  const [activeDraft, setActiveDraft] = useState<GridDraftEntry[] | null>(null);
  const [isClearing, startClear] = useTransition();
  const router = useRouter();

  const targetMonthStr = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
  const hasDraft = !!(initialDraft && initialDraft.length > 0);

  function handleSaved() {
    setMode("list");
    router.refresh();
  }

  // 「グリッド編集」ボタン押下
  function handleClickEdit() {
    if (hasDraft) {
      setShowDraftModal(true);
    } else {
      setActiveDraft(null);
      setMode("edit");
    }
  }

  // 「続きから編集」
  function handleChooseContinue() {
    setActiveDraft(initialDraft);
    setShowDraftModal(false);
    setMode("edit");
  }

  // 「新規から始める」= 下書きを削除してから開始
  function handleChooseNew() {
    startClear(async () => {
      await clearGridDraftAction(projectId, targetMonthStr);
      setActiveDraft(null);
      setShowDraftModal(false);
      setMode("edit");
    });
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
          initialDraft={activeDraft}
          draftSavedBy={activeDraft ? draftSavedBy : null}
          draftSavedAt={activeDraft ? draftSavedAt : null}
          onSaved={handleSaved}
          onCancel={() => setMode("list")}
        />
      </div>
    );
  }

  return (
    <>
      {/* 下書き選択モーダル */}
      {showDraftModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => setShowDraftModal(false)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm px-4 pt-4 space-y-2"
            style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom, 0px))" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-1">
              <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">シフト編集を開始</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                保存済みの下書きがあります
                {draftSavedBy && (
                  <span className="ml-1 text-amber-500 dark:text-amber-400">
                    （{draftSavedBy}{draftSavedAt ? `　${fmtAt(draftSavedAt)}` : ""}）
                  </span>
                )}
              </p>
            </div>

            <button
              onClick={handleChooseContinue}
              className="w-full py-3 rounded-xl text-sm font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors"
            >
              続きから編集
            </button>

            <button
              onClick={handleChooseNew}
              disabled={isClearing}
              className="w-full py-3 rounded-xl text-sm font-semibold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              {isClearing ? "削除中…" : "新規から始める（下書きを削除）"}
            </button>

            <button
              onClick={() => setShowDraftModal(false)}
              className="w-full py-2 rounded-xl text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div className="px-4 flex items-center justify-between mb-2 gap-2">
        {/* 下書きインジケーター（あれば） */}
        {hasDraft && (
          <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
            下書きあり
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={handleClickEdit}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors border border-blue-200 dark:border-blue-800"
          >
            シフト編集
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
        changeLogs={changeLogs}
        absenceSet={absenceSet}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        projectId={projectId}
        targetYear={targetYear}
        targetMonth={targetMonth}
        offRequests={offRequests}
      />
    </>
  );
}
