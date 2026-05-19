/**
 * 勤怠修正ページ（管理者用）
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import AttendanceEditClient from "./AttendanceEditClient";
import type { AttendanceRow, CorrectionRow } from "./AttendanceEditClient";

const OFF_SHIFT_NAMES = ["公休","有休","休暇","振替休日","特別休暇","代休","欠勤"];

function tokyoToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}


export default async function AttendanceEditPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId  = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const [{ data: membership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);
  const isAuthorized =
    membership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";
  if (!isAuthorized) redirect("/dashboard");

  const admin = createAdminClient();
  const today     = tokyoToday();
  const startDate = today.slice(0, 7) + "-01"; // 当月1日
  const endDate   = today;
  const startISO  = `${startDate}T00:00:00+09:00`;
  const endISO    = `${endDate}T23:59:59+09:00`;

  const [
    { data: members },
    { data: shifts },
    { data: punches },
    { data: absences },
    { data: lates },
    { data: patterns },
    { data: rawCorrections },
  ] = await Promise.all([
    admin.from("project_members")
      .select("staff_id, section, staffs(id, name, display_name, account_number)")
      .eq("project_id", projectId),
    admin.from("shifts")
      .select("staff_id, shift_date, shift_name, shift_start, shift_end")
      .eq("project_id", projectId)
      .gte("shift_date", startDate).lte("shift_date", endDate)
      .order("shift_date").order("staff_id"),
    admin.from("punch_logs")
      .select("staff_id, punch_type, recorded_at")
      .eq("project_id", projectId)
      .gte("recorded_at", startISO).lte("recorded_at", endISO)
      .order("recorded_at"),
    admin.from("absence_reports")
      .select("staff_id, absence_date, reason")
      .eq("project_id", projectId)
      .gte("absence_date", startDate).lte("absence_date", endDate),
    admin.from("late_reports")
      .select("staff_id, late_date, reason")
      .eq("project_id", projectId)
      .gte("late_date", startDate).lte("late_date", endDate),
    admin.from("shift_patterns")
      .select("name, start_time, end_time")
      .eq("project_id", projectId),
    supabase.from("punch_corrections")
      .select("id, target_date, corrected_in, corrected_out, reason, status, review_note, created_at, staff_id, staffs(name, display_name)")
      .eq("project_id", projectId)
      .order("target_date", { ascending: false }),
  ]);

  const corrections: CorrectionRow[] = (rawCorrections ?? []).map((c) => {
    const staff = Array.isArray(c.staffs) ? c.staffs[0] : c.staffs;
    return {
      id:            c.id,
      target_date:   c.target_date,
      corrected_in:  c.corrected_in,
      corrected_out: c.corrected_out,
      reason:        c.reason,
      status:        c.status,
      review_note:   c.review_note,
      created_at:    c.created_at,
      staff_id:      c.staff_id,
      staff_name:    (staff as { display_name?: string | null; name?: string | null } | null)?.display_name
                     ?? (staff as { name?: string | null } | null)?.name
                     ?? c.staff_id,
    };
  });

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
      .map(p => [p.name as string, { start: p.start_time as string, end: p.end_time as string }])
  );

  // 打刻マップ
  const punchMap = new Map<string, { clockIn: string | null; clockOut: string | null }>();
  for (const p of punches ?? []) {
    const key = `${p.staff_id}_${p.recorded_at.slice(0, 10)}`;
    if (!punchMap.has(key)) punchMap.set(key, { clockIn: null, clockOut: null });
    const e = punchMap.get(key)!;
    if (p.punch_type === "clock_in"  && !e.clockIn) e.clockIn  = p.recorded_at;
    if (p.punch_type === "clock_out")                e.clockOut = p.recorded_at;
  }

  const absenceMap = new Map((absences ?? []).map(a => [`${a.staff_id}_${a.absence_date}`, a.reason ?? ""]));
  const lateMap    = new Map((lates    ?? []).map(l => [`${l.staff_id}_${l.late_date}`, l.reason ?? ""]));

  // 行データ構築
  const rows: AttendanceRow[] = [];

  for (const shift of shifts ?? []) {
    const shiftName = shift.shift_name ?? "";
    if (OFF_SHIFT_NAMES.includes(shiftName)) continue;
    const m = memberMap.get(shift.staff_id);
    if (!m) continue;

    const pattern   = patternMap.get(shiftName);
    const shiftStart = shift.shift_start ?? pattern?.start ?? null;
    const shiftEnd   = shift.shift_end   ?? pattern?.end   ?? null;

    const key      = `${shift.staff_id}_${shift.shift_date}`;
    const punch    = punchMap.get(key);
    const isAbsent = absenceMap.has(key);
    const isLate   = lateMap.has(key);

    // 早退判定
    let isEarlyLeave = false;
    if (punch?.clockOut && shiftEnd) {
      const endDt  = new Date(`${shift.shift_date}T${shiftEnd}:00+09:00`);
      const outDt  = new Date(punch.clockOut);
      isEarlyLeave = outDt.getTime() < endDt.getTime() - 15 * 60000;
    }

    // ステータス
    let status: AttendanceRow["status"] = "ok";
    if (isAbsent)                  status = "absent";
    else if (!punch?.clockIn)      status = "no_clockin";
    else if (!punch?.clockOut)     status = "no_clockout";
    else if (isLate)               status = "late";
    else if (isEarlyLeave)         status = "early";

    rows.push({
      date:          shift.shift_date,
      staffId:       shift.staff_id,
      name:          m.name,
      accountNumber: m.accountNumber,
      section:       m.section,
      shiftName,
      shiftStart,
      shiftEnd,
      clockIn:       punch?.clockIn  ?? null,
      clockOut:      punch?.clockOut ?? null,
      isLate,
      lateReason:    lateMap.get(key) ?? null,
      isEarlyLeave,
      isAbsent,
      absenceReason: absenceMap.get(key) ?? null,
      status,
    });
  }

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-24">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            勤怠修正
          </h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            打刻漏れ・遅刻・欠勤の確認と修正
          </p>
        </div>
        <AttendanceEditClient
          projectId={projectId}
          rows={rows}
          corrections={corrections}
          startDate={startDate}
          endDate={endDate}
        />
      </div>
    </main>
  );
}
