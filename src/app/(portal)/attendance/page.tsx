/**
 * 当日状況（案件管理者用）- データ取得のみ、UI は AttendanceClient へ委譲
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import AttendanceClient from "./AttendanceClient";
import type { StatusKey, MemberRow, ShiftGroup, SectionGroup, OffMember, ShiftChangeEntry } from "./AttendanceClient";

function tokyoToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

const SECTION_ORDER = ["SV", "査定", "販売", "MOTA", "ローン", "リメイク"];
const OFF_SHIFT_NAMES = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤"];
const STATUS_SORT: StatusKey[] = ["absent", "late", "working", "departed", "clocked_out", "not_departed"];

function resolveSection(shiftName: string, memberSection: string | null): string {
  for (const sec of SECTION_ORDER) {
    if (shiftName.startsWith(sec)) return sec;
  }
  return SECTION_ORDER.includes(memberSection ?? "") ? (memberSection as string) : "その他";
}

type InternalMember = MemberRow & {
  shiftName: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  absenceReportedAt: string | null;
  absenceNextDay: boolean | null;
  absenceDayAfter: boolean | null;
  lateReportedAt: string | null;
};

function buildGrouped(members: InternalMember[]): SectionGroup[] {
  const sections = [...SECTION_ORDER, "その他"];
  return sections
    .map(sec => {
      const secMembers = members.filter(m => m.section === sec);
      if (secMembers.length === 0) return null;

      // セクション内をシフト名でグループ化
      const shiftOrderMap = new Map<string, InternalMember[]>();
      const shiftOrder: string[] = [];
      for (const m of secMembers) {
        const key = m.shiftName || "その他";
        if (!shiftOrderMap.has(key)) { shiftOrderMap.set(key, []); shiftOrder.push(key); }
        shiftOrderMap.get(key)!.push(m);
      }
      // 各グループ内をステータス順にソート
      for (const [, list] of shiftOrderMap) {
        list.sort((a, b) => STATUS_SORT.indexOf(a.status) - STATUS_SORT.indexOf(b.status));
      }
      // グループ自体をシフト開始時刻順にソート
      shiftOrder.sort((a, b) => {
        const ta = shiftOrderMap.get(a)![0].shiftStart ?? "99:99";
        const tb = shiftOrderMap.get(b)![0].shiftStart ?? "99:99";
        return ta.localeCompare(tb);
      });

      const shiftGroups: ShiftGroup[] = shiftOrder.map(name => ({
        shiftName:  name,
        shiftStart: shiftOrderMap.get(name)![0].shiftStart,
        shiftEnd:   shiftOrderMap.get(name)![0].shiftEnd,
        members:    shiftOrderMap.get(name)!.map(m => ({
          staffId:           m.staffId,
          name:              m.name,
          accountNumber:     m.accountNumber,
          section:           m.section,
          status:            m.status,
          clockIn:           m.clockIn,
          clockOut:          m.clockOut,
          departureTime:     m.departureTime,
          etaMinutes:        m.etaMinutes,
          absenceReason:     m.absenceReason,
          absenceReportedAt: m.absenceReportedAt,
          absenceNextDay:    m.absenceNextDay,
          absenceDayAfter:   m.absenceDayAfter,
          lateReason:        m.lateReason,
          lateReportedAt:    m.lateReportedAt,
          expectedArrival:   m.expectedArrival,
        })),
      }));

      return { section: sec, shiftGroups };
    })
    .filter((g): g is SectionGroup => g !== null);
}

export default async function AttendancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const [{ data: myMembership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);

  const isAuthorized =
    myMembership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";
  if (!isAuthorized) redirect("/dashboard");

  const admin = createAdminClient();
  const today = tokyoToday();
  const todayStart = `${today}T00:00:00+09:00`;
  const todayEnd   = `${today}T23:59:59+09:00`;

  const currentMonth = today.slice(0, 7); // YYYY-MM

  const [
    { data: project },
    { data: memberRows },
    { data: todayShifts },
    { data: punchLogs },
    { data: departureRows },
    { data: absenceRows },
    { data: lateRows },
    { data: shiftPatterns },
    { data: projectSettings },
    { data: monthStatus },
  ] = await Promise.all([
    admin.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
    admin.from("project_members")
      .select("staff_id, section, staffs(id, name, display_name, account_number)")
      .eq("project_id", projectId),
    admin.from("shifts")
      .select("staff_id, shift_name, shift_start, shift_end")
      .eq("project_id", projectId)
      .eq("shift_date", today),
    admin.from("punch_logs")
      .select("staff_id, punch_type, recorded_at")
      .eq("project_id", projectId)
      .gte("recorded_at", todayStart)
      .lte("recorded_at", todayEnd)
      .order("recorded_at"),
    admin.from("departure_reports")
      .select("staff_id, reported_at, eta_minutes")
      .eq("project_id", projectId)
      .gte("reported_at", todayStart)
      .lte("reported_at", todayEnd),
    admin.from("absence_reports")
      .select("staff_id, reason, created_at, next_day_available, day_after_available, status")
      .eq("project_id", projectId)
      .eq("absence_date", today),
    admin.from("late_reports")
      .select("staff_id, reason, expected_arrival, created_at, status")
      .eq("project_id", projectId)
      .eq("late_date", today),
    admin.from("shift_patterns")
      .select("name, start_time, end_time")
      .eq("project_id", projectId),
    admin.from("project_settings")
      .select("enable_departure_report")
      .eq("project_id", projectId)
      .maybeSingle(),
    admin.from("shift_month_status")
      .select("published_at")
      .eq("project_id", projectId)
      .eq("year_month", currentMonth)
      .maybeSingle(),
  ]);

  // シフトパターンの時刻マップ
  const patternTimeMap = new Map<string, { start: string; end: string }>(
    (shiftPatterns ?? [])
      .filter(p => p.start_time && p.end_time)
      .map(p => [p.name as string, { start: p.start_time as string, end: p.end_time as string }])
  );

  const enableDeparture = (projectSettings as { enable_departure_report?: boolean | null } | null)?.enable_departure_report ?? true;

  // メンバーマップ
  type MemberInfo = { name: string; section: string | null; accountNumber: string | null };
  const memberMap = new Map<string, MemberInfo>();
  for (const m of memberRows ?? []) {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as {
      display_name?: string | null; name?: string | null; account_number?: string | null;
    } | null;
    memberMap.set(m.staff_id, {
      name:          s?.display_name ?? s?.name ?? m.staff_id,
      section:       m.section ?? null,
      accountNumber: (s?.account_number as string | null | undefined) ?? null,
    });
  }

  // 展開後変更ログ
  const publishedAt = (monthStatus as { published_at: string | null } | null)?.published_at ?? null;
  let shiftChanges: ShiftChangeEntry[] = [];
  if (publishedAt) {
    const { data: changeLogs } = await admin
      .from("shift_change_logs")
      .select("staff_id, action, before_data, after_data, changed_by, changed_at")
      .eq("project_id", projectId)
      .eq("shift_date", today)
      .gt("changed_at", publishedAt)
      .order("changed_at");

    // changed_by の名前を取得
    const changedByIds = [...new Set((changeLogs ?? []).map(l => l.changed_by as string).filter(Boolean))];
    const { data: changedByStaffs } = changedByIds.length > 0
      ? await admin.from("staffs").select("id, display_name, name").in("id", changedByIds)
      : { data: [] };
    const changedByNameMap = new Map(
      (changedByStaffs ?? []).map(s => [s.id as string, ((s.display_name ?? s.name ?? s.id) as string)])
    );

    shiftChanges = (changeLogs ?? []).map(l => ({
      staffId:       l.staff_id as string,
      staffName:     memberMap.get(l.staff_id as string)?.name ?? (l.staff_id as string),
      action:        l.action as string,
      beforeShift:   ((l.before_data as Record<string, string | null> | null)?.shift_name) ?? null,
      afterShift:    ((l.after_data  as Record<string, string | null> | null)?.shift_name) ?? null,
      changedBy:     l.changed_by as string,
      changedByName: changedByNameMap.get(l.changed_by as string) ?? (l.changed_by as string),
      changedAt:     l.changed_at as string,
    }));
  }

  // 打刻マップ
  const punchMap = new Map<string, { clockIn: string | null; clockOut: string | null }>();
  for (const p of punchLogs ?? []) {
    if (!punchMap.has(p.staff_id)) punchMap.set(p.staff_id, { clockIn: null, clockOut: null });
    const e = punchMap.get(p.staff_id)!;
    if (p.punch_type === "clock_in"  && !e.clockIn)  e.clockIn  = p.recorded_at;
    if (p.punch_type === "clock_out")                 e.clockOut = p.recorded_at;
  }

  const departureMap = new Map(
    (departureRows ?? []).map(d => [d.staff_id, { reportedAt: d.reported_at, etaMinutes: d.eta_minutes as number | null }])
  );
  const absenceMap = new Map(
    (absenceRows ?? []).map(a => [a.staff_id, {
      reason:      a.reason as string | null,
      reportedAt:  a.created_at as string | null,
      nextDay:     (a as { next_day_available?: boolean | null }).next_day_available ?? null,
      dayAfter:    (a as { day_after_available?: boolean | null }).day_after_available ?? null,
      absStatus:   a.status as string | null,
    }])
  );
  const lateMap = new Map(
    (lateRows ?? []).map(l => [l.staff_id, {
      reason:          l.reason as string | null,
      expectedArrival: l.expected_arrival as string | null,
      reportedAt:      (l as { created_at?: string | null }).created_at ?? null,
    }])
  );

  // 出勤予定 / 本日休み に振り分け
  const allInternal: InternalMember[] = [];
  const offMembers: OffMember[] = [];

  for (const shift of todayShifts ?? []) {
    const member = memberMap.get(shift.staff_id);
    if (!member) continue;
    const shiftName = shift.shift_name ?? "";

    if (OFF_SHIFT_NAMES.includes(shiftName)) {
      offMembers.push({
        staffId:       shift.staff_id,
        name:          member.name,
        accountNumber: member.accountNumber,
        shiftName,
      });
      continue;
    }

    const punch     = punchMap.get(shift.staff_id) ?? null;
    const departure = departureMap.get(shift.staff_id) ?? null;
    const absence   = absenceMap.get(shift.staff_id) ?? null;
    const late      = lateMap.get(shift.staff_id) ?? null;

    let status: StatusKey;
    if (absence)              status = "absent";
    else if (punch?.clockOut) status = "clocked_out";
    else if (punch?.clockIn)  status = "working";
    else if (late)            status = "late";
    else if (departure)       status = "departed";
    else                      status = "not_departed";

    const pattern = patternTimeMap.get(shiftName);
    allInternal.push({
      staffId:        shift.staff_id,
      name:           member.name,
      accountNumber:  member.accountNumber,
      section:        resolveSection(shiftName, member.section),
      status,
      clockIn:        punch?.clockIn  ?? null,
      clockOut:       punch?.clockOut ?? null,
      departureTime:  departure?.reportedAt  ?? null,
      etaMinutes:     departure?.etaMinutes  ?? null,
      absenceReason:     absence?.reason           ?? null,
      absenceReportedAt: absence?.reportedAt        ?? null,
      absenceNextDay:    absence?.nextDay            ?? null,
      absenceDayAfter:   absence?.dayAfter           ?? null,
      lateReason:        late?.reason               ?? null,
      expectedArrival:   late?.expectedArrival      ?? null,
      lateReportedAt:    late?.reportedAt            ?? null,
      shiftName,
      shiftStart:     shift.shift_start ?? pattern?.start ?? null,
      shiftEnd:       shift.shift_end   ?? pattern?.end   ?? null,
    });
  }

  const grouped = buildGrouped(allInternal);

  // ── 全体サマリー ─────────────────────────────────────────
  const total      = allInternal.length;
  const departed   = allInternal.filter(m => m.departureTime || m.clockIn).length;
  const clockedIn  = allInternal.filter(m => m.clockIn).length;
  const late       = allInternal.filter(m => m.status === "late").length;
  const absent     = allInternal.filter(m => m.status === "absent").length;
  const notClocked = total - clockedIn - absent;

  // 日付ラベル
  const [, monthStr, dayStr] = today.split("-");
  const noonJST = new Date(`${today}T12:00:00+09:00`);
  const weekday = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", weekday: "narrow" }).format(noonJST);
  const dateLabel = `${parseInt(monthStr)}月${parseInt(dayStr)}日（${weekday}）`;

  return (
    <AttendanceClient
      projectId={projectId}
      today={today}
      dateLabel={dateLabel}
      projectName={project?.name ?? ""}
      total={total}
      departed={departed}
      clockedIn={clockedIn}
      late={late}
      absent={absent}
      notClocked={notClocked}
      grouped={grouped}
      offMembers={offMembers}
      enableDeparture={enableDeparture}
      publishedAt={publishedAt}
      shiftChanges={shiftChanges}
      myStaffId={staffId}
    />
  );
}
