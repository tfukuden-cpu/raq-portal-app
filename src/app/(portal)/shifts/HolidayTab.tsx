"use client";

import StaffOffRequestCalendar from "./StaffOffRequestCalendar";

type Props = {
  projectId: string;
  holidayRequests: unknown[]; // 後方互換のため残す（未使用）
  initialYear: number;
  initialMonth: number;
  openDay?: number | null;
  deadlineDay?: number | null;
  maxDaysPerMonth?: number | null;
  weekendLimit?: number | null;
};

export default function HolidayTab({
  initialYear,
  initialMonth,
  openDay = null,
  deadlineDay = null,
  maxDaysPerMonth = null,
}: Props) {
  return (
    <div>
      <StaffOffRequestCalendar
        initialYear={initialYear}
        initialMonth={initialMonth}
        openDay={openDay}
        deadlineDay={deadlineDay}
        maxDaysPerMonth={maxDaysPerMonth}
      />
    </div>
  );
}
