"use client";

/**
 * ShiftEditGrid — パターン軸グリッド編集モード
 *
 * レイアウト: 行 = シフトパターン、列 = 日付
 * 各セルにそのパターンで働くスタッフ名を上詰め表示
 * ドラッグ: スタッフ名チップを別セルにドロップ → パターン/日付を変更
 * タップ:  スタッフチップ → パターン変更/削除
 *          空セル        → スタッフを追加
 * 行詰め: resolvedGrid は常にスタッフを上詰め
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
  type BulkUpsertItem,
  type BulkDeleteItem,
} from "../actions";

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
type Pattern = {
  name: string;
  required_count: number;
  start_time: string | null;
  end_time: string | null;
};
type SlotReq = { section: string; pattern_name: string; shift_date: string; required_count: number };
type DraftValue = { shiftName: string | null; shiftStart: string | null; shiftEnd: string | null };
type DraftCell = DraftValue | null;

type EditTarget =
  | { kind: "existing"; staffId: string; patternName: string; date: string }
  | { kind: "empty";    patternName: string; date: string };

interface Props {
  projectId: string;
  allDates: string[];
  shifts: Shift[];
  activeMembers: Member[];
  shiftPatterns: Pattern[];
  slotRequirements: SlotReq[];
  onSaved: () => void;
  onCancel: () => void;
}

// ── Date helpers ───────────────────────────────────────────────

const todayJST = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

function dowLabel(d: string) {
  return ["日", "月", "火", "水", "木", "金", "土"][new Date(d + "T00:00:00+09:00").getDay()];
}
function dowNum(d: string) {
  return new Date(d + "T00:00:00+09:00").getDay();
}

// ── DraggableChip ──────────────────────────────────────────────

function DraggableChip({
  staffId,
  shiftDate,
  name,
  isDraft,
}: {
  staffId: string;
  shiftDate: string;
  name: string;
  isDraft: boolean;
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
        "cursor-grab active:cursor-grabbing select-none touch-none",
        "truncate w-full",
        isDragging ? "opacity-20" : "",
        isDraft
          ? "text-blue-700 dark:text-blue-400 font-bold"
          : "text-zinc-800 dark:text-zinc-200",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {name}
    </span>
  );
}

// ── SlotCell ────────────────────────────────────────────────────

function SlotCell({
  patternName,
  date,
  rowIdx,
  staffId,
  staffName,
  isDraft,
  isToday,
  isOverCol,
  onClick,
}: {
  patternName: string;
  date: string;
  rowIdx: number;
  staffId: string | null;
  staffName: string | null;
  isDraft: boolean;
  isToday: boolean;
  isOverCol: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot__${rowIdx}__${patternName}__${date}`,
    data: { type: "slot", patternName, date, rowIdx },
  });

  return (
    <td
      ref={setNodeRef}
      onClick={onClick}
      className={[
        "border-b border-r border-zinc-100 dark:border-zinc-800",
        "h-8 align-middle p-0 cursor-pointer overflow-hidden",
        isToday && !isOver && !isOverCol
          ? "bg-blue-50/40 dark:bg-blue-950/10"
          : "",
        isOver
          ? "bg-blue-100 dark:bg-blue-900/50 ring-inset ring-2 ring-blue-400"
          : isOverCol
            ? "bg-blue-50/60 dark:bg-blue-950/20"
            : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="px-0.5 h-full flex items-center overflow-hidden">
        {staffId && staffName && (
          <DraggableChip
            staffId={staffId}
            shiftDate={date}
            name={staffName}
            isDraft={isDraft}
          />
        )}
      </div>
    </td>
  );
}

// ── CountCell ──────────────────────────────────────────────────

function CountCell({
  assigned,
  required,
  isToday,
}: {
  assigned: number;
  required: number;
  isToday: boolean;
}) {
  const short = required === 0;
  const ok = assigned >= required;
  return (
    <td
      className={[
        "text-center text-[10px] tabular-nums font-medium",
        "h-5 border-b-2 border-r border-zinc-200 dark:border-zinc-700",
        isToday ? "bg-blue-50/50 dark:bg-blue-950/20" : "bg-zinc-50 dark:bg-zinc-900/60",
        short
          ? "text-zinc-300 dark:text-zinc-600"
          : ok
            ? "text-zinc-400 dark:text-zinc-500"
            : "text-red-500 dark:text-red-400 font-bold",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {short ? "" : `${assigned}/${required}`}
    </td>
  );
}

// ── Edit Modal ─────────────────────────────────────────────────

function EditModal({
  target,
  patterns,
  availableStaff,
  onClose,
  onChangePattern,
  onRemove,
  onAdd,
}: {
  target: EditTarget;
  patterns: Pattern[];
  availableStaff: Member[];
  onClose: () => void;
  onChangePattern: (p: string) => void;
  onRemove: () => void;
  onAdd: (staffId: string) => void;
}) {
  const dow = dowLabel(target.date);
  const dateLabel = `${target.date.slice(5).replace("-", "/")}（${dow}）`;

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
        <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{target.patternName}</p>
        <p className="text-xs text-zinc-400 mb-3">{dateLabel}</p>

        {target.kind === "existing" && (
          <>
            <p className="text-[11px] text-zinc-400 uppercase tracking-wide mb-1.5">パターンを変更</p>
            <div className="space-y-1 max-h-52 overflow-y-auto mb-3">
              {patterns
                .filter((p) => p.name !== target.patternName)
                .map((p) => (
                  <button
                    key={p.name}
                    onClick={() => onChangePattern(p.name)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                      {p.name}
                    </span>
                    {p.start_time && p.end_time && (
                      <span className="text-xs text-zinc-400 tabular-nums ml-auto">
                        {p.start_time.slice(0, 5)}～{p.end_time.slice(0, 5)}
                      </span>
                    )}
                  </button>
                ))}
            </div>
            <button
              onClick={onRemove}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 mb-2 transition-colors"
            >
              シフトから外す
            </button>
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
                  <button
                    key={m.id}
                    onClick={() => onAdd(m.id)}
                    className="w-full px-3 py-2 rounded-xl text-left text-sm text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────

export default function ShiftEditGrid({
  projectId,
  allDates,
  shifts,
  activeMembers,
  shiftPatterns,
  slotRequirements,
  onSaved,
  onCancel,
}: Props) {
  const [drafts, setDrafts] = useState<Map<string, DraftCell>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColKey, setOverColKey] = useState<string | null>(null); // "patternName__date"
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // ── Sensors ────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  // ── Lookup maps ────────────────────────────────────────────────

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

  const slotReqMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of slotRequirements) m.set(`${r.pattern_name}__${r.shift_date}`, r.required_count);
    return m;
  }, [slotRequirements]);

  function getRequired(patternName: string, date: string): number {
    return slotReqMap.get(`${patternName}__${date}`) ?? (patternByName.get(patternName)?.required_count ?? 0);
  }

  // ── Resolve cell (draft-aware) ─────────────────────────────────

  function resolveCell(staffId: string, date: string): DraftValue | null {
    const key = `${staffId}__${date}`;
    if (drafts.has(key)) return drafts.get(key) ?? null;
    const s = shiftsByKey.get(key);
    if (!s) return null;
    return { shiftName: s.shift_name, shiftStart: s.shift_start, shiftEnd: s.shift_end };
  }

  // ── resolvedGrid: patternName__date → staffId[] (上詰め済み) ──

  const resolvedGrid = useMemo(() => {
    const grid = new Map<string, string[]>();

    // 元データから構築
    for (const s of shifts) {
      if (!s.shift_name) continue;
      const k = `${s.shift_name}__${s.shift_date}`;
      const arr = grid.get(k) ?? [];
      arr.push(s.staff_id);
      grid.set(k, arr);
    }

    // ドラフト適用
    for (const [draftKey, draftVal] of drafts) {
      const [staffId, shiftDate] = draftKey.split("__");
      const orig = shiftsByKey.get(draftKey);

      // 元パターンから除去
      if (orig?.shift_name) {
        const k = `${orig.shift_name}__${shiftDate}`;
        const arr = grid.get(k) ?? [];
        grid.set(k, arr.filter((id) => id !== staffId));
      }

      // 新パターンへ追加
      if (draftVal !== null && draftVal.shiftName) {
        const k = `${draftVal.shiftName}__${shiftDate}`;
        const arr = grid.get(k) ?? [];
        if (!arr.includes(staffId)) {
          arr.push(staffId);
          grid.set(k, arr);
        }
      }
    }

    return grid;
  }, [shifts, drafts, shiftsByKey]);

  // ── 各パターンの行数（上詰めバッファ付き） ────────────────────

  const rowCountByPattern = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of shiftPatterns) {
      let maxOnDate = 0;
      for (const date of allDates) {
        const c = (resolvedGrid.get(`${p.name}__${date}`) ?? []).length;
        if (c > maxOnDate) maxOnDate = c;
      }
      // required_count と max実績 の大きい方 + 1バッファ（最低2）
      m.set(p.name, Math.max(maxOnDate + 1, p.required_count, 2));
    }
    return m;
  }, [shiftPatterns, allDates, resolvedGrid]);

  // ── DnD handlers ──────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    setError(null);
  }

  function handleDragOver(event: DragOverEvent) {
    const d = event.over?.data.current as { type?: string; patternName?: string; date?: string } | undefined;
    if (d?.type === "slot" && d.patternName && d.date) {
      setOverColKey(`${d.patternName}__${d.date}`);
    } else {
      setOverColKey(null);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    setOverColKey(null);
    const { active, over } = event;
    if (!over) return;

    const [staffId, sourceDate] = (active.id as string).split("__");
    const td = over.data.current as { type?: string; patternName?: string; date?: string } | undefined;
    if (td?.type !== "slot" || !td.patternName || !td.date) return;

    const targetPattern = td.patternName;
    const targetDate = td.date;

    // ドラッグ元の現在パターンを解決
    const sourceVal = resolveCell(staffId, sourceDate);
    const sourcePattern = sourceVal?.shiftName ?? null;
    if (!sourcePattern) return;
    if (sourcePattern === targetPattern && sourceDate === targetDate) return;

    const tPat = patternByName.get(targetPattern);

    setDrafts((prev) => {
      const next = new Map(prev);
      const sourceKey = `${staffId}__${sourceDate}`;
      const targetKey = `${staffId}__${targetDate}`;

      if (sourceDate === targetDate) {
        // 同日 → パターン変更のみ
        next.set(sourceKey, {
          shiftName: targetPattern,
          shiftStart: tPat?.start_time ?? shiftsByKey.get(sourceKey)?.shift_start ?? null,
          shiftEnd: tPat?.end_time ?? shiftsByKey.get(sourceKey)?.shift_end ?? null,
        });
      } else {
        // 別日 → 元日から削除 + 新日に追加
        if (shiftsByKey.has(sourceKey)) next.set(sourceKey, null);
        else next.delete(sourceKey);

        next.set(targetKey, {
          shiftName: targetPattern,
          shiftStart: tPat?.start_time ?? null,
          shiftEnd: tPat?.end_time ?? null,
        });
      }
      return next;
    });
  }

  function handleDragCancel() {
    setActiveId(null);
    setOverColKey(null);
  }

  // ── Modal handlers ─────────────────────────────────────────────

  function openModal(patternName: string, date: string, staffId: string | null) {
    if (staffId) setEditTarget({ kind: "existing", staffId, patternName, date });
    else setEditTarget({ kind: "empty", patternName, date });
    setError(null);
  }

  function closeModal() {
    setEditTarget(null);
  }

  function handleChangePattern(newPattern: string) {
    if (!editTarget || editTarget.kind !== "existing") return;
    const { staffId, date } = editTarget;
    const key = `${staffId}__${date}`;
    const np = patternByName.get(newPattern);
    const orig = shiftsByKey.get(key);
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(key, {
        shiftName: newPattern,
        shiftStart: np?.start_time ?? orig?.shift_start ?? null,
        shiftEnd: np?.end_time ?? orig?.shift_end ?? null,
      });
      return next;
    });
    closeModal();
  }

  function handleRemove() {
    if (!editTarget || editTarget.kind !== "existing") return;
    const { staffId, date } = editTarget;
    const key = `${staffId}__${date}`;
    setDrafts((prev) => {
      const next = new Map(prev);
      if (shiftsByKey.has(key)) next.set(key, null);
      else next.delete(key);
      return next;
    });
    closeModal();
  }

  function handleAdd(staffId: string) {
    if (!editTarget || editTarget.kind !== "empty") return;
    const { patternName, date } = editTarget;
    const key = `${staffId}__${date}`;
    const p = patternByName.get(patternName);
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(key, {
        shiftName: patternName,
        shiftStart: p?.start_time ?? null,
        shiftEnd: p?.end_time ?? null,
      });
      return next;
    });
    closeModal();
  }

  // ── Save ──────────────────────────────────────────────────────

  function resetDrafts() {
    setDrafts(new Map());
    setError(null);
  }

  function handleSave() {
    const upserts: BulkUpsertItem[] = [];
    const dels: BulkDeleteItem[] = [];
    for (const [key, draft] of drafts) {
      const [staffId, shiftDate] = key.split("__");
      if (draft === null) {
        if (shiftsByKey.has(key)) dels.push({ staffId, shiftDate });
      } else {
        upserts.push({
          staffId, shiftDate,
          shiftName: draft.shiftName,
          shiftStart: draft.shiftStart,
          shiftEnd: draft.shiftEnd,
        });
      }
    }
    if (upserts.length === 0 && dels.length === 0) { onCancel(); return; }
    setError(null);
    startTransition(async () => {
      const r = await bulkUpsertShiftsAction(projectId, upserts, dels);
      if (r.success) onSaved();
      else setError(r.message ?? "保存に失敗しました");
    });
  }

  // ── Available staff for "empty" modal ─────────────────────────

  const availableStaff = useMemo(() => {
    if (!editTarget || editTarget.kind !== "empty") return [];
    const { date } = editTarget;
    return activeMembers.filter((m) => resolveCell(m.id, date) === null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTarget, drafts, activeMembers, shiftsByKey]);

  // ── Render ────────────────────────────────────────────────────

  const draftCount = drafts.size;
  const activeName = activeId
    ? (memberById.get(activeId.split("__")[0])?.name ?? activeId.split("__")[0])
    : null;

  const COL_W = 42; // px per date column
  const NAME_W = 100; // px for pattern name column
  const totalW = NAME_W + COL_W * allDates.length;

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 shrink-0">
        <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          {draftCount > 0 ? `${draftCount}件 変更中` : "グリッド編集"}
        </span>
        <div className="flex items-center gap-2">
          {draftCount > 0 && (
            <button onClick={resetDrafts} disabled={isPending}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-zinc-600 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition-colors">
              リセット
            </button>
          )}
          <button onClick={onCancel} disabled={isPending}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg text-zinc-600 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition-colors">
            キャンセル
          </button>
          <button onClick={handleSave} disabled={isPending || draftCount === 0}
            className="px-4 py-1.5 text-xs font-bold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {isPending ? "保存中…" : "保存"}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="overflow-auto flex-1" style={{ WebkitOverflowScrolling: "touch" }}>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <table
            className="border-collapse"
            style={{ tableLayout: "fixed", width: `${totalW}px`, minWidth: `${totalW}px` }}
          >
            <colgroup>
              <col style={{ width: `${NAME_W}px` }} />
              {allDates.map((d) => (
                <col key={d} style={{ width: `${COL_W}px` }} />
              ))}
            </colgroup>

            {/* ── 日付ヘッダー ── */}
            <thead>
              <tr>
                {/* 角セル */}
                <th className="sticky top-0 left-0 z-30 h-11 bg-white dark:bg-zinc-950 border-b-2 border-r-2 border-zinc-200 dark:border-zinc-700" />
                {allDates.map((date) => {
                  const day = parseInt(date.slice(8));
                  const dw = dowLabel(date);
                  const dn = dowNum(date);
                  const isSun = dn === 0;
                  const isSat = dn === 6;
                  const isToday = date === todayJST;
                  return (
                    <th
                      key={date}
                      className={[
                        "sticky top-0 z-20 h-11 border-b-2 border-r border-zinc-200 dark:border-zinc-700",
                        isToday ? "bg-blue-600" : "bg-white dark:bg-zinc-950",
                      ].join(" ")}
                    >
                      <div className="flex flex-col items-center justify-center h-full gap-0.5">
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

            {/* ── Body: パターンごとのセクション ── */}
            <tbody>
              {shiftPatterns.map((pattern) => {
                const rowCount = rowCountByPattern.get(pattern.name) ?? 2;
                return (
                  <React.Fragment key={pattern.name}>
                    {/* スタッフ行 */}
                    {Array.from({ length: rowCount }, (_, rowIdx) => (
                      <tr key={rowIdx}>
                        {/* パターン名セル（row 0 のみ・rowSpan） */}
                        {rowIdx === 0 && (
                          <td
                            rowSpan={rowCount}
                            className="sticky left-0 z-10 bg-white dark:bg-zinc-950 border-r-2 border-b border-zinc-200 dark:border-zinc-700 align-top p-0"
                          >
                            <div className="px-2 pt-2">
                              <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-200 block leading-snug">
                                {pattern.name}
                              </span>
                              {pattern.start_time && pattern.end_time && (
                                <span className="text-[9px] text-zinc-400 dark:text-zinc-500 tabular-nums block">
                                  {pattern.start_time.slice(0, 5)}～{pattern.end_time.slice(0, 5)}
                                </span>
                              )}
                            </div>
                          </td>
                        )}

                        {/* 各日付のスロット */}
                        {allDates.map((date) => {
                          const staffList = resolvedGrid.get(`${pattern.name}__${date}`) ?? [];
                          const staffId = staffList[rowIdx] ?? null;
                          const staffName = staffId ? (memberById.get(staffId)?.name ?? staffId) : null;
                          const key = staffId ? `${staffId}__${date}` : null;
                          const isDraft = key ? drafts.has(key) : false;
                          const isOverThisCol = overColKey === `${pattern.name}__${date}`;
                          return (
                            <SlotCell
                              key={date}
                              patternName={pattern.name}
                              date={date}
                              rowIdx={rowIdx}
                              staffId={staffId}
                              staffName={staffName}
                              isDraft={isDraft}
                              isToday={date === todayJST}
                              isOverCol={isOverThisCol}
                              onClick={() => openModal(pattern.name, date, staffId)}
                            />
                          );
                        })}
                      </tr>
                    ))}

                    {/* 充足状況行 */}
                    <tr>
                      <td className="sticky left-0 z-10 bg-zinc-50 dark:bg-zinc-900/60 border-b-2 border-r-2 border-zinc-200 dark:border-zinc-700 h-5" />
                      {allDates.map((date) => {
                        const assigned = (resolvedGrid.get(`${pattern.name}__${date}`) ?? []).length;
                        const required = getRequired(pattern.name, date);
                        return (
                          <CountCell
                            key={date}
                            assigned={assigned}
                            required={required}
                            isToday={date === todayJST}
                          />
                        );
                      })}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Drag overlay */}
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
      <div className="shrink-0 px-4 py-1.5 border-t border-zinc-100 dark:border-zinc-800 flex items-center text-[10px] text-zinc-400 dark:text-zinc-500">
        <span className="text-blue-700 dark:text-blue-400 font-bold mr-1">スタッフ名</span>=変更中
        <span className="ml-auto">タップ：追加/変更/削除　ドラッグ：移動</span>
      </div>

      {/* Edit Modal */}
      {editTarget && (
        <EditModal
          target={editTarget}
          patterns={shiftPatterns}
          availableStaff={availableStaff}
          onClose={closeModal}
          onChangePattern={handleChangePattern}
          onRemove={handleRemove}
          onAdd={handleAdd}
        />
      )}
    </div>
  );
}
