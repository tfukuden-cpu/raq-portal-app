"use client";

/**
 * ShiftEditGrid — パターン軸グリッド編集モード
 *
 * 行 = シフトパターン、列 = 日付
 * 各セルにそのパターンで働くスタッフ名を上詰め表示
 *
 * ドラッグ: スタッフ名チップを別セルへ → パターン/日付を変更
 * タップ:  スタッフチップ → パターン変更/削除
 *          空セル        → スタッフを追加（希望休・公休スタッフも選択可）
 *          カウント行    → 必要人数をインライン編集
 *
 * 仮保存:  確定しないまま DB に下書きを保存、次回ロード時に続きから編集
 * 確定:    実際の shifts テーブルへ反映（変更ログ付き）
 */

import React, { useState, useMemo, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent, DragOverEvent } from "@dnd-kit/core";
import {
  bulkUpsertShiftsAction,
  saveGridDraftAction,
  clearGridDraftAction,
  type BulkUpsertItem,
  type BulkDeleteItem,
  type GridDraftEntry,
} from "../actions";
import { upsertSlotRequirementsAction } from "./actions";

// ── Types ──────────────────────────────────────────────────────

type Shift = {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
};
type Member = { id: string; name: string; section: string | null };
type MemberWithStatus = Member & { currentShift: string | null };
type Pattern = {
  name: string;
  required_count: number;
  section: string | null;
  start_time: string | null;
  end_time: string | null;
};
type SlotReq = { section: string; pattern_name: string; shift_date: string; required_count: number };

export type ChangeLog = {
  staff_id: string;
  shift_date: string;
  action: string;
  before_shift_name: string | null;
  after_shift_name: string | null;
  changed_by_name: string;
  changed_at: string;
};

type DraftValue = { shiftName: string | null; shiftStart: string | null; shiftEnd: string | null };
type DraftCell = DraftValue | null;

type EditTarget =
  | { kind: "existing"; staffId: string; patternName: string; date: string }
  | { kind: "empty";    patternName: string; date: string };

type ErrorAnnotation = { staffId: string; date: string; message: string };

interface Props {
  projectId: string;
  targetMonth: string;
  allDates: string[];
  shifts: Shift[];
  activeMembers: Member[];
  shiftPatterns: Pattern[];
  slotRequirements: SlotReq[];
  changeLogs: ChangeLog[];
  initialDraft: GridDraftEntry[] | null;
  draftSavedBy: string | null;
  draftSavedAt: string | null;
  onSaved: () => void;
  onCancel: () => void;
}

// ── Section compatibility ──────────────────────────────────────
function canAssign(member: Member, pattern: Pattern): boolean {
  if (!pattern.section) return true;
  if (!member.section) return true;
  return member.section === pattern.section;
}

// ── Date helpers ───────────────────────────────────────────────

const todayJST = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

function dowLabel(d: string) {
  return ["日", "月", "火", "水", "木", "金", "土"][new Date(d + "T00:00:00+09:00").getDay()];
}
function dowNum(d: string) {
  return new Date(d + "T00:00:00+09:00").getDay();
}
function fmtDate(d: string) {
  return `${parseInt(d.slice(5, 7))}/${parseInt(d.slice(8))}（${dowLabel(d)}）`;
}
function fmtAt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── DraggableChip ──────────────────────────────────────────────

function DraggableChip({
  staffId, shiftDate, name, isDraft, hasLog, isDuplicate,
}: {
  staffId: string; shiftDate: string; name: string;
  isDraft: boolean; hasLog: boolean; isDuplicate: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${staffId}__${shiftDate}`,
    data: { staffId, shiftDate },
  });

  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={[
        "block text-[11px] leading-tight px-0.5 rounded",
        "cursor-grab active:cursor-grabbing select-none touch-none truncate w-full",
        isDragging ? "opacity-20" : "",
        isDuplicate
          ? "text-red-600 dark:text-red-400 font-bold"
          : isDraft
          ? "text-blue-700 dark:text-blue-400 font-bold"
          : "text-zinc-800 dark:text-zinc-200",
      ].filter(Boolean).join(" ")}
    >
      {name}
      {isDuplicate && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 align-top ml-0.5 mt-0.5" />
      )}
      {hasLog && !isDraft && !isDuplicate && (
        <span className="inline-block w-1 h-1 rounded-full bg-amber-400 align-top ml-0.5 mt-0.5" />
      )}
    </span>
  );
}

// ── SlotCellFull ────────────────────────────────────────────────

function SlotCellFull({
  patternName, date, rowIdx, staffId, staffName,
  isDraft, isToday, isOverCol, hasLog, isDuplicate,
  bubbleMessage, onClick,
}: {
  patternName: string; date: string; rowIdx: number;
  staffId: string | null; staffName: string | null;
  isDraft: boolean; isToday: boolean; isOverCol: boolean;
  hasLog: boolean; isDuplicate: boolean;
  bubbleMessage?: string;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot__${rowIdx}__${patternName}__${date}`,
    data: { type: "slot", patternName, date, rowIdx },
  });

  const hasBubble = !!bubbleMessage;

  return (
    <td
      ref={setNodeRef}
      onClick={onClick}
      className={[
        "border-b border-r border-zinc-100 dark:border-zinc-800",
        "h-8 align-middle p-0 cursor-pointer",
        hasBubble ? "overflow-visible relative" : "overflow-hidden",
        isOver
          ? "bg-blue-100 dark:bg-blue-900/50 ring-inset ring-2 ring-blue-400"
          : isOverCol
          ? "bg-blue-50/60 dark:bg-blue-950/20"
          : isDuplicate && staffId
          ? "bg-red-50/60 dark:bg-red-950/15"
          : isToday
          ? "bg-blue-50/40 dark:bg-blue-950/10"
          : "",
      ].filter(Boolean).join(" ")}
    >
      {/* 吹き出しバブル（エラー or 重複） */}
      {hasBubble && (
        <div
          className="absolute top-full left-0 z-50 pointer-events-none mt-0.5"
          style={{ minWidth: "120px", maxWidth: "200px" }}
        >
          {/* 上向き三角（吹き出しの根元） */}
          <div className="ml-3 w-0 h-0 border-l-[5px] border-r-[5px] border-b-[5px] border-l-transparent border-r-transparent border-b-red-500" />
          <div className="bg-red-500 text-white text-[9px] leading-snug px-2 py-1.5 rounded-lg shadow-lg whitespace-normal -mt-px">
            {bubbleMessage}
          </div>
        </div>
      )}
      {/* セル本体 */}
      <div className="px-0.5 h-full flex items-center overflow-hidden">
        {staffId && staffName && (
          <DraggableChip
            staffId={staffId} shiftDate={date} name={staffName}
            isDraft={isDraft} hasLog={hasLog && !isDraft} isDuplicate={isDuplicate}
          />
        )}
      </div>
    </td>
  );
}

