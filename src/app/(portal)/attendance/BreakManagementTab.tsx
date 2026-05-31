"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateBreakSlotAssignmentAction,
  assignBreakSlotsAction,
} from "@/app/(portal)/seating/break-actions";
import type { BreakSlotSetting, BreakSlotAssignment } from "@/app/(portal)/seating/break-actions";
import type { SectionGroup } from "./AttendanceClient";

const SLOT_BG: Record<number, string> = {
  1: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700",
  2: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700",
  3: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700",
};
const SLOT_HEADER_BG: Record<number, string> = {
  1: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
  2: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
  3: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
};
const SLOT_LABEL: Record<number, string> = { 1: "①", 2: "②", 3: "③" };
const TARGET_SHIFT_LABEL: Record<string, string> = {
  early: "早番のみ",
  late:  "遅番のみ",
  both:  "早番・遅番",
};

const BREAK_SECTIONS = ["査定", "販売"] as const;

interface BreakMemberInfo {
  staffId: string;
  name: string;
  accountNumber: string | null;
  shiftName: string;
}

interface Props {
  projectId: string;
  today: string;
  breakSlots: BreakSlotSetting[];
  breakAssignments: BreakSlotAssignment[];
  grouped: SectionGroup[];
}

export default function BreakManagementTab({
  projectId, today, breakSlots, breakAssignments, grouped,
}: Props) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<BreakSlotAssignment[]>(breakAssignments);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  // Build member info map from grouped data
  const memberInfoMap = new Map<string, BreakMemberInfo>();
  for (const sec of grouped) {
    for (const sg of sec.shiftGroups) {
      for (const m of sg.members) {
        memberInfoMap.set(m.staffId, {
          staffId:       m.staffId,
          name:          m.name,
          accountNumber: m.accountNumber,
          shiftName:     sg.shiftName,
        });
      }
    }
  }

  function getSlotNumber(staffId: string): number | null {
    return assignments.find(a => a.staff_id === staffId)?.slot_number ?? null;
  }

  function handleSlotChange(staffId: string, newSlot: number) {
    startTransition(async () => {
      const res = await updateBreakSlotAssignmentAction(projectId, today, staffId, newSlot);
      if (res.success) {
        setAssignments(prev => [
          ...prev.filter(a => a.staff_id !== staffId),
          { staff_id: staffId, slot_number: newSlot },
        ]);
      }
    });
  }

  function handleReassign() {
    if (!window.confirm("今日の休憩スロットを再割り振りしますか？手動変更した内容はリセットされます。")) return;
    startTransition(async () => {
      const res = await assignBreakSlotsAction(projectId, today);
      if (res.success) {
        showToast(`再割り振り完了（${res.count}名）`);
        router.refresh();
      } else {
        showToast(`⚠️ ${res.error ?? "再割り振りに失敗しました"}`);
      }
    });
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  if (breakSlots.length === 0) {
    return <p className="text-sm text-zinc-400 py-6 text-center">休憩スロットが設定されていません</p>;
  }

  // Collect members with assignments, organized by section
  const sectionMembersMap = new Map<string, BreakMemberInfo[]>();
  for (const a of assignments) {
    const info = memberInfoMap.get(a.staff_id);
    if (!info) continue;
    const sec = grouped.find(g =>
      g.shiftGroups.some(sg => sg.members.some(m => m.staffId === a.staff_id))
    )?.section ?? "";
    if (!BREAK_SECTIONS.includes(sec as (typeof BREAK_SECTIONS)[number])) continue;
    if (!sectionMembersMap.has(sec)) sectionMembersMap.set(sec, []);
    // Avoid duplicates
    if (!sectionMembersMap.get(sec)!.some(m => m.staffId === a.staff_id)) {
      sectionMembersMap.get(sec)!.push(info);
    }
  }

  const totalAssigned = assignments.length;

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">休憩管理簿</p>
          <p className="text-xs text-zinc-400">{totalAssigned}名に割り振り済み</p>
        </div>
        <button
          onClick={handleReassign}
          disabled={isPending}
          className="text-xs font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 px-3 py-1.5 rounded-xl border border-violet-200 dark:border-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50"
        >
          {isPending ? "処理中…" : "🔄 再割り振り"}
        </button>
      </div>

      {totalAssigned === 0 && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 py-10 text-center">
          <p className="text-sm text-zinc-400">まだ割り振りが行われていません</p>
          <p className="text-xs text-zinc-400 mt-1">座席配置を保存すると自動で割り振られます</p>
        </div>
      )}

      {/* セクション別表示 */}
      {BREAK_SECTIONS.map(section => {
        const secMembers = sectionMembersMap.get(section) ?? [];
        if (secMembers.length === 0) return null;

        return (
          <div key={section} className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            {/* セクションヘッダー */}
            <div className="px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
              <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200">{section}セクション</span>
              <span className="text-[11px] tabular-nums text-zinc-400">{secMembers.length}名</span>
            </div>

            {/* スロット別グループ */}
            {breakSlots.map(slot => {
              const slotMembers = secMembers.filter(m => getSlotNumber(m.staffId) === slot.slot_number);
              if (slotMembers.length === 0) return null;

              return (
                <div key={slot.slot_number} className={`border-b border-zinc-100 dark:border-zinc-800 last:border-b-0`}>
                  {/* スロットヘッダー */}
                  <div className={`flex items-center gap-2 px-4 py-1.5 border-b border-zinc-100 dark:border-zinc-800 ${SLOT_HEADER_BG[slot.slot_number] ?? ""}`}>
                    <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[11px] font-bold ${SLOT_BG[slot.slot_number] ?? ""}`}>
                      {SLOT_LABEL[slot.slot_number] ?? slot.slot_number}
                    </span>
                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums">
                      {slot.start_time}–{slot.end_time}
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      {TARGET_SHIFT_LABEL[slot.target_shift] ?? slot.target_shift}
                    </span>
                    <span className="ml-auto text-[10px] tabular-nums text-zinc-400">{slotMembers.length}名</span>
                  </div>

                  {/* スタッフ一覧 */}
                  <div className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
                    {slotMembers.map(m => {
                      const currentSlot = getSlotNumber(m.staffId) ?? 1;
                      return (
                        <div key={m.staffId} className="flex items-center gap-2 px-4 py-2">
                          <span className="text-[11px] font-mono text-zinc-400 tabular-nums w-12 shrink-0">
                            {m.accountNumber ?? "—"}
                          </span>
                          <span className="text-sm text-zinc-700 dark:text-zinc-200 flex-1 min-w-0 truncate">
                            {m.name}
                          </span>
                          <span className="text-[10px] text-zinc-400 shrink-0">
                            {m.shiftName}
                          </span>
                          {/* スロット変更セレクト */}
                          <select
                            value={currentSlot}
                            onChange={e => handleSlotChange(m.staffId, parseInt(e.target.value))}
                            disabled={isPending}
                            className="text-xs px-1.5 py-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 disabled:opacity-50"
                          >
                            {breakSlots.map(s => (
                              <option key={s.slot_number} value={s.slot_number}>
                                {SLOT_LABEL[s.slot_number] ?? s.slot_number}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* トースト */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
