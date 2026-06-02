/**
 * GET /api/admin/work-records/compliance
 * 勤怠順守率を返す（JSON）
 * query: projectId, staffIds (comma), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAccess(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const [{ data: membership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);
  return (
    membership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive"
  );
}

const OFF_SHIFT_NAMES = ["公休","有休","休暇","振替休日","特別休暇","代休","欠勤"];

export type ComplianceRow = {
  staffId: string;
  name: string;
  accountNumber: string | null;
  section: string | null;
  company: string | null;
  totalShiftDays: number;
  problemDays: number;
  lateDays: number;
  earlyDays: number;
  absentDays: number;
  complianceRate: number | null;
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const projectId   = searchParams.get("projectId")  ?? "";
  const startDate   = searchParams.get("startDate")  ?? "";
  const endDate     = searchParams.get("endDate")    ?? "";
  const staffIdsRaw = searchParams.get("staffIds")   ?? "";

  if (!projectId || !startDate || !endDate)
    return new NextResponse("Bad Request", { status: 400 });
  if (!(await requireAccess(projectId)))
    return new NextResponse("Forbidden", { status: 403 });

  const staffIds = staffIdsRaw ? staffIdsRaw.split(",").filter(Boolean) : [];
  const admin = createAdminClient();
  const startISO = `${startDate}T00:00:00+09:00`;
  const endISO   = `${endDate}T23:59:59+09:00`;

  // スタッフ情報
  let memberQ = admin
    .from("project_members")
    .select("staff_id, section, staffs(id, name, display_name, account_number, company_name)")
    .eq("project_id", projectId);
  if (staffIds.length > 0) memberQ = memberQ.in("staff_id", staffIds);
  const { data: members } = await memberQ;

  const memberMap = new Map<string, { name: string; accountNumber: string | null; section: string | null; company: string | null }>();
  for (const m of members ?? []) {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as {
      display_name?: string | null; name?: string | null;
      account_number?: string | null; company_name?: string | null;
    } | null;
    memberMap.set(m.staff_id, {
      name:          s?.display_name ?? s?.name ?? m.staff_id,
      accountNumber: s?.account_number ?? null,
      section:       m.section        ?? null,
      company:       s?.company_name  ?? null,
    });
  }

  const targetIds = staffIds.length > 0 ? staffIds : [...memberMap.keys()];

  let shiftsQ = admin.from("shifts")
    .select("staff_id, shift_date, shift_name, shift_start, shift_end")
    .eq("project_id", projectId)
    .gte("shift_date", startDate).lte("shift_date", endDate);
  if (targetIds.length > 0) shiftsQ = shiftsQ.in("staff_id", targetIds);

  const [
    { data: shifts },
    { data: absences },
    { data: lates },
    { data: patterns },
  ] = await Promise.all([
    shiftsQ,
    admin.from("absence_reports")
      .select("staff_id, absence_date")
      .eq("project_id", projectId)
      .gte("absence_date", startDate).lte("absence_date", endDate),
    admin.from("late_reports")
      .select("staff_id, late_date")
      .eq("project_id", projectId)
      .gte("late_date", startDate).lte("late_date", endDate),
    admin.from("shift_patterns")
      .select("name, start_time, end_time")
      .eq("project_id", projectId),
  ]);

  // 早退判定に必要な打刻
  const { data: punches } = await admin.from("punch_logs")
    .select("staff_id, punch_type, recorded_at")
    .eq("project_id", projectId)
    .gte("recorded_at", startISO).lte("recorded_at", endISO)
    .order("recorded_at");

  const punchMap = new Map<string, { clockOut: string | null }>();
  for (const p of punches ?? []) {
    const key = `${p.staff_id}_${p.recorded_at.slice(0, 10)}`;
    if (!punchMap.has(key)) punchMap.set(key, { clockOut: null });
    if (p.punch_type === "clock_out") punchMap.get(key)!.clockOut = p.recorded_at;
  }

  const patternMap = new Map<string, { end: string }>(
    (patterns ?? []).filter(p => p.end_time)
      .map(p => [p.name as string, { end: p.end_time as string }])
  );

  const absenceSet = new Set((absences ?? []).map(a => `${a.staff_id}_${a.absence_date}`));
  const lateSet    = new Set((lates    ?? []).map(l => `${l.staff_id}_${l.late_date}`));

  // 集計
  const personMap = new Map<string, ComplianceRow>();

  for (const shift of shifts ?? []) {
    if (OFF_SHIFT_NAMES.includes(shift.shift_name ?? "")) continue;
    const m = memberMap.get(shift.staff_id);
    if (!m) continue;

    if (!personMap.has(shift.staff_id)) {
      personMap.set(shift.staff_id, {
        staffId: shift.staff_id, name: m.name,
        accountNumber: m.accountNumber, section: m.section, company: m.company,
        totalShiftDays: 0, problemDays: 0,
        lateDays: 0, earlyDays: 0, absentDays: 0,
        complianceRate: null,
      });
    }
    const row = personMap.get(shift.staff_id)!;
    const key = `${shift.staff_id}_${shift.shift_date}`;

    const isAbsent = absenceSet.has(key);
    const isLate   = lateSet.has(key);

    const resolvedEnd = shift.shift_end ?? patternMap.get(shift.shift_name ?? "")?.end ?? null;
    const clockOut    = punchMap.get(key)?.clockOut ?? null;
    let isEarlyLeave  = false;
    if (clockOut && resolvedEnd) {
      const endMs = new Date(`${shift.shift_date}T${resolvedEnd}:00+09:00`).getTime();
      isEarlyLeave = new Date(clockOut).getTime() < endMs - 10 * 60000;
    }

    row.totalShiftDays++;
    if (isAbsent)    { row.absentDays++; row.problemDays++; }
    if (isLate)      { row.lateDays++;   row.problemDays++; }
    if (isEarlyLeave){ row.earlyDays++;  row.problemDays++; }
  }

  const result: ComplianceRow[] = [...personMap.values()].map(r => ({
    ...r,
    complianceRate: r.totalShiftDays > 0
      ? Math.round((r.totalShiftDays - r.problemDays) / r.totalShiftDays * 100)
      : null,
  })).sort((a, b) => (b.complianceRate ?? 0) - (a.complianceRate ?? 0));

  return NextResponse.json(result);
}