// ── CountCell ──────────────────────────────────────────────────

function CountCell({
  assigned, required, isToday, isEditing,
  onStartEdit, onChange, onEndEdit,
}: {
  assigned: number; required: number; isToday: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onChange: (v: number) => void;
  onEndEdit: () => void;
}) {
  const shortage = required > 0 && assigned < required;
  const ok = required === 0 || assigned >= required;

  if (isEditing) {
    return (
      <td className={[
        "border-b-2 border-r border-zinc-200 dark:border-zinc-700 p-0",
        isToday ? "bg-blue-50/50 dark:bg-blue-950/20" : "bg-zinc-50 dark:bg-zinc-900/60",
      ].join(" ")}>
        <input
          type="number"
          min={0}
          defaultValue={required}
          onChange={e => onChange(Math.max(0, parseInt(e.target.value) || 0))}
          onBlur={onEndEdit}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
          autoFocus
          className="w-full h-6 text-center text-[10px] tabular-nums bg-blue-100 dark:bg-blue-950/60 outline-none border-2 border-blue-400 rounded"
          onClick={e => e.stopPropagation()}
        />
      </td>
    );
  }

  return (
    <td
      onClick={onStartEdit}
      className={[
        "text-center tabular-nums font-medium border-b-2 border-r border-zinc-200 dark:border-zinc-700",
        "cursor-pointer select-none",
        isToday
          ? "bg-blue-50/50 dark:bg-blue-950/20"
          : shortage
          ? "bg-red-50/70 dark:bg-red-950/20"
          : "bg-zinc-50 dark:bg-zinc-900/60",
      ].filter(Boolean).join(" ")}
    >
      {required === 0 ? (
        <span className="text-[9px] text-zinc-300 dark:text-zinc-600 py-1 block">-</span>
      ) : (
        <div className="flex flex-col items-center justify-center py-0.5">
          <span className={`text-[10px] leading-none ${ok ? "text-zinc-400 dark:text-zinc-500" : "text-red-500 dark:text-red-400 font-bold"}`}>
            {assigned}/{required}
          </span>
          {shortage && (
            <span className="text-[8px] leading-none text-red-400 dark:text-red-500 tabular-nums mt-px">
              -{required - assigned}人
            </span>
          )}
        </div>
      )}
    </td>
  );
}

// ── SummaryModal ────────────────────────────────────────────────

