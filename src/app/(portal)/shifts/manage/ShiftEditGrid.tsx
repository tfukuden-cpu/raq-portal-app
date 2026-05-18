"use client";

/**
 * ShiftEditGrid
 * グリッド編集モード — 月次シフト表を横スクロール可能なグリッドで表示し、
 * ドラッグ＆ドロップとタップで編集できる。
 *
 * ドラッグ: セルを掴んで別セルに落とす → 内容をスワップ
 * タップ  : セルをタップ → パターン選択モーダルを開く
 */

import {
  useState,
  useCallback,
  useMemo,
  useTransition,
  useRef,
} from "react";
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
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  bulkUpsertShiftsAction,
  type BulkUpsertItem,
  type BulkDeleteItem,
} from "../actions";

// ── Types ─────────────────────────────────────────────────────

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
  start_time: string | null;
  end_time: string | null;
};

/** null = このセルを削除する */
type DraftValue = {
  shiftName: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
};
type DraftCell = DraftValue | null;

type EditTarget = {
  staffId: string;
  staffName: string;
  date: string;
};

interface Props {
  projectId: string;
  allDates: string[];
  shifts: Shift[];
  activeMembers: Member[];
  shiftPatterns: Pattern[];
  onSaved: () => void;
  onCancel: () => void;
}

// ── Color helpers ──────────────────────────────────────────────

const CHIP_COLORS: [string, string][] = [
  ["bg-sky-100 dark:bg-sky-900",      "text-sky-800 dark:text-sky-200"],
  ["bg-emerald-100 dark:bg-emerald-900", "text-emerald-800 dark:text-emerald-200"],
  ["bg-violet-100 dark:bg-violet-900",  "text-violet-800 dark:text-violet-200"],
  ["bg-amber-100 dark:bg-amber-900",    "text-amber-800 dark:text-amber-200"],
  ["bg-rose-100 dark:bg-rose-900",      "text-rose-800 dark:text-rose-200"],
  ["bg-teal-100 dark:bg-teal-900",      "text-teal-800 dark:text-teal-200"],
  ["bg-pink-100 dark:bg-pink-900",      "text-pink-800 dark:text-pink-200"],
  ["bg-indigo-100 dark:bg-indigo-900",  "text-indigo-800 dark:text-indigo-200"],
];

function chipColor(name: string): { bg: string; text: string } {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  const [bg, text] = CHIP_COLORS[h % CHIP_COLORS.length];
  return { bg, text };
}

// ── Date helpers ───────────────────────────────────────────────

function dayOfWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00+09:00");
  return ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
}

function dayOfWeekNum(dateStr: string): number {
  return new Date(dateStr + "T00:00:00+09:00").getDay();
}

const todayJST = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

// ── Sub-components ─────────────────────────────────────────────

function ShiftChip({ name, small = false }: { name: string; small?: boolean }) {
  const { bg, text } = chipColor(name);
  return (
    <span
      className={`${bg} ${text} font-bold rounded block truncate text-center leading-tight ${
        small ? "text-[9px] px-1 py-0.5 max-w-[38px]" : "text-[11px] px-1.5 py-0.5 max-w-[52px]"
      }`}
    >
      {name}
    </span>
  );
}

