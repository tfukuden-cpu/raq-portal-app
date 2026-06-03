"use client";

import { useState, useTransition } from "react";
import { updateBreakSlotAssignmentAction, updateBreakShortSettingAction } from "@/app/(portal)/seating/break-actions";
import type { BreakSlotSetting, BreakSlotAssignment, BreakShortSetting, BreakRecord } from "@/app/(portal)/seating/break-actions";
import type { SectionGroup, StaffTimeline } from "./AttendanceClient";
import PunchTimelineSection from "./PunchTimelineSection";

interface Props {
  projectId: string;
  today: string;
  breakSlots: BreakSlotSetting[];
  breakAssignments: BreakSlotAssignment[];
  breakShortSettings?: BreakShortSetting[];
  breakRecords?: BreakRecord[];
  punchTimelines?: StaffTimeline[];
  grouped: SectionGroup[];
}

export default function BreakManagementTab({
  projectId, today, breakSlots, breakAssignments,
  breakShortSettings = [],
  punchTimelines = [], grouped,
}: Props) {
  const [assignments, setAssignments] = useState<BreakSlotAssignment[]>(breakAssignments);
  const [shortSettings, setShortSettings] = useState<BreakShortSetting[]>(breakShortSettings);
  const [isPending, startTransition] = useTransition();
  const [toast] = useState<string | null>(null);

  const slotByStaff: Record<string, number> = {};
  for (const a of assignments) slotByStaff[a.staff_id] = a.slot_number;

  const shortByStaff: Record<string, number> = {};
  for (const s of shortSettings) shortByStaff[s.staff_id] = s.short_break_minutes;

  function handleSlotChange(staffId: string, newSlot: number) {
    if (isNaN(newSlot)) return;
    startTransition(async () => {
      const res = await updateBreakSlotAssignmentAction(projectId, today, staffId, newSlot);
      if (res.success)
        setAssignments(prev => [...prev.filter(a => a.staff_id !== staffId), { staff_id: staffId, slot_number: newSlot }]);
    });
  }

  function handleShortBreakChange(staffId: string, minutes: number) {
    if (isNaN(minutes)) return;
    startTransition(async () => {
      const res = await updateBreakShortSettingAction(projectId, today, staffId, minutes);
      if (res.success)
        setShortSettings(prev => [...prev.filter(s => s.staff_id !== staffId), { staff_id: staffId, short_break_minutes: minutes }]);
    });
  }

  // スタッフ情報マップ（staffId → { name, section }）
  const staffInfoMap = new Map<string, { name: string; section: string }>();
  for (const sec of grouped) {
    for (const sg of sec.shiftGroups) {
      for (const m of sg.members) {
        staffInfoMap.set(m.staffId, { name: m.name, section: sec.section });
      }
    }
  }

  // スロット × セクション別スタッフ一覧
  const TARGET_SECTIONS = ["査定", "販売"];
  type SlotRow = { slot: BreakSlotSetting; bySec: Record<string, string[]> };
  const slotRows: SlotRow[] = breakSlots.map(slot => {
    const bySec: Record<string, string[]> = {};
    for (const sec of TARGET_SECTIONS) bySec[sec] = [];
    for (const [staffId, slotNum] of Object.entries(slotByStaff)) {
      if (slotNum !== slot.slot_number) continue;
      const info = staffInfoMap.get(staffId);
      if (info && TARGET_SECTIONS.includes(info.section)) {
        bySec[info.section].push(info.name);
      }
    }
    return { slot, bySec };
  });

  const SLOT_HEADER_BG: Record<number, string> = {
    1: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300",
    2: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300",
    3: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300",
  };

  if (breakSlots.length === 0)
    return <p className="text-sm text-zinc-400 py-6 text-center">休憩スロットが設定されていません</p>;

  return (
    <div className="space-y-6">
      {/* ── スロット別割り当て一覧 ── */}
      <div>
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-2">休憩スロット割り当て</p>
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white dark:bg-zinc-950">
          {/* ヘッダー行 */}
          <div className="grid border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900" style={{ gridTemplateColumns: "9rem 1fr 1fr" }}>
            <div className="px-3 py-2 text-[11px] font-semibold text-zinc-400">スロット</div>
            {TARGET_SECTIONS.map(sec => {
              const total = slotRows.reduce((s, r) => s + r.bySec[sec].length, 0);
              return (
                <div key={sec} className="px-3 py-2 text-[11px] font-semibold text-zinc-500 border-l border-zinc-200 dark:border-zinc-700">
                  {sec} <span className="text-zinc-400 font-normal">({total}名)</span>
                </div>
              );
            })}
          </div>
          {/* スロット行 */}
          {slotRows.map(({ slot, bySec }) => (
            <div key={slot.slot_number} className="grid border-b last:border-b-0 border-zinc-100 dark:border-zinc-800" style={{ gridTemplateColumns: "9rem 1fr 1fr" }}>
              {/* スロット名・時間 */}
              <div className={`px-3 py-3 flex flex-col gap-0.5 ${SLOT_HEADER_BG[slot.slot_number] ?? ""}`}>
                <span className="text-xs font-bold tabular-nums">{slot.label} スロット{slot.slot_number}</span>
                <span className="text-[10px] tabular-nums opacity-80">{slot.start_time.slice(0, 5)}〜{slot.end_time.slice(0, 5)}</span>
              </div>
              {/* セクション別スタッフ */}
              {TARGET_SECTIONS.map(sec => (
                <div key={sec} className="px-3 py-2 border-l border-zinc-100 dark:border-zinc-800 flex flex-col gap-1">
                  {bySec[sec].length === 0 ? (
                    <span className="text-[11px] text-zinc-300 dark:text-zinc-600">未割当</span>
                  ) : (
                    bySec[sec].map(name => (
                      <span key={name} className="text-[11px] text-zinc-700 dark:text-zinc-300">{name}</span>
                    ))
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-zinc-400 mt-1.5">各スタッフのスロット変更は下の打刻記録欄から行えます。</p>
      </div>

      <div>
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-1">打刻記録</p>
        <p className="text-xs text-zinc-400">スロット・小休憩の変更はスタッフ名の下のドロップダウンから。</p>
      </div>

      <PunchTimelineSection
        punchTimelines={punchTimelines}
        grouped={grouped}
        breakSlots={breakSlots}
        slotByStaff={slotByStaff}
        onSlotChange={handleSlotChange}
        shortByStaff={shortByStaff}
        onShortBreakChange={handleShortBreakChange}
        disabled={isPending}
      />

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