function SummaryModal({
  draftChanges, onClose,
}: {
  draftChanges: { staffName: string; date: string; from: string | null; to: string | null }[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">変更サマリー</h2>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3">
          <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
            変更一覧（{draftChanges.length}件）
          </p>
          {draftChanges.length === 0 ? (
            <p className="text-sm text-zinc-400 text-center py-3">変更なし</p>
          ) : (
            <div className="space-y-1.5">
              {draftChanges.map((c, i) => (
                <div key={i} className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-700 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 truncate">{c.staffName}</p>
                    <p className="text-[11px] text-zinc-400">{fmtDate(c.date)}</p>
                  </div>
                  <div className="text-xs shrink-0 text-right leading-snug">
                    {!c.from && c.to && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">新規 {c.to}</span>
                    )}
                    {c.from && !c.to && (
                      <span className="text-red-500 dark:text-red-400 font-bold">{c.from} 削除</span>
                    )}
                    {c.from && c.to && (
                      <span>
                        <span className="text-zinc-400">{c.from}</span>
                        <span className="text-zinc-300 mx-1">→</span>
                        <span className="text-blue-600 dark:text-blue-400 font-semibold">{c.to}</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 pb-4 pt-2 shrink-0">
          <button onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Modal ─────────────────────────────────────────────────

function EditModal({
  target, patterns, availableStaff, logs, staffMember,
  originalPattern, consecutiveDays, isDuplicate,
  onClose, onChangePattern, onRemove, onAdd,
}: {
  target: EditTarget;
  patterns: Pattern[];
  availableStaff: MemberWithStatus[];
  logs: ChangeLog[];
  staffMember: Member | null;
  originalPattern: string | null;
  consecutiveDays: number;
  isDuplicate: boolean;
  onClose: () => void;
  onChangePattern: (p: string) => void;
  onRemove: () => void;
  onAdd: (staffId: string) => void;
}) {
  const dateLabel = fmtDate(target.date);
  const wasMoved =
    target.kind === "existing" &&
    originalPattern !== null &&
    originalPattern !== target.patternName;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm px-4 pt-4"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="mb-3">
          <p className="text-xs text-zinc-400 mb-0.5">{dateLabel}</p>
          {target.kind === "existing" && staffMember ? (
            <>
              <p className="text-base font-bold text-zinc-800 dark:text-zinc-100 leading-snug">{staffMember.name}</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{target.patternName}</p>
              {staffMember.section && (
                <span className="inline-block mt-0.5 text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                  {staffMember.section}
                </span>
              )}
            </>
          ) : (
            <p className="text-base font-bold text-zinc-800 dark:text-zinc-100">{target.patternName} に追加</p>
          )}
        </div>

        {/* エラー・警告バナー */}
        {isDuplicate && (
          <div className="mb-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
            <p className="text-xs font-bold text-red-600 dark:text-red-400">⚠ この日に重複配置があります</p>
          </div>
        )}
        {consecutiveDays >= 5 && (
          <div className="mb-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-300">⚠ {consecutiveDays}連勤になります</p>
          </div>
        )}

        {/* 移動前の配置 */}
        {wasMoved && (
          <div className="mb-3 px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-700">
            <p className="text-[10px] text-zinc-400 mb-0.5">移動前の配置</p>
            <p className="text-xs font-semibold">
              <span className="text-zinc-400">{originalPattern ?? "（なし）"}</span>
              <span className="text-zinc-300 dark:text-zinc-600 mx-1.5">→</span>
              <span className="text-blue-600 dark:text-blue-400">{target.patternName}</span>
            </p>
          </div>
        )}

        {target.kind === "existing" && (
          <>
            <p className="text-[11px] text-zinc-400 uppercase tracking-wide mb-1.5">パターンを変更</p>
            <div className="space-y-1 max-h-44 overflow-y-auto mb-3">
              {patterns
                .filter((p) => p.name !== target.patternName && (!staffMember || canAssign(staffMember, p)))
                .map((p) => (
                  <button key={p.name} onClick={() => onChangePattern(p.name)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                    <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{p.name}</span>
                    {p.start_time && p.end_time && (
                      <span className="text-xs text-zinc-400 tabular-nums ml-auto">
                        {p.start_time.slice(0, 5)}～{p.end_time.slice(0, 5)}
                      </span>
                    )}
                  </button>
                ))}
            </div>
            <button onClick={onRemove}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 mb-2 transition-colors">
              シフトから外す
            </button>

            {/* 変更履歴 */}
            {logs.length > 0 && (
              <div className="mt-1 mb-2">
                <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1">変更履歴</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {logs.map((l, i) => (
                    <div key={i} className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-start gap-1.5 px-2 py-1 bg-zinc-50 dark:bg-zinc-800/60 rounded-lg">
                      <span className="shrink-0 text-zinc-300">▸</span>
                      <span className="flex-1">
                        <span className="font-semibold text-zinc-600 dark:text-zinc-300">{l.changed_by_name}</span>
                        {" が "}
                        {l.action === "delete" ? "削除"
                          : l.action === "create" ? "追加"
                          : `${l.before_shift_name ?? "（なし）"} → ${l.after_shift_name ?? "（なし）"}`}
                        <span className="ml-1 text-zinc-400">{fmtAt(l.changed_at)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {target.kind === "empty" && (
          <>
            <p className="text-[11px] text-zinc-400 uppercase tracking-wide mb-1.5">スタッフを追加</p>
            {availableStaff.length === 0 ? (
              <p className="text-sm text-zinc-400 py-3 text-center">空きスタッフがいません</p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto mb-3">
                {availableStaff.map((m) => (
                  <button key={m.id} onClick={() => onAdd(m.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{m.name}</span>
                      {m.section && <span className="ml-1.5 text-[10px] text-zinc-400">{m.section}</span>}
                    </div>
                    {m.currentShift && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">
                        {m.currentShift}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <button onClick={onClose}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────

export default function ShiftEditGrid({
  projectId, targetMonth, allDates, shifts, activeMembers,
  shiftPatterns, slotRequirements, changeLogs,
  initialDraft, draftSavedBy, draftSavedAt,
  onSaved, onCancel,
}: Props) {
  // ── Draft 状態 ─────────────────────────────────────────────────
  const [drafts, setDrafts] = useState<Map<string, DraftCell>>(() => {
    if (!initialDraft || initialDraft.length === 0) return new Map();
    const m = new Map<string, DraftCell>();
    for (const e of initialDraft) {
      m.set(e.k, e.d ? null : { shiftName: e.n ?? null, shiftStart: e.s ?? null, shiftEnd: e.e ?? null });
    }
    return m;
  });
  const [hasDraftFromDB, setHasDraftFromDB] = useState(
    initialDraft !== null && initialDraft.length > 0
  );

  // 必要人数のローカル編集状態（日毎）
  const [localSlotReqs, setLocalSlotReqs] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const r of slotRequirements) m.set(`${r.pattern_name}__${r.shift_date}`, r.required_count);
    return m;
  });
  const [editingCountKey, setEditingCountKey] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColKey, setOverColKey] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isSavingDraft, startDraftTransition] = useTransition();
  // 保存系エラー（上部バナー）
  const [saveError, setSaveError] = useState<string | null>(null);
  // ドラッグ検証エラー（セル吹き出し）
  const [errorAnnotation, setErrorAnnotation] = useState<ErrorAnnotation | null>(null);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);

  // ── センサー ───────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  // ── Lookup maps ─────────────────────────────────────────────────
  const shiftsByKey = useMemo(() => {
    const m = new Map<string, Shift>();
    for (const s of shifts) m.set(`${s.staff_id}__${s.shift_date}`, s);
    return m;
  }, [shifts]);

  const memberById = useMemo(() => {
    const m = new Map<string, Member>();
    for (const mb of activeMembers) m.set(mb.id, mb);
    return m;
  }, [activeMembers]);

  const patternByName = useMemo(() => {
    const m = new Map<string, Pattern>();
    for (const p of shiftPatterns) m.set(p.name, p);
    return m;
  }, [shiftPatterns]);

  // 勤務パターン名セット（希望休・公休を区別するため）
  const patternNameSet = useMemo(
    () => new Set(shiftPatterns.map(p => p.name)),
    [shiftPatterns]
  );

  const slotReqMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of slotRequirements) m.set(`${r.pattern_name}__${r.shift_date}`, r.required_count);
    return m;
  }, [slotRequirements]);

  // 変更ログ: staffId__shiftDate → ChangeLog[]
  const changeLogMap = useMemo(() => {
    const m = new Map<string, ChangeLog[]>();
    for (const l of changeLogs) {
      const key = `${l.staff_id}__${l.shift_date}`;
      const arr = m.get(key) ?? [];
      arr.push(l);
      m.set(key, arr);
    }
    return m;
  }, [changeLogs]);

  function getRequired(patternName: string, date: string): number {
    const k = `${patternName}__${date}`;
    if (localSlotReqs.has(k)) return localSlotReqs.get(k)!;
    return patternByName.get(patternName)?.required_count ?? 0;
  }

  // ── Resolve cell ───────────────────────────────────────────────
  function resolveCell(staffId: string, date: string): DraftValue | null {
    const key = `${staffId}__${date}`;
    if (drafts.has(key)) return drafts.get(key) ?? null;
    const s = shiftsByKey.get(key);
    if (!s) return null;
    return { shiftName: s.shift_name, shiftStart: s.shift_start, shiftEnd: s.shift_end };
  }

  // ── resolvedGrid: patternName__date → staffId[] (上詰め) ──────
  const resolvedGrid = useMemo(() => {
    const grid = new Map<string, string[]>();
    for (const s of shifts) {
      if (!s.shift_name) continue;
      const k = `${s.shift_name}__${s.shift_date}`;
      const arr = grid.get(k) ?? [];
      arr.push(s.staff_id);
      grid.set(k, arr);
    }
    for (const [draftKey, draftVal] of drafts) {
      const [staffId, shiftDate] = draftKey.split("__");
      const orig = shiftsByKey.get(draftKey);
      if (orig?.shift_name) {
        const k = `${orig.shift_name}__${shiftDate}`;
        grid.set(k, (grid.get(k) ?? []).filter((id) => id !== staffId));
      }
      if (draftVal !== null && draftVal.shiftName) {
        const k = `${draftVal.shiftName}__${shiftDate}`;
        const arr = grid.get(k) ?? [];
        if (!arr.includes(staffId)) { arr.push(staffId); grid.set(k, arr); }
      }
    }
    return grid;
  }, [shifts, drafts, shiftsByKey]);

  // ── 各パターンの行数 ───────────────────────────────────────────
  const rowCountByPattern = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of shiftPatterns) {
      let maxOnDate = 0;
      for (const date of allDates) {
        const c = (resolvedGrid.get(`${p.name}__${date}`) ?? []).length;
        if (c > maxOnDate) maxOnDate = c;
      }
      m.set(p.name, Math.max(maxOnDate + 1, 2));
    }
    return m;
  }, [shiftPatterns, allDates, resolvedGrid]);

  // ── 重複検出: staffId__date → 配置パターン[] ─────────────────
  const duplicateStaffDates = useMemo(() => {
    const countMap = new Map<string, string[]>();
    for (const date of allDates) {
      for (const p of shiftPatterns) {
        const staffList = resolvedGrid.get(`${p.name}__${date}`) ?? [];
        for (const staffId of staffList) {
          const k = `${staffId}__${date}`;
          const arr = countMap.get(k) ?? [];
          arr.push(p.name);
          countMap.set(k, arr);
        }
      }
    }
    const dupSet = new Set<string>();
    for (const [k, patterns] of countMap) {
      if (patterns.length > 1) dupSet.add(k);
    }
    return { set: dupSet, map: countMap };
  }, [resolvedGrid, allDates, shiftPatterns]);

  // ── 人数不足リスト ─────────────────────────────────────────────
  const shortageList = useMemo(() => {
    const list: { patternName: string; date: string; assigned: number; required: number }[] = [];
    for (const p of shiftPatterns) {
      for (const date of allDates) {
        const assigned = (resolvedGrid.get(`${p.name}__${date}`) ?? []).length;
        const required = getRequired(p.name, date);
        if (required > 0 && assigned < required) {
          list.push({ patternName: p.name, date, assigned, required });
        }
      }
    }
    return list.sort((a, b) => a.date.localeCompare(b.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedGrid, allDates, shiftPatterns, slotReqMap, localSlotReqs]);

  // ── 変更一覧（サマリー用） ─────────────────────────────────────
  const draftChanges = useMemo(() => {
    const changes: { staffName: string; date: string; from: string | null; to: string | null }[] = [];
    for (const [key, draftVal] of drafts) {
      const [staffId, shiftDate] = key.split("__");
      const staffName = memberById.get(staffId)?.name ?? staffId;
      const fromPattern = shiftsByKey.get(key)?.shift_name ?? null;
      const toPattern = draftVal?.shiftName ?? null;
      changes.push({ staffName, date: shiftDate, from: fromPattern, to: toPattern });
    }
    return changes.sort((a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName));
  }, [drafts, memberById, shiftsByKey]);

  // ── 重複サマリー用リスト ───────────────────────────────────────
  const duplicateList = useMemo(() => {
    const list: { staffName: string; date: string; patterns: string[] }[] = [];
    for (const [key, patterns] of duplicateStaffDates.map) {
      if (patterns.length > 1) {
        const [staffId, date] = key.split("__");
        list.push({ staffName: memberById.get(staffId)?.name ?? staffId, date, patterns });
      }
    }
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [duplicateStaffDates, memberById]);

  // ── 必要人数変更フラグ ─────────────────────────────────────────
  const slotReqChanged = useMemo(() => {
    for (const [k, v] of localSlotReqs) {
      if (v !== (slotReqMap.get(k) ?? 0)) return true;
    }
    return false;
  }, [localSlotReqs, slotReqMap]);

  // ── 連続勤務日数計算 ───────────────────────────────────────────
  function isStaffWorkingOn(staffId: string, date: string): boolean {
    for (const p of shiftPatterns) {
      if ((resolvedGrid.get(`${p.name}__${date}`) ?? []).includes(staffId)) return true;
    }
    return false;
  }
  function getConsecutiveDays(staffId: string, date: string): number {
    const idx = allDates.indexOf(date);
    if (idx < 0) return 1;
    let before = 0, after = 0;
    for (let i = idx - 1; i >= 0; i--) {
      if (!isStaffWorkingOn(staffId, allDates[i])) break;
      before++;
    }
    for (let i = idx + 1; i < allDates.length; i++) {
      if (!isStaffWorkingOn(staffId, allDates[i])) break;
      after++;
    }
    return before + 1 + after;
  }

  // ── DnD ───────────────────────────────────────────────────────
  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    setErrorAnnotation(null);
  }
  function handleDragOver(event: DragOverEvent) {
    const d = event.over?.data.current as { type?: string; patternName?: string; date?: string } | undefined;
    setOverColKey(d?.type === "slot" && d.patternName && d.date ? `${d.patternName}__${d.date}` : null);
  }
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null); setOverColKey(null);
    const { active, over } = event;
    if (!over) return;
    const [staffId, sourceDate] = (active.id as string).split("__");
    const td = over.data.current as { type?: string; patternName?: string; date?: string } | undefined;
    if (td?.type !== "slot" || !td.patternName || !td.date) return;
    const targetPattern = td.patternName;
    const targetDate = td.date;
    const sourceVal = resolveCell(staffId, sourceDate);
    const sourcePattern = sourceVal?.shiftName ?? null;
    if (!sourcePattern) return;
    if (sourcePattern === targetPattern && sourceDate === targetDate) return;
    // セクション互換チェック
    const tPat = patternByName.get(targetPattern);
    const member = memberById.get(staffId);
    if (tPat && member && !canAssign(member, tPat)) return;
    // 別日ドロップ時：対象日に既に勤務シフトがある場合はエラー
    if (sourceDate !== targetDate) {
      const existingOnTarget = resolveCell(staffId, targetDate);
      if (existingOnTarget !== null && existingOnTarget.shiftName && patternNameSet.has(existingOnTarget.shiftName)) {
        const annotation: ErrorAnnotation = {
          staffId,
          date: sourceDate,
          message: `${member?.name ?? staffId} はすでに ${fmtDate(targetDate)} に「${existingOnTarget.shiftName}」が入っています`,
        };
        setErrorAnnotation(annotation);
        setTimeout(() => setErrorAnnotation(null), 4000);
        return;
      }
    }
    setDrafts((prev) => {
      const next = new Map(prev);
      const sourceKey = `${staffId}__${sourceDate}`;
      if (sourceDate === targetDate) {
        next.set(sourceKey, {
          shiftName: targetPattern,
          shiftStart: tPat?.start_time ?? shiftsByKey.get(sourceKey)?.shift_start ?? null,
          shiftEnd: tPat?.end_time ?? shiftsByKey.get(sourceKey)?.shift_end ?? null,
        });
      } else {
        if (shiftsByKey.has(sourceKey)) next.set(sourceKey, null);
        else next.delete(sourceKey);
        next.set(`${staffId}__${targetDate}`, {
          shiftName: targetPattern,
          shiftStart: tPat?.start_time ?? null,
          shiftEnd: tPat?.end_time ?? null,
        });
      }
      return next;
    });
  }
  function handleDragCancel() { setActiveId(null); setOverColKey(null); }

  // ── Modal ─────────────────────────────────────────────────────
  function openModal(patternName: string, date: string, staffId: string | null) {
    if (staffId) setEditTarget({ kind: "existing", staffId, patternName, date });
    else setEditTarget({ kind: "empty", patternName, date });
    setErrorAnnotation(null);
  }
  function closeModal() { setEditTarget(null); }

  function handleChangePattern(newPattern: string) {
    if (!editTarget || editTarget.kind !== "existing") return;
    const { staffId, date } = editTarget;
    const key = `${staffId}__${date}`;
    const np = patternByName.get(newPattern);
    const orig = shiftsByKey.get(key);
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(key, { shiftName: newPattern, shiftStart: np?.start_time ?? orig?.shift_start ?? null, shiftEnd: np?.end_time ?? orig?.shift_end ?? null });
      return next;
    });
    closeModal();
  }
  function handleRemove() {
    if (!editTarget || editTarget.kind !== "existing") return;
    const key = `${editTarget.staffId}__${editTarget.date}`;
    setDrafts((prev) => {
      const next = new Map(prev);
      if (shiftsByKey.has(key)) next.set(key, null); else next.delete(key);
      return next;
    });
    closeModal();
  }
  function handleAdd(staffId: string) {
    if (!editTarget || editTarget.kind !== "empty") return;
    const { patternName, date } = editTarget;
    const p = patternByName.get(patternName);
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(`${staffId}__${date}`, { shiftName: patternName, shiftStart: p?.start_time ?? null, shiftEnd: p?.end_time ?? null });
      return next;
    });
    closeModal();
  }

  // ── 仮保存 ────────────────────────────────────────────────────
  function serializeDrafts(): GridDraftEntry[] {
    const entries: GridDraftEntry[] = [];
    for (const [k, v] of drafts) {
      if (v === null) {
        entries.push({ k, n: null, s: null, e: null, d: true });
      } else {
        entries.push({ k, n: v.shiftName, s: v.shiftStart, e: v.shiftEnd, d: false });
      }
    }
    return entries;
  }

  function handleSaveDraft() {
    const entries = serializeDrafts();
    setSaveError(null);
    startDraftTransition(async () => {
      const r = await saveGridDraftAction(projectId, targetMonth, entries);
      if (r.ok) {
        setHasDraftFromDB(true);
        const now = new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
        setDraftMsg(`仮保存しました（${now}）`);
        setTimeout(() => setDraftMsg(null), 3000);
      } else {
        setSaveError(r.message ?? "仮保存に失敗しました");
      }
    });
  }

  // ── 確定保存 ─────────────────────────────────────────────────
  function resetDrafts() { setDrafts(new Map()); setSaveError(null); }

  function handleCommit() {
    const upserts: BulkUpsertItem[] = [];
    const dels: BulkDeleteItem[] = [];
    for (const [key, draft] of drafts) {
      const [staffId, shiftDate] = key.split("__");
      if (draft === null) { if (shiftsByKey.has(key)) dels.push({ staffId, shiftDate }); }
      else upserts.push({ staffId, shiftDate, shiftName: draft.shiftName, shiftStart: draft.shiftStart, shiftEnd: draft.shiftEnd });
    }

    const slotChanges: { patternName: string; date: string; section: string | null; requiredCount: number }[] = [];
    for (const [k, v] of localSlotReqs) {
      if (v !== (slotReqMap.get(k) ?? 0)) {
        const [patternName, date] = k.split("__");
        slotChanges.push({
          patternName,
          date,
          section: patternByName.get(patternName)?.section ?? null,
          requiredCount: v,
        });
      }
    }

    if (upserts.length === 0 && dels.length === 0 && slotChanges.length === 0) { onCancel(); return; }
    setSaveError(null);
    startTransition(async () => {
      if (slotChanges.length > 0) {
        const rc = await upsertSlotRequirementsAction(projectId, slotChanges);
        if (!rc.success) { setSaveError(rc.message ?? "必要人数の保存に失敗しました"); return; }
      }
      if (upserts.length > 0 || dels.length > 0) {
        const r = await bulkUpsertShiftsAction(projectId, upserts, dels);
        if (!r.success) { setSaveError(r.message ?? "保存に失敗しました"); return; }
      }
      await clearGridDraftAction(projectId, targetMonth);
      onSaved();
    });
  }

  // ── Available staff for "empty" modal ─────────────────────────
  // 希望休・公休スタッフも含む（勤務パターンへの配置済みのみ除外）
  const availableStaff = useMemo((): MemberWithStatus[] => {
    if (!editTarget || editTarget.kind !== "empty") return [];
    const { date, patternName } = editTarget;
    const pat = patternByName.get(patternName);
    return activeMembers
      .filter(m => {
        const cell = resolveCell(m.id, date);
        // 勤務パターンに配置済みなら除外
        if (cell !== null && cell.shiftName && patternNameSet.has(cell.shiftName)) return false;
        // セクション互換チェック
        if (pat && !canAssign(m, pat)) return false;
        return true;
      })
      .map(m => {
        const cell = resolveCell(m.id, date);
        return { ...m, currentShift: cell?.shiftName ?? null };
      })
      .sort((a, b) => {
        // シフトなしを先に
        if (a.currentShift === null && b.currentShift !== null) return -1;
        if (a.currentShift !== null && b.currentShift === null) return 1;
        return a.name.localeCompare(b.name);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTarget, drafts, activeMembers, shiftsByKey, patternByName, patternNameSet]);

  // 編集対象の変更ログ
  const modalLogs = useMemo(() => {
    if (!editTarget || editTarget.kind !== "existing") return [];
    return changeLogMap.get(`${editTarget.staffId}__${editTarget.date}`) ?? [];
  }, [editTarget, changeLogMap]);

  // モーダル用: 移動前のパターン・連続勤務・重複
  const modalOriginalPattern = useMemo(() => {
    if (!editTarget || editTarget.kind !== "existing") return null;
    const key = `${editTarget.staffId}__${editTarget.date}`;
    if (!drafts.has(key)) return null;
    return shiftsByKey.get(key)?.shift_name ?? null;
  }, [editTarget, drafts, shiftsByKey]);

  const modalConsecutiveDays = useMemo(() => {
    if (!editTarget || editTarget.kind !== "existing") return 1;
    return getConsecutiveDays(editTarget.staffId, editTarget.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTarget, resolvedGrid, allDates, shiftPatterns]);

  const modalIsDuplicate = useMemo(() => {
    if (!editTarget || editTarget.kind !== "existing") return false;
    return duplicateStaffDates.set.has(`${editTarget.staffId}__${editTarget.date}`);
  }, [editTarget, duplicateStaffDates]);

  // ── Render ────────────────────────────────────────────────────
  const draftCount = drafts.size;
  const hasChanges = draftCount > 0 || slotReqChanged;
  const activeName = activeId ? (memberById.get(activeId.split("__")[0])?.name ?? "") : null;
  const COL_W = 42;
  const NAME_W = 100;
  const totalW = NAME_W + COL_W * allDates.length;
  const alertCount = shortageList.length + duplicateList.length;

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-amber-800 dark:text-amber-300 leading-tight">
            {draftCount > 0 ? `${draftCount}件 変更中` : slotReqChanged ? "必要人数 変更中" : "グリッド編集"}
          </span>
          {hasDraftFromDB && draftCount === 0 && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">下書きなし</span>
          )}
          {draftMsg && (
            <span className="text-[10px] text-green-600 dark:text-green-400">{draftMsg}</span>
          )}
          {draftSavedBy && initialDraft && initialDraft.length > 0 && draftCount > 0 && !draftMsg && (
            <span className="text-[10px] text-amber-600 dark:text-amber-500 truncate">
              下書き: {draftSavedBy} {draftSavedAt ? fmtAt(draftSavedAt) : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowSummary(true)}
            disabled={isPending || isSavingDraft}
            className="relative px-2.5 py-1.5 text-xs font-semibold rounded-lg text-zinc-500 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition-colors"
          >
            サマリー
            {alertCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                {alertCount}
              </span>
            )}
          </button>
          {draftCount > 0 && (
            <button onClick={resetDrafts} disabled={isPending || isSavingDraft}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-zinc-500 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition-colors">
              リセット
            </button>
          )}
          <button onClick={onCancel} disabled={isPending || isSavingDraft}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-zinc-500 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition-colors">
            閉じる
          </button>
          {draftCount > 0 && (
            <button onClick={handleSaveDraft} disabled={isPending || isSavingDraft}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 hover:bg-amber-200 disabled:opacity-40 transition-colors">
              {isSavingDraft ? "保存中…" : "仮保存"}
            </button>
          )}
          <button onClick={handleCommit} disabled={isPending || isSavingDraft || !hasChanges}
            className="px-3 py-1.5 text-xs font-bold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {isPending ? "確定中…" : "確定"}
          </button>
        </div>
      </div>

      {/* 保存エラーバナー（保存失敗時のみ） */}
      {saveError && (
        <div className="px-4 py-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border-b border-red-200 shrink-0 flex items-center justify-between gap-2">
          <span>{saveError}</span>
          <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-600 shrink-0 text-xs">✕</button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="overflow-auto flex-1" style={{ WebkitOverflowScrolling: "touch" }}>
        <DndContext sensors={sensors}
          onDragStart={handleDragStart} onDragOver={handleDragOver}
          onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
          <table className="border-collapse"
            style={{ tableLayout: "fixed", width: `${totalW}px`, minWidth: `${totalW}px` }}>
            <colgroup>
              <col style={{ width: `${NAME_W}px` }} />
              {allDates.map((d) => <col key={d} style={{ width: `${COL_W}px` }} />)}
            </colgroup>

            {/* ── ヘッダー ── */}
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 h-11 bg-white dark:bg-zinc-950 border-b-2 border-r-2 border-zinc-200 dark:border-zinc-700" />
                {allDates.map((date) => {
                  const day = parseInt(date.slice(8));
                  const dw = dowLabel(date);
                  const dn = dowNum(date);
                  const isSun = dn === 0, isSat = dn === 6, isToday = date === todayJST;
                  const hasShortage = shortageList.some(s => s.date === date);
                  return (
                    <th key={date} className={[
                      "sticky top-0 z-20 h-11 border-b-2 border-r border-zinc-200 dark:border-zinc-700",
                      isToday ? "bg-blue-600" : "bg-white dark:bg-zinc-950",
                    ].join(" ")}>
                      <div className="flex flex-col items-center justify-center h-full gap-0.5 relative">
                        {hasShortage && !isToday && (
                          <span className="absolute top-1 right-1 w-1 h-1 rounded-full bg-amber-400" />
                        )}
                        <span className={`text-[11px] font-bold tabular-nums leading-none ${
                          isToday ? "text-white" : isSun ? "text-red-500" : isSat ? "text-blue-500" : "text-zinc-700 dark:text-zinc-300"
                        }`}>{day}</span>
                        <span className={`text-[9px] leading-none ${
                          isToday ? "text-blue-100" : isSun ? "text-red-400" : isSat ? "text-blue-400" : "text-zinc-400"
                        }`}>{dw}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            {/* ── Body ── */}
            <tbody>
              {shiftPatterns.map((pattern) => {
                const rowCount = rowCountByPattern.get(pattern.name) ?? 2;
                return (
                  <React.Fragment key={pattern.name}>
                    {Array.from({ length: rowCount }, (_, rowIdx) => (
                      <tr key={rowIdx}>
                        {rowIdx === 0 && (
                          <td rowSpan={rowCount}
                            className="sticky left-0 z-10 bg-white dark:bg-zinc-950 border-r-2 border-b border-zinc-200 dark:border-zinc-700 align-top p-0">
                            <div className="px-2 pt-1.5 pb-1">
                              <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-200 block leading-snug">{pattern.name}</span>
                              {pattern.start_time && pattern.end_time && (
                                <span className="text-[9px] text-zinc-400 tabular-nums block">
                                  {pattern.start_time.slice(0, 5)}～{pattern.end_time.slice(0, 5)}
                                </span>
                              )}
                              {pattern.required_count > 0 && (
                                <span className="text-[9px] text-zinc-400 block mt-0.5">
                                  標準 {pattern.required_count}人
                                </span>
                              )}
                            </div>
                          </td>
                        )}
                        {allDates.map((date) => {
                          const staffList = resolvedGrid.get(`${pattern.name}__${date}`) ?? [];
                          const staffId = staffList[rowIdx] ?? null;
                          const staffName = staffId ? (memberById.get(staffId)?.name ?? staffId) : null;
                          const draftKey = staffId ? `${staffId}__${date}` : null;
                          const isDraft = draftKey ? drafts.has(draftKey) : false;
                          const hasLog = draftKey ? (changeLogMap.get(draftKey)?.length ?? 0) > 0 : false;
                          const isDuplicate = draftKey ? duplicateStaffDates.set.has(draftKey) : false;

                          // 吹き出しメッセージの決定
                          const isErrorCell = !!staffId && errorAnnotation?.staffId === staffId && errorAnnotation?.date === date;
                          const dupPatterns = isDuplicate && draftKey
                            ? (duplicateStaffDates.map.get(draftKey) ?? []).filter(p => p !== pattern.name)
                            : [];
                          const bubbleMessage: string | undefined = isErrorCell
                            ? errorAnnotation!.message
                            : isDuplicate && dupPatterns.length > 0
                            ? `重複: ${dupPatterns.join("・")}`
                            : undefined;

                          return (
                            <SlotCellFull
                              key={date}
                              patternName={pattern.name} date={date} rowIdx={rowIdx}
                              staffId={staffId} staffName={staffName}
                              isDraft={isDraft} isToday={date === todayJST}
                              isOverCol={overColKey === `${pattern.name}__${date}`}
                              hasLog={hasLog} isDuplicate={isDuplicate}
                              bubbleMessage={bubbleMessage}
                              onClick={() => openModal(pattern.name, date, staffId)}
                            />
                          );
                        })}
                      </tr>
                    ))}
                    {/* 充足状況行（クリックで必要人数を編集） */}
                    <tr>
                      <td className="sticky left-0 z-10 bg-zinc-50 dark:bg-zinc-900/60 border-b-2 border-r-2 border-zinc-200 dark:border-zinc-700 h-5" />
                      {allDates.map((date) => {
                        const countKey = `${pattern.name}__${date}`;
                        return (
                          <CountCell key={date}
                            assigned={(resolvedGrid.get(`${pattern.name}__${date}`) ?? []).length}
                            required={getRequired(pattern.name, date)}
                            isToday={date === todayJST}
                            isEditing={editingCountKey === countKey}
                            onStartEdit={() => { setEditingCountKey(countKey); setSaveError(null); }}
                            onChange={v => setLocalSlotReqs(prev => { const n = new Map(prev); n.set(countKey, v); return n; })}
                            onEndEdit={() => setEditingCountKey(null)}
                          />
                        );
                      })}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          <DragOverlay dropAnimation={null}>
            {activeName ? (
              <div className="rounded-md shadow-lg bg-white dark:bg-zinc-800 px-2 py-1 text-xs font-semibold text-zinc-700 dark:text-zinc-200 opacity-95 pointer-events-none whitespace-nowrap ring-1 ring-zinc-200 dark:ring-zinc-700">
                {activeName}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* 凡例 */}
      <div className="shrink-0 px-4 py-1.5 border-t border-zinc-100 dark:border-zinc-800 flex items-center text-[10px] text-zinc-400 gap-3">
        <span><span className="text-blue-700 dark:text-blue-400 font-bold">名前</span>＝変更中</span>
        <span className="flex items-center gap-0.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />＝変更履歴あり
        </span>
        <span className="flex items-center gap-0.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />＝重複
        </span>
        <span className="ml-auto text-[9px]">タップ：編集　人数行タップ：必要人数を編集　ドラッグ：移動</span>
      </div>

      {/* Summary Modal */}
      {showSummary && (
        <SummaryModal
          draftChanges={draftChanges}
          onClose={() => setShowSummary(false)}
        />
      )}

      {/* Edit Modal */}
      {editTarget && (
        <EditModal
          target={editTarget} patterns={shiftPatterns}
          availableStaff={availableStaff} logs={modalLogs}
          staffMember={editTarget.kind === "existing" ? (memberById.get(editTarget.staffId) ?? null) : null}
          originalPattern={modalOriginalPattern}
          consecutiveDays={modalConsecutiveDays}
          isDuplicate={modalIsDuplicate}
          onClose={closeModal} onChangePattern={handleChangePattern}
          onRemove={handleRemove} onAdd={handleAdd}
        />
      )}
    </div>
  );
}