/** 各セル: useDraggable + useDroppable を両方適用 */
function GridCell({
  cellKey,
  shiftName,
  isDraft,
  isDeleted,
  isToday,
  onClick,
}: {
  cellKey: string;
  shiftName: string | null;
  isDraft: boolean;
  isDeleted: boolean;
  isToday: boolean;
  onClick: () => void;
}) {
  const canDrag = !!shiftName;

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: cellKey, disabled: !canDrag });

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: cellKey });

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  return (
    <div
      ref={setRef}
      {...(canDrag ? listeners : undefined)}
      {...(canDrag ? attributes : undefined)}
      onClick={onClick}
      className={[
        "h-11 flex items-center justify-center",
        "border-b border-r border-zinc-100 dark:border-zinc-800",
        "cursor-pointer select-none",
        isToday && !isDraft && !isDeleted
          ? "bg-blue-50/60 dark:bg-blue-950/20"
          : "",
        isOver && !isDragging
          ? "bg-blue-100 dark:bg-blue-900/40 ring-inset ring-2 ring-blue-400"
          : "",
        isDraft && !isDeleted
          ? "ring-inset ring-1 ring-amber-400 bg-amber-50/40 dark:bg-amber-950/20"
          : "",
        isDeleted
          ? "ring-inset ring-1 ring-red-300 bg-red-50/30 dark:bg-red-950/20"
          : "",
        isDragging ? "opacity-20" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {shiftName && !isDragging && <ShiftChip name={shiftName} small />}
    </div>
  );
}

/** パターン選択モーダル */
function EditModal({
  target,
  currentValue,
  patterns,
  hasOriginal,
  onClose,
  onSelect,
  onDelete,
}: {
  target: EditTarget;
  currentValue: DraftValue | null;
  patterns: Pattern[];
  hasOriginal: boolean;
  onClose: () => void;
  onSelect: (p: Pattern) => void;
  onDelete: () => void;
}) {
  const dow = dayOfWeekLabel(target.date);
  const dateLabel = `${target.date.slice(5).replace("-", "/")}（${dow}）`;
  const canDelete = currentValue !== null || hasOriginal;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm px-4 pt-4 pb-safe-8"
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-zinc-400 dark:text-zinc-500 mb-0.5">
          {target.staffName}
        </p>
        <p className="text-base font-bold text-zinc-900 dark:text-zinc-50 mb-3">
          {dateLabel}
        </p>

        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {patterns.map((p) => {
            const isCurrent = currentValue?.shiftName === p.name;
            const { bg, text } = chipColor(p.name);
            return (
              <button
                key={p.name}
                onClick={() => onSelect(p)}
                className={[
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors",
                  isCurrent
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                ].join(" ")}
              >
                <span
                  className={`${bg} ${text} text-[10px] font-bold rounded px-1.5 py-0.5 shrink-0`}
                >
                  {p.name}
                </span>
                <span
                  className={`text-sm tabular-nums ${
                    isCurrent
                      ? "text-white"
                      : "text-zinc-600 dark:text-zinc-300"
                  }`}
                >
                  {p.start_time && p.end_time
                    ? `${p.start_time.slice(0, 5)} ～ ${p.end_time.slice(0, 5)}`
                    : "時刻未設定"}
                </span>
              </button>
            );
          })}
        </div>

        {canDelete && (
          <button
            onClick={onDelete}
            className="mt-3 w-full py-2.5 rounded-xl text-sm font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 transition-colors"
          >
            シフトを削除
          </button>
        )}

        <button
          onClick={onClose}
          className="mt-2 w-full py-2.5 rounded-xl text-sm font-semibold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────

export default function ShiftEditGrid({
  projectId,
  allDates,
  shifts,
  activeMembers,
  shiftPatterns,
  onSaved,
  onCancel,
}: Props) {
  // 変更差分 Map: key = "staffId__date"
  const [drafts, setDrafts] = useState<Map<string, DraftCell>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // DnD センサー
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
  );

  // 元データ Map
  const shiftsByKey = useMemo(() => {
    const m = new Map<string, Shift>();
    for (const s of shifts) m.set(`${s.staff_id}__${s.shift_date}`, s);
    return m;
  }, [shifts]);

  // パターン Map (name → Pattern)
  const patternByName = useMemo(() => {
    const m = new Map<string, Pattern>();
    for (const p of shiftPatterns) m.set(p.name, p);
    return m;
  }, [shiftPatterns]);

  // セルの解決値（ドラフト優先）
  const resolveCell = useCallback(
    (key: string): DraftValue | null => {
      if (drafts.has(key)) return drafts.get(key) ?? null;
      const s = shiftsByKey.get(key);
      if (!s) return null;
      return { shiftName: s.shift_name, shiftStart: s.shift_start, shiftEnd: s.shift_end };
    },
    [drafts, shiftsByKey],
  );

  // ── DnD handlers ────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    setError(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromKey = active.id as string;
    const toKey = over.id as string;
    const fromVal = resolveCell(fromKey);
    const toVal = resolveCell(toKey);

    setDrafts((prev) => {
      const next = new Map(prev);

      // toKey に fromVal を置く
      const fromOrig = shiftsByKey.has(fromKey);
      const toOrig = shiftsByKey.has(toKey);

      // toKey の新しい値
      if (fromVal) {
        next.set(toKey, fromVal);
      } else {
        // ドラッグ元が空だった（通常ここには来ない）
        if (toOrig) next.set(toKey, null);
        else next.delete(toKey);
      }

      // fromKey の新しい値（toVal で置換 or 削除）
      if (toVal) {
        next.set(fromKey, toVal);
      } else {
        // to が空 → from を空にする
        if (fromOrig) next.set(fromKey, null);
        else next.delete(fromKey);
      }

      return next;
    });
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  // ── Modal handlers ───────────────────────────────────────────

  function openModal(staffId: string, staffName: string, date: string) {
    setEditTarget({ staffId, staffName, date });
    setError(null);
  }

  function closeModal() {
    setEditTarget(null);
  }

  function selectPattern(pattern: Pattern) {
    if (!editTarget) return;
    const key = `${editTarget.staffId}__${editTarget.date}`;
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(key, {
        shiftName: pattern.name,
        shiftStart: pattern.start_time,
        shiftEnd: pattern.end_time,
      });
      return next;
    });
    closeModal();
  }

  function deleteCell() {
    if (!editTarget) return;
    const key = `${editTarget.staffId}__${editTarget.date}`;
    setDrafts((prev) => {
      const next = new Map(prev);
      // 元からなければドラフトを消すだけ
      if (shiftsByKey.has(key)) next.set(key, null);
      else next.delete(key);
      return next;
    });
    closeModal();
  }

  // ── Save / Cancel ─────────────────────────────────────────────

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
          staffId,
          shiftDate,
          shiftName: draft.shiftName,
          shiftStart: draft.shiftStart,
          shiftEnd: draft.shiftEnd,
        });
      }
    }

    if (upserts.length === 0 && dels.length === 0) {
      onCancel();
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await bulkUpsertShiftsAction(projectId, upserts, dels);
      if (result.success) {
        onSaved();
      } else {
        setError(result.message ?? "保存に失敗しました");
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────

  const draftCount = drafts.size;

  return (
    <div className="flex flex-col h-full">
      {/* ── ツールバー ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 shrink-0">
        <div className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          {draftCount > 0 ? `${draftCount}件 変更中` : "グリッド編集モード"}
        </div>
        <div className="flex items-center gap-2">
          {draftCount > 0 && (
            <button
              onClick={resetDrafts}
              disabled={isPending}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-40"
            >
              リセット
            </button>
          )}
          <button
            onClick={onCancel}
            disabled={isPending}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-40"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={isPending || draftCount === 0}
            className="px-4 py-1.5 text-xs font-bold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {isPending ? "保存中…" : "保存"}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm border-b border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* ── グリッド ── */}
      <div
        className="overflow-auto flex-1"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {/* CSS Grid: 名前列 + 日付列 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `80px repeat(${allDates.length}, 44px)`,
              minWidth: "max-content",
            }}
          >
            {/* ── ヘッダー行 ── */}

            {/* 角セル */}
            <div
              className="sticky top-0 left-0 z-30 bg-white dark:bg-zinc-950 h-12 border-b border-r border-zinc-200 dark:border-zinc-700"
            />

            {/* 日付ヘッダー */}
            {allDates.map((date) => {
              const day = date.slice(8); // "01"～"31"
              const dow = dayOfWeekLabel(date);
              const dowNum = dayOfWeekNum(date);
              const isSun = dowNum === 0;
              const isSat = dowNum === 6;
              const isToday = date === todayJST;
              return (
                <div
                  key={date}
                  className={[
                    "sticky top-0 z-20 h-12 flex flex-col items-center justify-center",
                    "border-b border-r border-zinc-200 dark:border-zinc-700",
                    isToday
                      ? "bg-blue-600 text-white"
                      : "bg-white dark:bg-zinc-950",
                  ].join(" ")}
                >
                  <span
                    className={`text-[11px] font-bold tabular-nums leading-none ${
                      isToday
                        ? "text-white"
                        : isSun
                          ? "text-red-500"
                          : isSat
                            ? "text-blue-500"
                            : "text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {parseInt(day)}
                  </span>
                  <span
                    className={`text-[9px] leading-none mt-0.5 ${
                      isToday
                        ? "text-blue-100"
                        : isSun
                          ? "text-red-400"
                          : isSat
                            ? "text-blue-400"
                            : "text-zinc-400 dark:text-zinc-500"
                    }`}
                  >
                    {dow}
                  </span>
                </div>
              );
            })}

            {/* ── データ行 ── */}
            {activeMembers.map((member) => (
              <>
                {/* 名前セル（sticky left） */}
                <div
                  key={`name-${member.id}`}
                  className="sticky left-0 z-10 bg-white dark:bg-zinc-950 h-11 flex items-center px-2 border-b border-r border-zinc-100 dark:border-zinc-800"
                >
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate leading-tight">
                    {member.name}
                  </span>
                </div>

                {/* シフトセル */}
                {allDates.map((date) => {
                  const cellKey = `${member.id}__${date}`;
                  const hasDraft = drafts.has(cellKey);
                  const draftVal = drafts.get(cellKey);
                  const isDeleted = hasDraft && draftVal === null;
                  const resolved = resolveCell(cellKey);

                  return (
                    <GridCell
                      key={cellKey}
                      cellKey={cellKey}
                      shiftName={resolved?.shiftName ?? null}
                      isDraft={hasDraft}
                      isDeleted={isDeleted}
                      isToday={date === todayJST}
                      onClick={() => openModal(member.id, member.name, date)}
                    />
                  );
                })}
              </>
            ))}
          </div>

          {/* ドラッグ中のオーバーレイ */}
          <DragOverlay dropAnimation={null}>
            {activeId ? (
              <div className="rounded-lg shadow-xl bg-white dark:bg-zinc-800 p-2 opacity-90 pointer-events-none">
                {resolveCell(activeId)?.shiftName ? (
                  <ShiftChip name={resolveCell(activeId)!.shiftName!} />
                ) : null}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* ── 凡例 ── */}
      <div className="shrink-0 px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-4 text-[10px] text-zinc-400 dark:text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded ring-inset ring-1 ring-amber-400 bg-amber-50/40 inline-block" />
          変更
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded ring-inset ring-1 ring-red-300 bg-red-50/30 inline-block" />
          削除予定
        </span>
        <span className="flex items-center gap-1 ml-auto">
          タップ：編集　ドラッグ：移動/スワップ
        </span>
      </div>

      {/* ── 編集モーダル ── */}
      {editTarget && (
        <EditModal
          target={editTarget}
          currentValue={resolveCell(`${editTarget.staffId}__${editTarget.date}`)}
          patterns={shiftPatterns}
          hasOriginal={shiftsByKey.has(`${editTarget.staffId}__${editTarget.date}`)}
          onClose={closeModal}
          onSelect={selectPattern}
          onDelete={deleteCell}
        />
      )}
    </div>
  );
}
