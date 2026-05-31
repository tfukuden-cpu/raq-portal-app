"use client";
import { useState } from "react";
import { addMotaAssignmentAction, removeMotaAssignmentAction } from "./mota-actions";
import type { MotaAssignment } from "./mota-actions";

const SLOTS = ["12:00-13:00", "18:00-19:00"] as const;
type Slot = typeof SLOTS[number];

const FIXED_MOTA_NUMBERS = [
  "ASS 130", "ASS 131", "ASS 132", "ASS 133", "ASS 134",
  "ASS 196", "ASS 197", "ASS 198", "ASS 199", "ASS 200",
];

interface Props {
  projectId: string;
  date: string;
  nameLookup: Record<string, string>; // accountNumber → name
  initialAssignments: MotaAssignment[];
}

type DragCard = { accountNumber: string; name: string; isFixed: boolean };

export default function HMotaPanel({ projectId, date, nameLookup, initialAssignments }: Props) {
  const [assignments, setAssignments] = useState<MotaAssignment[]>(initialAssignments);
  const [dragOver, setDragOver] = useState<Slot | null>(null);

  function getSlotAssignments(slot: string): MotaAssignment[] {
    return assignments.filter(a => a.slot === slot);
  }

  function getName(accountNumber: string): string {
    return nameLookup[accountNumber] ?? accountNumber;
  }

  async function handleDrop(slot: Slot, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const raw = e.dataTransfer.getData("mota-card");
    if (!raw) return;

    let card: DragCard;
    try { card = JSON.parse(raw); } catch { return; }
    if (!card.accountNumber) return;

    const existing = assignments.find(a => a.accountNumber === card.accountNumber && a.slot === slot);
    if (existing) return;

    const tempId = `temp-${Date.now()}`;
    setAssignments(prev => [...prev, {
      id: tempId,
      accountNumber: card.accountNumber,
      slot,
      isFixed: card.isFixed,
    }]);

    const res = await addMotaAssignmentAction(projectId, date, card.accountNumber, slot, card.isFixed);
    if (res.ok && res.id) {
      setAssignments(prev => prev.map(a => a.id === tempId ? { ...a, id: res.id! } : a));
    } else {
      setAssignments(prev => prev.filter(a => a.id !== tempId));
    }
  }

  async function handleRemove(id: string) {
    setAssignments(prev => prev.filter(a => a.id !== id));
    await removeMotaAssignmentAction(projectId, id);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* スロット列 */}
      <div className="flex flex-1 min-h-0 divide-x divide-zinc-100 dark:divide-zinc-800">
        {SLOTS.map(slot => {
          const slotItems = getSlotAssignments(slot);
          const isTarget = dragOver === slot;
          return (
            <div
              key={slot}
              className={[
                "flex-1 flex flex-col min-h-0 transition-colors",
                isTarget ? "bg-purple-50 dark:bg-purple-950/20" : "",
              ].join(" ")}
              onDragOver={e => { e.preventDefault(); setDragOver(slot); }}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
              }}
              onDrop={e => handleDrop(slot, e)}
            >
              {/* スロットヘッダー */}
              <div className="px-2 py-1.5 border-b border-zinc-100 dark:border-zinc-800 text-center text-[10px] font-bold tabular-nums text-purple-500 dark:text-purple-400 shrink-0">
                {slot}
              </div>

              {/* 配置済みリスト */}
              <div
                className="flex-1 overflow-y-auto p-1.5 space-y-1 [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: "none" }}
              >
                {slotItems.map(a => (
                  <div
                    key={a.id}
                    className="flex items-center gap-1 px-1.5 py-1 rounded bg-purple-100 dark:bg-purple-900/40 border border-purple-200 dark:border-purple-700"
                  >
                    <span className="flex-1 text-[10px] font-semibold text-purple-800 dark:text-purple-200 truncate">
                      {getName(a.accountNumber)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemove(a.id)}
                      className="text-purple-300 hover:text-purple-600 dark:hover:text-purple-200 font-bold text-xs leading-none shrink-0"
                    >
                      ×
                    </button>
                  </div>
                ))}

                {/* ドロップ枠 */}
                <div className={[
                  "rounded border-2 border-dashed flex items-center justify-center text-[10px] transition-colors",
                  slotItems.length === 0 ? "h-12" : "h-8",
                  isTarget
                    ? "border-purple-400 text-purple-400 bg-purple-50/50 dark:bg-purple-900/10"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-300 dark:text-zinc-600",
                ].join(" ")}>
                  {isTarget ? "→ ここにドロップ" : slotItems.length === 0 ? "—" : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 固定番号チップ */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 p-2 shrink-0">
        <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide mb-1.5">固定番号</div>
        <div className="flex flex-wrap gap-1">
          {FIXED_MOTA_NUMBERS.map(n => (
            <div
              key={n}
              draggable
              onDragStart={e => {
                e.dataTransfer.setData("mota-card", JSON.stringify({ accountNumber: n, name: n, isFixed: true }));
              }}
              className="inline-flex items-center px-1.5 py-0.5 rounded border cursor-grab active:cursor-grabbing select-none font-mono font-semibold text-[9px] bg-zinc-50 border-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 hover:border-purple-300 transition-colors"
            >
              {n}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
