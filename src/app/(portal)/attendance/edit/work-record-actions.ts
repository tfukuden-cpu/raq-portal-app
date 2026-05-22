"use server";

import { createAdminClient } from "@/lib/supabase/admin";

const OFF_SHIFT_NAMES = ["公休","有休","休暇","振替休日","特別休暇","代休","欠勤"];

export type DayRecord = {
  date: string;
  shiftName: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  clockIn: string | null;
  clockOut: string | null;
  isAbsent: boolean;
  absenceReason: string | null;
  isLate: boolean;
  lateReason: string | null;
  isEarlyLeave: boolean;
  status: "ok" | "no_clockin" | "no_clockout" | "absent" | "late" | "early";
};

export type StaffSummary = {
  staffId: string;
  name: string;
  accountNumber: string | null;
  section: string | null;
  totalDays: number;
  workDays: number;
  absentDays: number;
  lateDays: number;
  earlyDays: number;
  missingDays: number;
  days: DayRecord[];
};

export async function fetchAttendanceSummaryAction(
  projectId: string,
  startDate: string,
  endDate: string,
): Promise<{ success: boolean; staffList?: StaffSummary[]; message?: string }> {
  try {
    const admin    = createAdminClient();
    const startISO = `${startDate}T00:00:00+09:00`;
    const endISO   = `${endDate}T23:59:59+09:00`;

    const [
      { data: members },
      { data: shifts },
      { data: punches },
      { data: absences },
      { data: lates },
      { data: patterns },
    ] = await Promise.all([
      admin.from("project_members")
        .select("staff_id, section, staffs(id, name, display_name, account_number)")
        .eq("project_id", projectId)
        .limit(5000),
      admin.from("shifts")
        .select("staff_id, shift_date, shift_name, shift_start, shift_end")
        .eq("project_id", projectId)
        .gte("shift_date", startDate).lte("shift_date", endDate)
        .order("shift_date").order("staff_id")
        .limit(20000),
      admin.from("punch_logs")
        .select("staff_id, punch_type, recorded_at")
        .eq("project_id", projectId)
        .gte("recorded_at", startISO).lte("recorded_at", endISO)
        .order("recorded_at")
        .limit(50000),
      admin.from("absence_reports")
        .select("staff_id, absence_date, reason")
        .eq("project_id", projectId)
        .gte("absence_date", startDate).lte("absence_date", endDate)
        .limit(5000),
      admin.from("late_reports")
        .select("staff_id, late_date, reason")
        .eq("project_id", projectId)
        .gte("late_date", startDate).lte("late_date", endDate)
        .limit(5000),
      admin.from("shift_patterns")
        .select("name, start_time, end_time")
        .eq("project_id", projectId),
    ]);

    // メンバーマップ
    const memberMap = new Map<string, { name: string; accountNumber: string | null; section: string | null }>();
    for (const m of members ?? []) {
      const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as {
        display_name?: string | null; name?: string | null; account_number?: string | null;
      } | null;
      memberMap.set(m.staff_id, {
        name:          s?.display_name ?? s?.name ?? m.staff_id,
        accountNumber: s?.account_number ?? null,
        section:       m.section ?? null,
      });
    }

    // パターン時刻マップ
    const patternMap = new Map<string, { start: string; end: string }>(
      (patterns ?? []).filter(p => p.start_time && p.end_time)
        .map(p => [p.name as string, { start: p.start_time as string, end: p.end_time as string }]),
    );

    // 打刻マップ
    const punchMap = new Map<string, { clockIn: string | null; clockOut: string | null }>();
    for (const p of punches ?? []) {
      const key = `${p.staff_id}_${p.recorded_at.slice(0, 10)}`;
      if (!punchMap.has(key)) punchMap.set(key, { clockIn: null, clockOut: null });
      const e = punchMap.get(key)!;
      if (p.punch_type === "clock_in"  && !e.clockIn) e.clockIn  = p.recorded_at;
      if (p.punch_type === "clock_out")               e.clockOut = p.recorded_at;
    }

    const absenceMap = new Map((absences ?? []).map(a => [`${a.staff_id}_${a.absence_date}`, a.reason ?? ""]));
    const lateMap    = new Map((lates    ?? []).map(l => [`${l.staff_id}_${l.late_date}`,    l.reason ?? ""]));

    // スタッフ別集計
    const staffMap = new Map<string, StaffSummary>();

    for (const shift of shifts ?? []) {
      const shiftName = shift.shift_name ?? "";
      if (OFF_SHIFT_NAMES.includes(shiftName)) continue;
      const m = memberMap.get(shift.staff_id);
      if (!m) continue;

      if (!staffMap.has(shift.staff_id)) {
        staffMap.set(shift.staff_id, {
          staffId:       shift.staff_id,
          name:          m.name,
          accountNumber: m.accountNumber,
          section:       m.section,
          totalDays:  0,
          workDays:   0,
          absentDays: 0,
          lateDays:   0,
          earlyDays:  0,
          missingDays: 0,
          days: [],
        });
      }

      const entry      = staffMap.get(shift.staff_id)!;
      const pattern    = patternMap.get(shiftName);
      const shiftStart = shift.shift_start ?? pattern?.start ?? null;
      const shiftEnd   = shift.shift_end   ?? pattern?.end   ?? null;
      const key        = `${shift.staff_id}_${shift.shift_date}`;
      const punch      = punchMap.get(key);
      const isAbsent   = absenceMap.has(key);
      const isLate     = lateMap.has(key);

      let isEarlyLeave = false;
      if (punch?.clockOut && shiftEnd) {
        const endDt  = new Date(`${shift.shift_date}T${shiftEnd}:00+09:00`);
        const outDt  = new Date(punch.clockOut);
        isEarlyLeave = outDt.getTime() < endDt.getTime() - 15 * 60000;
      }

      let status: DayRecord["status"] = "ok";
      if (isAbsent)               status = "absent";
      else if (!punch?.clockIn)   status = "no_clockin";
      else if (!punch?.clockOut)  status = "no_clockout";
      else if (isLate)            status = "late";
      else if (isEarlyLeave)      status = "early";

      entry.totalDays++;
      if      (status === "absent")                                    entry.absentDays++;
      else if (status === "no_clockin" || status === "no_clockout")    entry.missingDays++;
      else if (status === "late")                                       entry.lateDays++;
      else if (status === "early")                                      entry.earlyDays++;
      else                                                              entry.workDays++;

      entry.days.push({
        date:          shift.shift_date,
        shiftName,
        shiftStart,
        shiftEnd,
        clockIn:       punch?.clockIn  ?? null,
        clockOut:      punch?.clockOut ?? null,
        isAbsent,
        absenceReason: absenceMap.get(key) ?? null,
        isLate,
        lateReason:    lateMap.get(key) ?? null,
        isEarlyLeave,
        status,
      });
    }

    const staffList = [...staffMap.values()].sort((a, b) =>
      a.staffId.localeCompare(b.staffId),
    );
    return { success: true, staffList };
  } catch (e) {
    return { success: false, message: String(e) };
  }
}
