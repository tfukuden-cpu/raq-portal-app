"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import ShiftDayList from "./ShiftDayList";
import ShiftRequestsAdmin from "./ShiftRequestsAdmin";
import ShiftEditGrid, { type ChangeLog } from "./ShiftEditGrid";
import { clearGridDraftAction, type GridDraftEntry } from "../actions";
import { regenerateShiftDraftAction, upsertSingleShiftAction } from "./actions";
import PublishButton from "./PublishButton";
import ShiftLineNotifyButton from "./ShiftLineNotifyButton";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { resolveShiftSection, formatSectionShift, SEAT_SECTION_COLORS } from "@/lib/seatColors";

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
  churn_risk?: boolean; churn_risk_since?: string | null;
  shift_published?: boolean | null; svOrder?: number | null;
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
  slotLockedSections: string[];
  initialEditLock?: { lockedByName: string; lockedAt: string } | null;
  offRequests: OffRequest[];
  prevMonthShifts?: { staff_id: string; shift_date: string; shift_name: string | null }[];
  monthNavBase: string;
  prevMonth: { year: number; month: number };
  nextMonth: { year: number; month: number };
  publishMessageTemplate?: string;
  initialDeclinedIds?: string[]; // "staffId__YYYY-MM-DD"
};

// ── ShiftEditGridOverlay ────────────────────────────────────────
// 編集モード専用ラッパー：ページヘッダーを非表示にして全高を使う
function ShiftEditGridOverlay({
  projectId, targetMonthStr, allDates, shifts, activeMembers, shiftPatterns,
  slotRequirements, changeLogs, activeDraft, draftSavedBy, draftSavedAt,
  offRequests, isPublished, lockedSections, slotLockedSections, initialEditLock,
  prevMonthShifts, sortByAccount, initialDeclinedIds,
  onSaved, onCancel,
}: {
  projectId: string; targetMonthStr: string; allDates: string[];
  shifts: Props["shifts"]; activeMembers: Props["activeMembers"];
  shiftPatterns: Props["shiftPatterns"]; slotRequirements: Props["slotRequirements"];
  changeLogs: Props["changeLogs"]; activeDraft: GridDraftEntry[] | null;
  draftSavedBy: string | null; draftSavedAt: string | null;
  offRequests: Props["offRequests"]; isPublished: boolean;
  lockedSections: string[]; slotLockedSections: string[];
  initialEditLock?: Props["initialEditLock"]; sortByAccount?: boolean;
  prevMonthShifts?: Props["prevMonthShifts"];
  initialDeclinedIds?: string[];
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
        initialSlotLockedSections={slotLockedSections}
        initialEditLock={initialEditLock}
        prevMonthShifts={prevMonthShifts}
        sortByAccount={sortByAccount}
        initialDeclinedIds={initialDeclinedIds}
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

// アカウント番号文字列から数値を抽出（"ASS 28" → 28、未設定 → Infinity）
function getAccNum(acc: string | null | undefined): number {
  if (!acc) return Infinity;
  const m = acc.match(/(\d+)/);
  return m ? parseInt(m[1]) : Infinity;
}

export default function ShiftManageClient({
  projectId, targetYear, targetMonth, allDates, defaultDate,
  shifts, activeMembers: activeMembersRaw, shiftPatterns, shiftRequests, slotRequirements,
  changeLogs, absenceSet, initialDraft, draftSavedBy, draftSavedAt,
  isPublished, lockedSections, slotLockedSections, initialEditLock, offRequests, prevMonthShifts,
  monthNavBase, prevMonth, nextMonth, publishMessageTemplate, initialDeclinedIds = [],
}: Props) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  // ツールバーの高さを --toolbar-h として登録し ShiftDayList の sticky 位置に使う
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const update = () =>
      document.documentElement.style.setProperty("--toolbar-h", `${el.offsetHeight}px`);
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => { obs.disconnect(); document.documentElement.style.removeProperty("--toolbar-h"); };
  }, []);

  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportSectionsSel, setExportSectionsSel] = useState<string[]>([]);
  // 番号順固定（SV先頭、SV以外はアカウント番号順）
  const sortByAccount = true;
  const activeMembers = [...activeMembersRaw].sort((a, b) => {
    const aIsSV = a.section === "SV";
    const bIsSV = b.section === "SV";
    if (aIsSV !== bIsSV) return aIsSV ? -1 : 1;
    if (aIsSV) {
      // SV は手動並び順（sort_order）優先・未設定は末尾→名前順
      const oa = a.svOrder ?? Infinity;
      const ob = b.svOrder ?? Infinity;
      return oa !== ob ? oa - ob : a.name.localeCompare(b.name, "ja");
    }
    const na = getAccNum(a.accountNumber);
    const nb = getAccNum(b.accountNumber);
    return na !== nb ? na - nb : a.name.localeCompare(b.name, "ja");
  });

  // シフトパターンから使用中セクション一覧
  const exportSections = [...new Set(shiftPatterns.map(p => p.section).filter((s): s is string => !!s))];

  function toggleExportSection(section: string) {
    setExportSectionsSel(prev =>
      prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]
    );
  }
  // 実際にグリッドへ渡すドラフト（新規 = null、続きから = initialDraft）
  const [activeDraft, setActiveDraft] = useState<GridDraftEntry[] | null>(null);
  const [isClearing, startClear] = useTransition();
  const [isRegenerating, startRegen] = useTransition();
  const [, startSetKyukyu] = useTransition();
  const router = useRouter();

  const targetMonthStr = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
  const hasDraft = !!(initialDraft && initialDraft.length > 0);

  function handleSetKyukyu(staffId: string, date: string) {
    startSetKyukyu(async () => {
      await upsertSingleShiftAction(projectId, staffId, date, "公休");
      router.refresh();
    });
  }

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
      // 仮確定済みセクションはスキップ（人確定・枠確定両方）
      const r = await regenerateShiftDraftAction(projectId, targetYear, targetMonth, undefined, undefined, [...lockedSections, ...slotLockedSections]);
      if (!r.success) {
        setRegenError(r.message ?? "仮組み生成に失敗しました");
        return;
      }
      setShowRegenModal(false);
      router.refresh();
    });
  }

  // CSV出力（当月全日付を列方向・アカウント番号01-160を行方向）
  function handleExportExcel() {
    // ── シフトデータ確定 ──────────────────────────────────────
    // 展開済み → shifts（DB確定値）、仮保存あり → draft を DB にオーバーレイ
    const effectiveMap = new Map<string, Map<string, string | null>>();
    for (const s of shifts) {
      if (!effectiveMap.has(s.staff_id)) effectiveMap.set(s.staff_id, new Map());
      effectiveMap.get(s.staff_id)!.set(s.shift_date, s.shift_name);
    }
    if (initialDraft && !isPublished) {
      for (const entry of initialDraft) {
        const [staffId, date] = entry.k.split("__");
        if (!effectiveMap.has(staffId)) effectiveMap.set(staffId, new Map());
        effectiveMap.get(staffId)!.set(date, entry.d ? null : entry.n);
      }
    }

    // ── セルの表示値を求めるヘルパー ─────────────────────────
    // ・公休・有休・希望休・特別休暇 → 空白（休日扱い）
    // ・SEAT_SECTION_COLORS 定義済みセクション（販売・査定等）→ セクション（早番/遅番）形式
    // ・未アポ・H MOTA・インフォ等の非カラーセクション → シフト名をそのまま出力
    const OFF_PATTERNS = ["公休", "希望休", "有休", "特別休暇"];
    const KNOWN_SECTIONS = new Set(Object.keys(SEAT_SECTION_COLORS));
    // 選択セクションを既知・未知に分類
    const knownSel = exportSectionsSel.filter(s => KNOWN_SECTIONS.has(s));
    const unknownSel = exportSectionsSel.filter(s => !KNOWN_SECTIONS.has(s));

    function cellValue(staffId: string, date: string): string {
      const shiftName = effectiveMap.get(staffId)?.get(date) ?? null;
      if (!shiftName) return "";
      const sec = resolveShiftSection(shiftName, null);
      if (!sec) {
        // 休日パターンは空白
        if (OFF_PATTERNS.some(p => shiftName.includes(p))) return "";
        // 未アポ・インフォ等：フィルタがある場合は選択セクションに一致するもののみ出力
        if (exportSectionsSel.length > 0) {
          const matches = unknownSel.some(s => shiftName.startsWith(s));
          if (!matches) return "";
        }
        return shiftName;
      }
      if (exportSectionsSel.length > 0 && !exportSectionsSel.includes(sec)) return "";
      return formatSectionShift(sec, shiftName);
    }

    // ── ヘッダー2行（アカウント番号列 + 名前列 + 日付列）──────
    const DAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header1 = ["", "", ...allDates.map(d => {
      const [, m, day] = d.split("-");
      return `${parseInt(m)}/${parseInt(day)}`;
    })];  // 列順: 名前 | アカウント番号 | 日付…
    const header2 = ["", "", ...allDates.map(d =>
      DAY_JP[new Date(`${d}T12:00:00+09:00`).getDay()]
    )];

    // ── 数値キー → メンバー のマップを構築（番号あり）
    const accMap = new Map<number, typeof activeMembers[0]>();
    for (const m of activeMembers) {
      const n = getAccNum(m.accountNumber);
      if (n !== Infinity) accMap.set(n, m);
    }
    const maxAcc = Math.max(160, ...[...accMap.keys()]);

    // ── セクションフィルタ対象メンバーIDセット（空=全員）
    // 既知セクション（販売・査定等）のみメンバーのsectionで絞り込む。
    // 未アポ・インフォ等の非カラーセクションはメンバー属性ではなくシフト割当で判断するため全員表示。
    const sectionIds = knownSel.length > 0
      ? new Set(activeMembers.filter(m => m.section !== null && knownSel.includes(m.section)).map(m => m.id))
      : null;

    // ── データ行①：ASS 01〜maxAcc を昇順で必ず出力
    const dataRows: string[][] = [];
    for (let i = 1; i <= maxAcc; i++) {
      const m = accMap.get(i);
      const accLabel = `ASS ${String(i).padStart(2, "0")}`;
      const nameLabel = m?.name ?? "";

      if (!m || (sectionIds && !sectionIds.has(m.id))) {
        dataRows.push(["", accLabel, ...allDates.map(() => "")]);
      } else {
        dataRows.push([nameLabel, accLabel, ...allDates.map(date => cellValue(m.id, date))]);
      }
    }

    // ── データ行②：アカウント番号未設定メンバーを末尾に追加
    const noAccMembers = activeMembers.filter(m => getAccNum(m.accountNumber) === Infinity);
    for (const m of noAccMembers) {
      if (sectionIds && !sectionIds.has(m.id)) continue;
      dataRows.push([m.name, "", ...allDates.map(date => cellValue(m.id, date))]);
    }

    const csv = [header1, header2, ...dataRows]
      .map(r => r.map(c => esc(String(c))).join(","))
      .join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const monthStr = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
    const suffix = exportSectionsSel.length > 0 ? `_${exportSectionsSel.join("_")}` : "";
    a.download = `シフト_${monthStr}${suffix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportModal(false);
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
      slotLockedSections={slotLockedSections}
      initialEditLock={initialEditLock}
      prevMonthShifts={prevMonthShifts}
      sortByAccount={sortByAccount}
      initialDeclinedIds={initialDeclinedIds}
      onSaved={handleSaved}
      onCancel={() => setMode("list")}
    />;
  }

  return (
    <div className="w-full pb-24 pt-3">
      {/* Excel出力 セクション選択モーダル */}
      {showExportModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => setShowExportModal(false)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-xs px-5 pt-5 space-y-4"
            style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))" }}
            onClick={e => e.stopPropagation()}
          >
            <div>
              <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">Excel出力</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {targetYear}/{String(targetMonth).padStart(2, "0")} の月次シフト
                <span className="ml-1">
                  {exportSectionsSel.length === 0 ? "（全員）" : `（${exportSectionsSel.join("・")}）`}
                </span>
              </p>
            </div>

            {/* チェックボックス一覧（複数選択・未選択=全員） */}
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {exportSections.map(section => {
                const checked = exportSectionsSel.includes(section);
                return (
                  <label
                    key={section}
                    className={[
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors select-none",
                      checked
                        ? "border-emerald-400 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
                        : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleExportSection(section)}
                      className="accent-emerald-500 w-4 h-4"
                    />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{section}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-400 -mt-1">※ 未選択の場合は全員を出力</p>

            <button
              onClick={handleExportExcel}
              className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              出力する
            </button>
            <button
              onClick={() => setShowExportModal(false)}
              className="w-full py-2 rounded-xl text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

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

      {/* ツールバー（sticky） */}
      <div ref={toolbarRef} className="sticky z-40 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800 px-4 py-2 flex flex-wrap items-center gap-3" style={{ top: "var(--page-header-h, 0px)" }}>
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

        {/* LINE通知ボタン（シフト展開とは独立） */}
        <ShiftLineNotifyButton
          projectId={projectId}
          year={targetYear}
          month={targetMonth}
          members={activeMembers.map(m => ({ id: m.id, name: m.name }))}
          defaultTemplate={publishMessageTemplate}
        />

        {/* まとめたボタン群：シフト展開 ／ Excel出力 ／ シフト編集 */}
        <div className="flex items-stretch rounded-xl border border-zinc-200 dark:border-zinc-700 divide-x divide-zinc-200 dark:divide-zinc-700 overflow-hidden text-xs font-semibold">
          {/* シフト展開（flat=true で角丸なし・グループに馴染む） */}
          <PublishButton
            projectId={projectId}
            year={targetYear}
            month={targetMonth}
            isPublished={isPublished}
            flat
          />

          {/* Excel出力 */}
          <button
            onClick={() => setShowExportModal(true)}
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
        sortByAccount={sortByAccount}
        onSetKyukyu={sortByAccount ? handleSetKyukyu : undefined}
        initialDeclinedIds={initialDeclinedIds}
      />
    </div>
  );
}

