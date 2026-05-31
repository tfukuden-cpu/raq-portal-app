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

  // メンバー情報マップ（staffId → info + section）
  const memberInfoMap = new Map<string, BreakMemberInfo & { section: string }>();
  for (const sec of grouped) {
    for (const sg of sec.shiftGroups) {
      for (const m of sg.members) {
        memberInfoMap.set(m.staffId, {
          staffId:       m.staffId,
          name:          m.name,
          accountNumber: m.accountNumber,
          shiftName:     sg.shiftName,
          section:       sec.section,
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

  // スロット × セクション → メンバーリスト
  const slotSectionMap = new Map<number, Map<string, BreakMemberInfo[]>>();
  for (const slot of breakSlots) {
    const secMap = new Map<string, BreakMemberInfo[]>();
    for (const sec of BREAK_SECTIONS) secMap.set(sec, []);
    slotSectionMap.set(slot.slot_number, secMap);
  }
  for (const a of assignments) {
    const info = memberInfoMap.get(a.staff_id);
    if (!info) continue;
    if (!BREAK_SECTIONS.includes(info.section as (typeof BREAK_SECTIONS)[number])) continue;
    const secMap = slotSectionMap.get(a.slot_number);
    if (!secMap) continue;
    const list = secMap.get(info.section);
    if (list && !list.some(m => m.staffId === info.staffId)) list.push(info);
  }

  // セクション別合計人数
  const sectionTotals: Record<string, number> = {};
  for (const sec of BREAK_SECTIONS) {
    sectionTotals[sec] = 0;
    for (const [, secMap] of slotSectionMap) {
      sectionTotals[sec] += secMap.get(sec)?.length ?? 0;
    }
  }

  const totalAssigned = assignments.filter(a => {
    const info = memberInfoMap.get(a.staff_id);
    return info && BREAK_SECTIONS.includes(info.section as (typeof BREAK_SECTIONS)[number]);
  }).length;

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

      {totalAssigned > 0 && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          {/* テーブルヘッダー */}
          <div className="grid border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60"
               style={{ gridTemplateColumns: "minmax(100px,auto) 1fr 1fr" }}>
            <div className="px-3 py-2.5 text-xs font-bold text-zinc-500 dark:text-zinc-400">スロット</div>
            {BREAK_SECTIONS.map(sec => (
              <div key={sec} className="px-3 py-2.5 border-l border-zinc-200 dark:border-zinc-700">
                <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">{sec}</span>
                <span className="ml-1.5 text-[11px] text-zinc-400 tabular-nums">{sectionTotals[sec]}名</span>
              </div>
            ))}
          </div>

          {/* スロット行 */}
          {breakSlots.map((slot, idx) => {
            const secMap = slotSectionMap.get(slot.slot_number);
            const isLast = idx === breakSlots.length - 1;

            return (
              <div
                key={slot.slot_number}
                className={`grid ${!isLast ? "border-b border-zinc-200 dark:border-zinc-700" : ""}`}
                style={{ gridTemplateColumns: "minmax(100px,auto) 1fr 1fr" }}
              >
                {/* スロット情報セル */}
                <div className={`px-3 py-3 flex flex-col gap-0.5 ${SLOT_HEADER_BG[slot.slot_number] ?? ""}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[11px] font-bold ${SLOT_BG[slot.slot_number] ?? ""}`}>
                      {slot.label}
                    </span>
                    <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200 tabular-nums">
                      {slot.start_time.slice(0, 5)}
                    </span>
                  </div>
                  <div className="pl-0.5 text-[10px] text-zinc-400 tabular-nums">
                    〜{slot.end_time.slice(0, 5)}
                  </div>
                  <div className="text-[9px] text-zinc-400 leading-tight">
                    {TARGET_SHIFT_LABEL[slot.target_shift] ?? slot.target_shift}
                  </div>
                </div>

                {/* セクション別メンバーセル */}
                {BREAK_SECTIONS.map(sec => {
                  const members = secMap?.get(sec) ?? [];
                  return (
                    <div key={sec} className="px-2 py-2 border-l border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-50 dark:divide-zinc-800/60">
                      {members.length === 0 ? (
                        <p className="text-[11px] text-zinc-300 dark:text-zinc-600 py-1 text-center">—</p>
                      ) : (
                        members.map(m => (
                          <div key={m.staffId} className="flex items-center gap-1.5 py-1.5 min-w-0">
                            <span className="text-[10px] font-mono text-zinc-400 tabular-nums shrink-0 w-10 truncate">
                              {m.accountNumber ?? "—"}
                            </span>
                            <span className="text-xs text-zinc-700 dark:text-zinc-200 flex-1 min-w-0 truncate">
                              {m.name}
                            </span>
                            <select
                              value={getSlotNumber(m.staffId) ?? slot.slot_number}
                              onChange={e => handleSlotChange(m.staffId, parseInt(e.target.value))}
                              disabled={isPending}
                              className="text-[10px] px-1 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 disabled:opacity-50 shrink-0"
                            >
                              {breakSlots.map(s => (
                                <option key={s.slot_number} value={s.slot_number}>{s.label}</option>
                              ))}
                            </select>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* トースト */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
