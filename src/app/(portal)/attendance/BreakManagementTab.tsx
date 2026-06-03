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

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-400">スロット・小休憩の変更はスタッフ名の下のドロップダウンから。休憩スロット一覧は座席表から確認できます。</p>
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
    </div>
  );
}
