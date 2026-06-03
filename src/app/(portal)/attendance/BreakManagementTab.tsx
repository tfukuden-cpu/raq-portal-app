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

  if (breakSlots.length === 0)
    return <p className="text-sm text-zinc-400 py-6 text-center">休憩スロットが設定されていません</p>;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">休憩管理簿</p>
        <p className="text-xs text-zinc-400 mt-0.5">打刻記録と休憩スロットを表示。休憩の自動配置は座席表の編集で行います。</p>
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
