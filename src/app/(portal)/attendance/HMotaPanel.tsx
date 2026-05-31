"use client";
import { useState } from "react";
import { addMotaAssignmentAction, removeMotaAssignmentAction } from "./mota-actions";
import type { MotaAssignment } from "./mota-actions";

const SLOTS = ["12:00-13:00", "18:00-19:00"] as const;
type Slot = typeof SLOTS[number];

export type MotaRow = {
  accountNumber: string;
  name: string;
  isFixed: boolean;
};

interface Props {
  projectId: string;
  date: string;
  rows: MotaRow[];
  initialAssignments: MotaAssignment[];
  inline?: boolean;
}

export default function HMotaPanel({ projectId, date, rows, initialAssignments, inline = false }: Props) {
  const [assignments, setAssignments] = useState<MotaAssignment[]>(initialAssignments);
  const [dragging, setDragging] = useState<{ accountNumber: string; isFixed: boolean } | null>(null);
  const [dragOver, setDragOver] = useState<{ accountNumber: string; slot: Slot } | null>(null);

  function getAssignment(accountNumber: string, slot: string): MotaAssignment | undefined {
    return assignments.find(a => a.accountNumber === accountNumber && a.slot === slot);
  }

  async function handleDrop(targetAccountNumber: string, slot: Slot) {
    setDragOver(null);
    if (!dragging || dragging.accountNumber !== targetAccountNumber) return;

    const existing = getAssignment(dragging.accountNumber, slot);
    if (existing) return;

    const tempId = `temp-${Date.now()}`;
    const newAssignment: MotaAssignment = {
      id: tempId,
      accountNumber: dragging.accountNumber,
      slot,
      isFixed: dragging.isFixed,
    };

    setAssignments(prev => [...prev, newAssignment]);

    const res = await addMotaAssignmentAction(
      projectId, date, dragging.accountNumber, slot, dragging.isFixed,
    );
    if (res.ok && res.id) {
      setAssignments(prev =>
        prev.map(a => a.id === tempId ? { ...a, id: res.id! } : a),
      );
    } else {
      setAssignments(prev => prev.filter(a => a.id !== tempId));
    }
    setDragging(null);
  }

  async function handleRemove(id: string) {
    setAssignments(prev => prev.filter(a => a.id !== id));
    await removeMotaAssignmentAction(projectId, id);
  }

  if (rows.length === 0) return null;

  const hMotaRows = rows.filter(r => !r.isFixed);
  const fixedRows = rows.filter(r => r.isFixed);

  const table = (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="border-b border-zinc-100 dark:border-zinc-800">
          <th className="text-left px-2 py-1.5 font-semibold text-zinc-400 w-24 text-[10px]">番号</th>
          {SLOTS.map(slot => (
            <th key={slot} className="text-center px-1 py-1.5 font-semibold text-purple-500 tabular-nums text-[10px]">
              {slot}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {hMotaRows.length > 0 && (
          <tr>
            <td colSpan={3} className="px-2 pt-2 pb-0.5">
              <span className="text-[9px] font-bold text-purple-400 uppercase tracking-wide">空き</span>
            </td>
          </tr>
        )}
        {hMotaRows.map(row => (
          <MotaTableRow
            key={row.accountNumber}
            row={row}
            dragging={dragging}
            dragOver={dragOver}
            getAssignment={getAssignment}
            onDragStart={() => setDragging({ accountNumber: row.accountNumber, isFixed: row.isFixed })}
            onDragEnd={() => { setDragging(null); setDragOver(null); }}
            onDragOver={(slot) => setDragOver({ accountNumber: row.accountNumber, slot })}
            onDragLeave={() => setDragOver(null)}
            onDrop={handleDrop}
            onRemove={handleRemove}
            compact={inline}
          />
        ))}
        {fixedRows.length > 0 && (
          <tr>
            <td colSpan={3} className="px-2 pt-2 pb-0.5">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">固定</span>
            </td>
          </tr>
        )}
        {fixedRows.map(row => (
          <MotaTableRow
            key={row.accountNumber}
            row={row}
            dragging={dragging}
            dragOver={dragOver}
            getAssignment={getAssignment}
            onDragStart={() => setDragging({ accountNumber: row.accountNumber, isFixed: row.isFixed })}
            onDragEnd={() => { setDragging(null); setDragOver(null); }}
            onDragOver={(slot) => setDragOver({ accountNumber: row.accountNumber, slot })}
            onDragLeave={() => setDragOver(null)}
            onDrop={handleDrop}
            onRemove={handleRemove}
            compact={inline}
          />
        ))}
      </tbody>
    </table>
  );

  if (inline) {
    return <div className="overflow-y-auto flex-1 min-h-0">{table}</div>;
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-purple-200 dark:border-purple-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 bg-purple-50 dark:bg-purple-950/30 border-b border-purple-100 dark:border-purple-900">
        <h3 className="text-sm font-bold text-purple-900 dark:text-purple-100">H MOTA スロット配置</h3>
        <p className="text-[11px] text-purple-500 dark:text-purple-400 mt-0.5">
          番号チップをドラッグしてスロットに配置
        </p>
      </div>
      <div className="overflow-x-auto">{table}</div>
    </div>
  );
}

function MotaTableRow({
  row,
  dragging,
  dragOver,
  getAssignment,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemove,
  compact = false,
}: {
  row: MotaRow;
  dragging: { accountNumber: string; isFixed: boolean } | null;
  dragOver: { accountNumber: string; slot: string } | null;
  getAssignment: (accountNumber: string, slot: string) => MotaAssignment | undefined;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (slot: typeof SLOTS[number]) => void;
  onDragLeave: () => void;
  onDrop: (accountNumber: string, slot: typeof SLOTS[number]) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
}) {
  const isDraggingThis = dragging?.accountNumber === row.accountNumber;

  return (
    <tr className="border-b last:border-b-0 border-zinc-50 dark:border-zinc-800/50">
      {/* アカウント番号（ドラッグソース） */}
      <td className={compact ? "px-1.5 py-1" : "px-4 py-1.5"}>
        <div
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className={[
            "inline-flex items-center px-1.5 py-0.5 rounded border cursor-grab active:cursor-grabbing select-none font-mono font-semibold transition-opacity",
            compact ? "text-[9px]" : "text-[11px]",
            row.isFixed
              ? "bg-zinc-50 border-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300"
              : "bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/30 dark:border-purple-800 dark:text-purple-300",
            isDraggingThis ? "opacity-40" : "",
          ].join(" ")}
        >
          {row.accountNumber}
        </div>
      </td>

      {/* スロットセル */}
      {SLOTS.map(slot => {
        const assignment = getAssignment(row.accountNumber, slot);
        const isTarget = dragOver?.accountNumber === row.accountNumber && dragOver?.slot === slot;
        const canDrop = dragging?.accountNumber === row.accountNumber;

        return (
          <td
            key={slot}
            className={compact ? "px-1 py-1" : "px-4 py-1.5"}
            onDragOver={e => { if (canDrop) { e.preventDefault(); onDragOver(slot); } }}
            onDragLeave={onDragLeave}
            onDrop={() => onDrop(row.accountNumber, slot)}
          >
            <div className={[
              "rounded border-2 border-dashed flex items-center justify-center transition-colors",
              compact ? "min-h-[22px] px-0.5" : "min-h-[30px] px-2",
              isTarget && canDrop
                ? "border-purple-400 bg-purple-50 dark:bg-purple-900/20"
                : "border-zinc-200 dark:border-zinc-700",
            ].join(" ")}>
              {assignment ? (
                <div className="flex items-center gap-0.5 px-1 py-px bg-purple-100 dark:bg-purple-900/50 rounded border border-purple-200 dark:border-purple-700">
                  <span className={[
                    "font-semibold font-mono text-purple-700 dark:text-purple-300 tabular-nums",
                    compact ? "text-[8px]" : "text-[10px]",
                  ].join(" ")}>
                    ✓
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(assignment.id)}
                    className="text-purple-300 hover:text-purple-600 dark:hover:text-purple-200 leading-none text-xs font-bold"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <span className={[
                  compact ? "text-[8px]" : "text-[10px]",
                  isTarget && canDrop ? "text-purple-400" : "text-zinc-300 dark:text-zinc-600",
                ].join(" ")}>
                  {isTarget && canDrop ? "→" : "—"}
                </span>
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
}
