"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import ShiftDayList from "./ShiftDayList";
import ShiftRequestsAdmin from "./ShiftRequestsAdmin";
import ShiftEditGrid, { type ChangeLog } from "./ShiftEditGrid";
import { clearGridDraftAction, type GridDraftEntry } from "../actions";
import { regenerateShiftDraftAction } from "./actions";
import PublishButton from "./PublishButton";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { resolveShiftSection, formatSectionShift } from "@/lib/seatColors";

type Shift = {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  note: string | null;
};
type Member = {
  id: string; name: string; role: string; section: string | null; sections: string[];
  work_days_type: string | null; work_days_count: number | null;
  preferred_shift: string | null; preferred_section: string | null;
  max_consecutive_days: number | null; shift_note: string | null;
  accountNumber?: string | null;
};
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
type OffRequest = { staff_id: string; request_date: string; priority: string; source: string };

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
  isPublished: boolean;
  lockedSections: string[];
  offRequests: OffRequest[];
  prevMonthShifts?: { staff_id: string; shift_date: string; shift_name: string | null }[];
  monthNavBase: string;
  prevMonth: { year: number; month: number };
  nextMonth: { year: number; month: number };
};

// ── ShiftEditGridOverlay ────────────────────────────────────────
// 編集モード専用ラッパー：ページヘッダーを非表示にして全高を使う
function ShiftEditGridOverlay({
  projectId, targetMonthStr, allDates, shifts, activeMembers, shiftPatterns,
  slotRequirements, changeLogs, activeDraft, draftSavedBy, draftSavedAt,
  offRequests, isPublished, lockedSections, prevMonthShifts,
  onSaved, onCancel,
}: {
  projectId: string; targetMonthStr: string; allDates: string[];
  shifts: Props["shifts"]; activeMembers: Props["activeMembers"];
  shiftPatterns: Props["shiftPatterns"]; slotRequirements: Props["slotRequirements"];
  changeLogs: Props["changeLogs"]; activeDraft: GridDraftEntry[] | null;
  draftSavedBy: string | null; draftSavedAt: string | null;
  offRequests: Props["offRequests"]; isPublished: boolean;
  lockedSections: string[];
  prevMonthShifts?: Props["prevMonthShifts"];
  onSaved: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    const header = document.getElementById("shift-manage-header");
    if (header) {
      header.style.display = "none";
      document.documentElement.style.setProperty("--page-header-h", "0px");
    }
    return () => {
      if (header) {
        header.style.display = "";
        document.documentElement.style.removeProperty("--page-header-h");
      }
    };
  }, []);

  return (
    <div
      className="flex flex-col"
      style={{ height: "calc(100dvh - 60px)" }}
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
        offRequests={offRequests}
        isPublished={isPublished}
        initialLockedSections={lockedSections}
        prevMonthShifts={prevMonthShifts}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    </div>
  );
}

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
  isPublished, lockedSections, offRequests, prevMonthShifts,
  monthNavBase, prevMonth, nextMonth,
}: Props) {
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [exportSection, setExportSection] = useState("");

  // シフトパターンから使用中セクション一覧
  const exportSections = [...new Set(shiftPatterns.map(p => p.section).filter((s): s is string => !!s))];
  // 実際にグリッドへ渡すドラフト（新規 = null、続きから = initialDraft）
  const [activeDraft, setActiveDraft] = useState<GridDraftEntry[] | null>(null);
  const [isClearing, startClear] = useTransition();
  const [isRegenerating, startRegen] = useTransition();
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

  // 「再仮組」= 仮組みを再生成してグリッド編集に移行
  function handleRegen() {
    setRegenError(null);
    startRegen(async () => {
      // 仮確定済みセクションはスキップ（解除するまで保持）
      const r = await regenerateShiftDraftAction(projectId, targetYear, targetMonth, undefined, undefined, lockedSections);
      if (!r.success) {
        setRegenError(r.message ?? "仮組み生成に失敗しました");
        return;
      }
      setShowRegenModal(false);
      router.refresh();
    });
  }

  // CSV出力（選択日のシフトをアカウント番号順に出力・Excelで開ける）
  function handleExportExcel() {
    const dateShifts = shifts.filter(s => s.shift_date === selectedDate);
    const shiftMap = new Map(dateShifts.map(s => [s.staff_id, s]));

    // アカウント番号で数値昇順ソート、未設定は末尾
    let sorted = [...activeMembers].sort((a, b) => {
      const na = parseInt(a.accountNumber ?? "") || Infinity;
      const nb = parseInt(b.accountNumber ?? "") || Infinity;
      return na - nb;
    });

    // セクションフィルタ
    if (exportSection) {
      sorted = sorted.filter(m => {
        const shift = shiftMap.get(m.id);
        const resolved = resolveShiftSection(shift?.shift_name ?? null, m.section);
        return resolved === exportSection;
      });
    }

    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = ["アカウント番号", "氏名", "日付", "シフト名", "セクション（シフト）"];
    const rows = sorted.map(m => {
      const shift = shiftMap.get(m.id);
      const shiftName = shift?.shift_name ?? "";
      const section = resolveShiftSection(shiftName || null, m.section);
      const sectionShift = formatSectionShift(section, shiftName || null);
      return [m.accountNumber ?? "", m.name, selectedDate, shiftName, sectionShift];
    });

    const csv = [header, ...rows].map(r => r.map(c => esc(String(c))).join(",")).join("\r\n");
    // BOM付きUTF-8でExcelが文字化けしないように
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const suffix = exportSection ? `_${exportSection}` : "";
    a.download = `シフト_${selectedDate}${suffix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (mode === "edit") {
    return <ShiftEditGridOverlay
      projectId={projectId}
      targetMonthStr={targetMonthStr}
      allDates={allDates}
      shifts={shifts}
      activeMembers={activeMembers}
      shiftPatterns={shiftPatterns}
      slotRequirements={slotRequirements}
      changeLogs={changeLogs}
      activeDraft={activeDraft}
      draftSavedBy={draftSavedBy}
      draftSavedAt={draftSavedAt}
      offRequests={offRequests}
      isPublished={isPublished}
      lockedSections={lockedSections}
      prevMonthShifts={prevMonthShifts}
      onSaved={handleSaved}
      onCancel={() => setMode("list")}
    />;
  }

  return (
    <div className="max-w-5xl mx-auto pb-24 pt-3">
      {/* 再仮組確認モーダル */}
      {showRegenModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => { if (!isRegenerating) setShowRegenModal(false); }}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm px-4 pt-4 space-y-2"
            style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom, 0px))" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-1">
              <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">再仮組みを実行</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                希望休・シフトパターンをもとに自動でシフト仮組みを生成します。<br />
                既存の下書きは上書きされます。
              </p>
            </div>

            {regenError && (
              <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2">
                {regenError}
              </p>
            )}

            <button
              onClick={handleRegen}
              disabled={isRegenerating}
              className="w-full py-3 rounded-xl text-sm font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/60 disabled:opacity-50 transition-colors"
            >
              {isRegenerating ? "生成中…" : "再仮組みを実行"}
            </button>

            <button
              onClick={() => setShowRegenModal(false)}
              disabled={isRegenerating}
              className="w-full py-2 rounded-xl text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-50 transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

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

      {/* ツールバー */}
      <div className="px-4 mb-2 flex flex-wrap items-center gap-3">
        {/* 月ナビゲーション（大きめ） */}
        <div className="flex items-center gap-0.5">
          <a
            href={`${monthNavBase}${prevMonth.year}&month=${prevMonth.month}`}
            className="p-1.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <ChevronLeftIcon className="w-5 h-5 text-zinc-500" />
          </a>
          <span className="text-lg font-bold tabular-nums w-28 text-center text-zinc-900 dark:text-zinc-100">
            {targetYear}/{String(targetMonth).padStart(2, "0")}
          </span>
          <a
            href={`${monthNavBase}${nextMonth.year}&month=${nextMonth.month}`}
            className="p-1.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <ChevronRightIcon className="w-5 h-5 text-zinc-500" />
          </a>
        </div>

        {/* 下書きインジケーター */}
        {hasDraft && (
          <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
            下書きあり
          </span>
        )}

        {/* まとめたボタン群：シフト展開 ／ セクション▼ Excel出力 ／ シフト編集 */}
        <div className="flex items-stretch ml-auto rounded-xl border border-zinc-200 dark:border-zinc-700 divide-x divide-zinc-200 dark:divide-zinc-700 overflow-hidden text-xs font-semibold">
          {/* シフト展開（flat=true で角丸なし・グループに馴染む） */}
          <PublishButton
            projectId={projectId}
            year={targetYear}
            month={targetMonth}
            isPublished={isPublished}
            flat
          />

          {/* セクション選択 */}
          <select
            value={exportSection}
            onChange={e => setExportSection(e.target.value)}
            className="px-2 py-1.5 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 focus:outline-none text-xs border-r border-zinc-200 dark:border-zinc-700"
          >
            <option value="">全員</option>
            {exportSections.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Excel出力 */}
          <button
            onClick={handleExportExcel}
            className="px-3 py-1.5 bg-white dark:bg-zinc-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
          >
            Excel出力
          </button>

          {/* シフト編集 */}
          <button
            onClick={handleClickEdit}
            className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
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
        availableSections={[...new Set(shiftPatterns.map(p => p.section).filter((s): s is string => !!s))]}
        shiftPatternNames={shiftPatterns.map(p => p.name).filter(Boolean)}
      />
    </div>
  );
}

