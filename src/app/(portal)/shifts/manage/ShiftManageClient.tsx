"use client";

import { useState } from "react";
import ShiftDayList from "./ShiftDayList";
import ShiftSufficiencyTable from "./ShiftSufficiencyTable";
import ShiftRequestsAdmin from "./ShiftRequestsAdmin";

type Shift = {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  note: string | null;
};

type Member = { id: string; name: string; role: string; section: string | null };

type Pattern = {
  name: string;
  required_count: number;
  required_weekday: number | null;
  required_weekend: number | null;
  section: string | null;
  start_time: string | null;
  end_time: string | null;
};

type SlotReq = {
  section: string;
  pattern_name: string;
  shift_date: string;
  required_count: number;
};

type ShiftRequest = {
  id: string;
  staff_name: string;
  request_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  reason: string | null;
  status: string;
};

type Props = {
  projectId: string;
  allDates: string[];
  defaultDate: string;
  shifts: Shift[];
  activeMembers: Member[];
  shiftPatterns: Pattern[];
  slotRequirements: SlotReq[];
  shiftRequests: ShiftRequest[];
  targetYear: number;
  targetMonth: number;
};

export default function ShiftManageClient({
  projectId,
  allDates,
  defaultDate,
  shifts,
  activeMembers,
  shiftPatterns,
  slotRequirements,
  shiftRequests,
  targetYear,
  targetMonth,
}: Props) {
  const [selectedDate, setSelectedDate] = useState(defaultDate);

  return (
    <>
      <ShiftRequestsAdmin requests={shiftRequests} />

      <ShiftSufficiencyTable
        projectId={projectId}
        allDates={allDates}
        patterns={shiftPatterns}
        shifts={shifts.map(s => ({
          staff_id:   s.staff_id,
          shift_date: s.shift_date,
          shift_name: s.shift_name ?? "",
        }))}
        members={activeMembers.map(m => ({ id: m.id, section: m.section }))}
        slotRequirements={slotRequirements}
        holidays={[]}
        selectedDate={selectedDate}
        onDateSelect={setSelectedDate}
      />

      <ShiftDayList
        allDates={allDates}
        shifts={shifts}
        activeMembers={activeMembers}
        shiftPatterns={shiftPatterns}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        projectId={projectId}
        targetYear={targetYear}
        targetMonth={targetMonth}
      />
    </>
  );
}
