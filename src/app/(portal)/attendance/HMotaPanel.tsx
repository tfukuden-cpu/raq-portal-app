"use client";
import { useState, forwardRef, useImperativeHandle } from "react";
import { addMotaAssignmentAction, removeMotaAssignmentAction } from "./mota-actions";
import type { MotaAssignment } from "./mota-actions";

const SLOTS = ["12:00-13:00", "18:00-19:00"] as const;
type Slot = typeof SLOTS[number];

export type MotaRow = {
  accountNumber: string;
  name: string;
  isFixed: boolean;
};

export type HMotaPanelRef = {
  dropStaffCard: (staffName: string, accountNumber: string | null) => Promise<"ok" | "full" | "error">;
};

type DragCard = { accountNumber: string; name: string; isFixed: boolean };

interface Props {
  projectId: string;
  date: string;
  rows: MotaRow[];
  initialAssignments: MotaAssignment[];
}

const HMotaPanel = forwardRef<HMotaPanelRef, Props>(function HMotaPanel(
  { projectId, date, rows, initialAssignments },
  ref,
) {
  const [assignments, setAssignments] = useState<MotaAssignment[]>(initialAssignments);
  const [dragOver, setDragOver] = useState<{ accountNumber: string; slot: Slot } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function getAssignment(positionAccount: string, slot: string): MotaAssignment | undefined {
    return assignments.find(a => a.accountNumber === positionAccount && a.slot === slot);
  }

  async function assignToSlot(
    positionAccount: string,
    slot: Slot,
    isFixed: boolean,
    staffName: string,
    assignedAccount: string | null,
  ): Promise<boolean> {
    const tempId = `temp-${Date.now()}`;
    setAssignments(prev => [...prev, {
      id: tempId,
      accountNumber: positionAccount,
      staffName,
      assignedAccount,
      slot,
      isFixed,
    }]);

    const res = await addMotaAssignmentAction(
      projectId, date, positionAccount, slot, isFixed,
      staffName, assignedAccount,
    );
    if (res.ok && res.id) {
      setAssignments(prev => prev.map(a => a.id === tempId ? { ...a, id: res.id! } : a));
      return true;
    } else {
      setAssignments(prev => prev.filter(a => a.id !== tempId));
      showToast(`⚠️ 配置に失敗しました: ${res.error ?? "不明なエラー"}`);
      return false;
    }
  }

  async function handleDrop(positionAccount: string, slot: Slot, isFixed: boolean, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const raw = e.dataTransfer.getData("mota-card");
    if (!raw) return;

    let card: DragCard;
    try { card = JSON.parse(raw); } catch { return; }
    if (!card.name) return;

    const existing = getAssignment(positionAccount, slot);
    if (existing) return;

    await assignToSlot(positionAccount, slot, isFixed, card.name, card.accountNumber || null);
  }

  // Used by parent to drop a staff card anywhere on the H MOTA column
  useImperativeHandle(ref, () => ({
    async dropStaffCard(staffName, accountNumber) {
      for (const row of rows) {
        for (const slot of SLOTS) {
          if (!getAssignment(row.accountNumber, slot)) {
            const ok = await assignToSlot(row.accountNumber, slot, row.isFixed, staffName, accountNumber);
            return ok ? "ok" : "error";
          }
        }
      }
      showToast("⚠️ H MOTAのスロットが全て埋まっています");
      return "full";
    },
  }));

  async function handleRemove(id: string) {
    setAssignments(prev => prev.filter(a => a.id !== id));
    await removeMotaAssignmentAction(projectId, id);
  }

  if (rows.length === 0) return null;

  const motaRows = rows.filter(r => !r.isFixed);
  const fixedRows = rows.filter(r => r.isFixed);

  return (
    <div className="relative overflow-y-auto flex-1 min-h-0 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-900 z-10">
            <th className="text-left px-2 py-1.5 font-semibold text-zinc-400 text-[10px]">番号</th>
            {SLOTS.map(slot => (
              <th key={slot} className="text-center px-1 py-1.5 font-semibold text-purple-500 tabular-nums text-[10px]">
                {slot}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {motaRows.length > 0 && (
            <tr>
              <td colSpan={3} className="px-2 pt-2 pb-0.5">
                <span className="text-[9px] font-bold text-purple-400 uppercase tracking-wide">MOTA非出勤</span>
              </td>
            </tr>
          )}
          {motaRows.map(row => (
            <MotaTableRow
              key={row.accountNumber}
              row={row}
              dragOver={dragOver}
              getAssignment={getAssignment}
              onDragOver={(slot) => setDragOver({ accountNumber: row.accountNumber, slot })}
              onDragLeave={() => setDragOver(null)}
              onDrop={(slot, e) => handleDrop(row.accountNumber, slot, row.isFixed, e)}
              onRemove={handleRemove}
            />
          ))}
          {fixedRows.length > 0 && (
            <tr>
              <td colSpan={3} className="px-2 pt-2 pb-0.5">
                <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">空き</span>
              </td>
            </tr>
          )}
          {fixedRows.map(row => (
            <MotaTableRow
              key={row.accountNumber}
              row={row}
              dragOver={dragOver}
              getAssignment={getAssignment}
              onDragOver={(slot) => setDragOver({ accountNumber: row.accountNumber, slot })}
              onDragLeave={() => setDragOver(null)}
              onDrop={(slot, e) => handleDrop(row.accountNumber, slot, row.isFixed, e)}
              onRemove={handleRemove}
            />
          ))}
        </tbody>
      </table>

      {toast && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 text-[11px] font-medium shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
});

export default HMotaPanel;

function MotaTableRow({
  row,
  dragOver,
  getAssignment,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemove,
}: {
  row: MotaRow;
  dragOver: { accountNumber: string; slot: string } | null;
  getAssignment: (accountNumber: string, slot: string) => MotaAssignment | undefined;
  onDragOver: (slot: Slot) => void;
  onDragLeave: () => void;
  onDrop: (slot: Slot, e: React.DragEvent) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <tr className="border-b last:border-b-0 border-zinc-50 dark:border-zinc-800/50">
      {/* 番号ラベル（ドラッグ不要） */}
      <td className="px-1.5 py-1">
        <span className={[
          "inline-flex items-center px-1.5 py-0.5 rounded border font-mono font-semibold text-[11px] select-none",
          row.isFixed
            ? "bg-zinc-50 border-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400"
            : "bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/30 dark:border-purple-800 dark:text-purple-300",
        ].join(" ")}>
          {row.accountNumber}
        </span>
      </td>

      {/* スロットセル（ドロップターゲット） */}
      {SLOTS.map(slot => {
        const assignment = getAssignment(row.accountNumber, slot);
        const isTarget = dragOver?.accountNumber === row.accountNumber && dragOver?.slot === slot;

        return (
          <td
            key={slot}
            className="px-1 py-1"
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); onDragOver(slot); }}
            onDragLeave={onDragLeave}
            onDrop={e => { e.stopPropagation(); onDrop(slot, e); }}
          >
            <div className={[
              "rounded border-2 border-dashed flex items-center justify-center transition-colors min-h-[22px]",
              isTarget
                ? "border-purple-400 bg-purple-50 dark:bg-purple-900/20"
                : "border-zinc-200 dark:border-zinc-700",
            ].join(" ")}>
              {assignment ? (
                <div className="flex items-center gap-0.5 px-1 py-px bg-purple-100 dark:bg-purple-900/50 rounded border border-purple-200 dark:border-purple-700 w-full mx-0.5">
                  <span className="flex-1 text-[10px] font-semibold text-purple-700 dark:text-purple-300 truncate">
                    {assignment.staffName || assignment.accountNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(assignment.id)}
                    className="text-purple-300 hover:text-purple-600 dark:hover:text-purple-200 leading-none text-xs font-bold shrink-0"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <span className={[
                  "text-[8px]",
                  isTarget ? "text-purple-400" : "text-zinc-300 dark:text-zinc-600",
                ].join(" ")}>
                  {isTarget ? "→" : "—"}
                </span>
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
}
