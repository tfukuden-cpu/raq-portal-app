import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import AttendanceEditClient from "./AttendanceEditClient";
import type { AttendanceRow, CorrectionRow, ExceptionRow } from "./AttendanceEditClient";
import type { StaffEntry } from "@/app/(portal)/admin/work-records/WorkRecordsClient";

const OFF_SHIFT_NAMES = ["公休","有休","休暇","振替休日","特別休暇","代休","欠勤"];

function tokyoToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function lastDayOfMonth(yyyyMM: string): string {
  const [y, m] = yyyyMM.split("-").map(Number);
  return new Date(y, m, 0).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export default async function AttendanceEditPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string; staffId?: string }>;
}) {
  const { tab: initialTab, month, staffId: initialStaffId } = await searchParams;

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

  const today        = tokyoToday();
  const currentMonth = month ?? today.slice(0, 7);
  const startDate    = `${currentMonth}-01`;
  const endDate      = lastDayOfMonth(currentMonth);
  const startISO     = `${startDate}T00:00:00+09:00`;
  const endISO       = `${endDate}T23:59:59+09:00`;

  const admin = createAdminClient();

  // ── ページネーション付きフェッチ ─────────────────────────────────────
  // PostgREST は .limit(N) を指定しても1回あたり最大1000行しか返さない。
  // shifts(数千件)/punch_logs(数千件) は1000行で切られ「8日までしか出ない／
  // 後半スタッフの打刻が欠落」する。1000行ずつ全件取得する。
  async function fetchAllShifts() {
    const PAGE = 1000;
    const all: { staff_id: string; shift_date: string; shift_name: string; shift_start: string | null; shift_end: string | null }[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("shifts")
        .select("staff_id, shift_date, shift_name, shift_start, shift_end")
        .eq("project_id", projectId)
        .gte("shift_date", startDate).lte("shift_date", endDate)
        .order("shift_date").order("staff_id")
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  }

  async function fetchAllPunches() {
    const PAGE = 1000;
    const all: { staff_id: string; punch_type: string; recorded_at: string; note: string | null }[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("punch_logs")
        .select("staff_id, punch_type, recorded_at, note")
        .eq("project_id", projectId)
        .in("punch_type", ["clock_in", "clock_out"])
        .gte("recorded_at", startISO).lte("recorded_at", endISO)
        .order("recorded_at")
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  }

  const [
    { data: members },
    shifts,
    punches,
    { data: absences },
    { data: lates },
    { data: patterns },
    { data: breakOverrides },
    { data: confirmations },
    { data: approvedExceptions },
    { data: staffMembers },
    { data: rawCorrections },
    { data: rawExceptions },
  ] = await Promise.all([
    admin.from("project_members")
      .select("staff_id, section, staffs(id, name, display_name, account_number)")
      .eq("project_id", projectId).limit(5000),
    fetchAllShifts(),
    fetchAllPunches(),
    admin.from("absence_reports")
      .select("staff_id, absence_date, reason")
      .eq("project_id", projectId)
      .gte("absence_date", startDate).lte("absence_date", endDate).limit(5000),
    admin.from("late_reports")
      .select("staff_id, late_date, reason")
      .eq("project_id", projectId)
      .gte("late_date", startDate).lte("late_date", endDate).limit(5000),
    admin.from("shift_patterns")
      .select("name, start_time, end_time").eq("project_id", projectId),
    admin.from("staff_break_overrides")
      .select("staff_id, override_date, regular_minutes")
      .eq("project_id", projectId)
      .gte("override_date", startDate).lte("override_date", endDate).limit(5000),
    admin.from("attendance_confirmations")
      .select("staff_id, work_date, confirmed_by")
      .eq("project_id", projectId)
      .gte("work_date", startDate).lte("work_date", endDate).limit(5000),
    admin.from("work_exception_requests")
      .select("staff_id, shift_date, request_type, signer_name, status")
      .eq("project_id", projectId).eq("status", "approved")
      .gte("shift_date", startDate).lte("shift_date", endDate).limit(5000),
    admin.from("project_members")
      .select("staff_id, section, staffs(id, name, display_name, account_number, company_name)")
      .eq("project_id", projectId).order("staff_id"),
    admin.from("punch_corrections")
      .select("id, target_date, corrected_in, corrected_out, reason, status, review_note, created_at, staff_id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(2000),
    admin.from("work_exception_requests")
      .select("id, staff_id, shift_date, request_type, signer_name, status, created_at")
      .eq("project_id", projectId)
      .order("shift_date", { ascending: false })
      .limit(2000),
  ]);

  // ── マップ構築 ────────────────────────────────────────────────
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

  const patternMap = new Map<string, { start: string; end: string }>(
    (patterns ?? []).filter(p => p.start_time && p.end_time)
      .map(p => [p.name as string, { start: p.start_time as string, end: p.end_time as string }])
  );

  const punchMap = new Map<string, { clockIn: string | null; clockOut: string | null; modifiedBy: string | null; clockInNote: string | null; clockOutNote: string | null }>();
  for (const p of punches ?? []) {
    const key = `${p.staff_id}_${p.recorded_at.slice(0, 10)}`;
    if (!punchMap.has(key)) punchMap.set(key, { clockIn: null, clockOut: null, modifiedBy: null, clockInNote: null, clockOutNote: null });
    const e = punchMap.get(key)!;
    const note = (p as { note?: string | null }).note ?? null;
    if (p.punch_type === "clock_in" && !e.clockIn) {
      e.clockIn = p.recorded_at;
      if (note && !note.startsWith("管理者修正:")) e.clockInNote = note;
    }
    if (p.punch_type === "clock_out") {
      e.clockOut = p.recorded_at;
      if (note && !note.startsWith("管理者修正:")) e.clockOutNote = note;
    }
    // 管理者修正ノートを記録（"管理者修正:S001" 形式）
    if (note?.startsWith("管理者修正:")) e.modifiedBy = note.replace("管理者修正:", "");
  }

  const absenceMap = new Map((absences ?? []).map(a => [`${a.staff_id}_${a.absence_date}`, a.reason ?? ""]));
  const lateMap    = new Map((lates    ?? []).map(l => [`${l.staff_id}_${l.late_date}`,    l.reason ?? ""]));

  const breakOverrideMap = new Map(
    (breakOverrides ?? []).map(b => [`${b.staff_id}_${b.override_date}`, b.regular_minutes as number])
  );

  const confirmMap = new Map(
    (confirmations ?? []).map(c => [`${c.staff_id}_${c.work_date}`, c.confirmed_by as string])
  );

  const exceptionMap = new Map<string, { overtime: string | null; earlyLeave: string | null }>();
  for (const ex of approvedExceptions ?? []) {
    const key = `${ex.staff_id}_${ex.shift_date}`;
    if (!exceptionMap.has(key)) exceptionMap.set(key, { overtime: null, earlyLeave: null });
    const e = exceptionMap.get(key)!;
    if (ex.request_type === "overtime")    e.overtime   = (ex.signer_name as string | null) ?? null;
    if (ex.request_type === "early_leave") e.earlyLeave = (ex.signer_name as string | null) ?? null;
  }

  // ── 行データ構築 ──────────────────────────────────────────────
  const rows: AttendanceRow[] = [];

  for (const shift of shifts ?? []) {
    const shiftName = shift.shift_name ?? "";
    if (OFF_SHIFT_NAMES.includes(shiftName)) continue;
    const m = memberMap.get(shift.staff_id);
    if (!m) continue;

    const pattern  = patternMap.get(shiftName);
    const shiftStart = shift.shift_start ?? pattern?.start ?? null;
    const shiftEnd   = shift.shift_end   ?? pattern?.end   ?? null;

    const key     = `${shift.staff_id}_${shift.shift_date}`;
    const punch   = punchMap.get(key);
    const isAbsent = absenceMap.has(key);
    const isLate   = lateMap.has(key);

    let isEarlyLeave = false;
    if (punch?.clockOut && shiftEnd) {
      const endDt = new Date(`${shift.shift_date}T${shiftEnd.slice(0, 5)}:00+09:00`);
      const outDt = new Date(punch.clockOut);
      isEarlyLeave = outDt.getTime() < endDt.getTime() - 10 * 60000;
    }

    const confirmedBy = confirmMap.get(key) ?? null;
    const exception   = exceptionMap.get(key);
    const isOvertimeApproved = !!exception?.overtime;

    const breakMinutes = breakOverrideMap.get(key) ?? (punch?.clockIn ? 60 : 0);
    let workingMinutes = 0, regularMinutes = 0, overtimeMinutes = 0;
    if (punch?.clockIn && punch?.clockOut) {
      // 遅刻でなければ出勤 = シフト開始時刻、遅刻なら実打刻
      const effectiveInMs = (!isLate && shiftStart)
        ? new Date(`${shift.shift_date}T${shiftStart.slice(0, 5)}:00+09:00`).getTime()
        : new Date(punch.clockIn).getTime();

      // 残業or早退の申請あり → 実打刻、どちらも申請なし → シフト終了時刻
      const rawOutMs          = new Date(punch.clockOut).getTime();
      const shiftEndMs        = shiftEnd ? new Date(`${shift.shift_date}T${shiftEnd.slice(0, 5)}:00+09:00`).getTime() : rawOutMs;
      const isEarlyLeaveApproved = !!exception?.earlyLeave;
      const effectiveOutMs = (isOvertimeApproved || isEarlyLeaveApproved || !shiftEnd)
        ? rawOutMs
        : shiftEndMs;

      workingMinutes  = Math.max(0, Math.round((effectiveOutMs - effectiveInMs) / 60000) - breakMinutes);
      regularMinutes  = Math.min(workingMinutes, 480);
      overtimeMinutes = Math.max(0, workingMinutes - 480);
    }

    // 未来日（今日より後）の未打刻は「打刻漏れ」にしない＝まだ出勤していなくて当然
    const isFuture = shift.shift_date > today;

    let status: AttendanceRow["status"] = "ok";
    if (isAbsent)              status = "absent";
    else if (isFuture)         status = "ok";
    else if (!punch?.clockIn)  status = "no_clockin";
    else if (!punch?.clockOut) status = "no_clockout";
    else if (isLate)           status = "late";
    else if (isEarlyLeave)     status = "early";

    rows.push({
      date:              shift.shift_date,
      staffId:           shift.staff_id,
      name:              m.name,
      accountNumber:     m.accountNumber,
      section:           m.section,
      shiftName,
      shiftStart,
      shiftEnd,
      clockIn:           punch?.clockIn  ?? null,
      clockOut:          punch?.clockOut ?? null,
      breakMinutes,
      workingMinutes,
      regularMinutes,
      overtimeMinutes,
      isLate,
      lateReason:        lateMap.get(key) ?? null,
      isEarlyLeave,
      isAbsent,
      absenceReason:     absenceMap.get(key) ?? null,
      overtimeApprover:  exception?.overtime   ?? null,
      earlyLeaveApprover: exception?.earlyLeave ?? null,
      isConfirmed:       confirmedBy !== null,
      confirmedBy,
      modifiedBy:        punch?.modifiedBy
        ? (memberMap.get(punch.modifiedBy)?.name ?? punch.modifiedBy)
        : null,
      clockInNote:       punch?.clockInNote  ?? null,
      clockOutNote:      punch?.clockOutNote ?? null,
      status,
    });
  }

  // ── 全シフトマップ（公休・希望休含む、詳細カレンダー用） ─────────────────
  const allShiftMap: Record<string, string> = {};
  for (const s of shifts ?? []) {
    allShiftMap[`${s.staff_id}_${s.shift_date}`] = s.shift_name ?? "";
  }

  // ── 修正申請（CorrectionRow[]） ──────────────────────────────────────────
  const corrShiftMap = new Map<string, string>();
  for (const s of shifts ?? []) {
    corrShiftMap.set(`${s.staff_id}_${s.shift_date}`, s.shift_name ?? "");
  }

  // SV承認者マップ（staff_id_date → signer_name）
  const signerMap = new Map<string, string>();
  for (const e of rawExceptions ?? []) {
    const sn = (e as { signer_name?: string | null }).signer_name;
    if (sn) signerMap.set(`${e.staff_id}_${e.shift_date}`, sn as string);
  }

  const corrections: CorrectionRow[] = (rawCorrections ?? []).map(c => {
    const m = memberMap.get(c.staff_id as string);
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
      staff_name:    m?.name ?? c.staff_id,
      accountNumber: m?.accountNumber ?? null,
      shiftName:     corrShiftMap.get(`${c.staff_id}_${c.target_date}`) ?? null,
      svSigner:      signerMap.get(`${c.staff_id}_${c.target_date}`) ?? null,
    };
  });

  // ── 早退・残業申請（ExceptionRow[]） ─────────────────────────────────────
  const exceptions: ExceptionRow[] = (rawExceptions ?? []).map(e => {
    const m = memberMap.get(e.staff_id as string);
    return {
      id:           (e as { id?: string | null }).id ?? null,
      staff_id:     e.staff_id,
      shift_date:   e.shift_date,
      request_type: e.request_type as "early_leave" | "overtime",
      signer_name:  e.signer_name,
      status:       e.status,
      created_at:   e.created_at,
      staff_name:   m?.name ?? e.staff_id,
      accountNumber: m?.accountNumber ?? null,
    };
  });

  const staffs: StaffEntry[] = (staffMembers ?? []).map(m => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as {
      display_name?: string | null; name?: string | null;
      account_number?: string | null; company_name?: string | null;
    } | null;
    return {
      staffId:       m.staff_id,
      name:          s?.display_name ?? s?.name ?? m.staff_id,
      accountNumber: s?.account_number ?? null,
      company:       s?.company_name  ?? null,
      section:       m.section        ?? null,
    };
  });

  type TabKey = "corrections" | "requests" | "records" | "absentees";
  const resolvedTab: TabKey = (["corrections", "requests", "records", "absentees"] as string[]).includes(initialTab ?? "")
    ? (initialTab as TabKey)
    : "corrections";

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4 pb-24">
        <AttendanceEditClient
          projectId={projectId}
          rows={rows}
          corrections={corrections}
          exceptions={exceptions}
          currentMonth={currentMonth}
          todayMonth={today.slice(0, 7)}
          staffs={staffs}
          initialTab={resolvedTab}
          allShiftMap={allShiftMap}
          initialStaffId={initialStaffId ?? null}
        />
      </div>
    </main>
  );
}
