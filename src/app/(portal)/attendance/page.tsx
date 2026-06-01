/**
 * 当日状況（案件管理者用）- データ取得のみ、UI は AttendanceClient へ委譲
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import AttendanceClient from "./AttendanceClient";
import type { StatusKey, MemberRow, ShiftGroup, SectionGroup, OffMember, ShiftChangeEntry, ChurnRiskAlert } from "./AttendanceClient";
import type { SeatData, WallData, StaffInfo } from "../seating/SeatingClient";
import type { MotaRow } from "./HMotaPanel";
import type { MotaAssignment } from "./mota-actions";
import {
  getBreakSlotSettingsAction,
  getBreakSlotAssignmentsAction,
  getBreakShortSettingsAction,
} from "@/app/(portal)/seating/break-actions";
import type { BreakRecord } from "@/app/(portal)/seating/break-actions";

function tokyoToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

// 優先順位付きの固定セクション順（これ以外のセクションはこの後ろに追加される）
const BASE_SECTION_ORDER = ["SV", "査定", "販売", "MOTA", "H MOTA", "未アポ", "インフォ", "ローン"];
const HIDDEN_SECTIONS = ["リメイク"]; // カラムとして表示しないセクション（その他に合流）
const OFF_SHIFT_NAMES = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤", "希望休"];
const STATUS_SORT: StatusKey[] = ["absent", "late", "working", "departed", "clocked_out", "not_departed"];

function resolveSection(shiftName: string, memberSection: string | null, sectionOrder: string[]): string {
  if (shiftName.includes("研修")) return "その他";
  if (HIDDEN_SECTIONS.includes(memberSection ?? "")) return "その他";
  for (const sec of sectionOrder) {
    if (sec === "その他") continue;
    if (shiftName.startsWith(sec)) return sec;
  }
  return sectionOrder.includes(memberSection ?? "") ? (memberSection as string) : "その他";
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

function buildGrouped(members: InternalMember[], sectionOrder: string[]): SectionGroup[] {
  return sectionOrder.map(sec => {
    const secMembers = members.filter(m => m.section === sec);

    // スタッフ0のセクションも「空の箱」として返す
    if (secMembers.length === 0) return { section: sec, shiftGroups: [] };

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
  });
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
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
  const realToday = tokyoToday();

  // 日付パラメータ（未指定なら当日）
  const params = await searchParams;
  const today = (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date))
    ? params.date
    : realToday;

  const prevDate = (() => {
    const d = new Date(today + "T00:00:00+09:00");
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  })();
  const tomorrow = (() => {
    const d = new Date(today + "T00:00:00+09:00");
    d.setDate(d.getDate() + 1);
    return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  })();
  const todayStart = `${today}T00:00:00+09:00`;
  const todayEnd   = `${today}T23:59:59+09:00`;

  const currentMonth = today.slice(0, 7); // YYYY-MM

  const last14Start = (() => {
    const d = new Date(realToday + "T00:00:00+09:00");
    d.setDate(d.getDate() - 13);
    return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  })();

  const [
    { data: project },
    { data: memberRows },
    { data: allShiftRows },
    { data: punchLogs },
    { data: departureRows },
    { data: absenceRows },
    { data: lateRows },
    { data: shiftPatterns },
    { data: projectSettings },
    { data: monthStatus },
    { data: seatRows },
    { data: allAssignmentRows },
    { data: wallRows },
    { data: recentAbsencesRaw },
    { data: motaAssignmentRows },
    breakSlots,
    breakAssignments,
    breakShortSettings,
  ] = await Promise.all([
    admin.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
    admin.from("project_members")
      .select("staff_id, section, churn_risk, staffs(id, name, display_name, account_number)")
      .eq("project_id", projectId),
    admin.from("shifts")
      .select("staff_id, shift_name, shift_start, shift_end, shift_date")
      .eq("project_id", projectId)
      .in("shift_date", [today, tomorrow]),
    admin.from("punch_logs")
      .select("staff_id, punch_type, recorded_at, note")
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
      .select("name, start_time, end_time, section")
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
    admin.from("seats")
      .select("id, label, x_pct, y_pct, section, seat_type, shift_slot")
      .eq("project_id", projectId).eq("is_active", true),
    admin.from("seat_assignments")
      .select("seat_id, staff_id, assignment_date")
      .eq("project_id", projectId)
      .in("assignment_date", [today, tomorrow]),
    admin.from("seat_walls")
      .select("x1_pct, y1_pct, x2_pct, y2_pct")
      .eq("project_id", projectId),
    admin.from("absence_reports")
      .select("staff_id, absence_date")
      .eq("project_id", projectId)
      .gte("absence_date", last14Start)
      .lte("absence_date", realToday),
    admin.from("mota_slot_assignments")
      .select("id, account_number, slot, is_fixed, staff_name, assigned_account")
      .eq("project_id", projectId)
      .eq("assignment_date", today),
    getBreakSlotSettingsAction(projectId),
    getBreakSlotAssignmentsAction(projectId, today),
    getBreakShortSettingsAction(projectId, today),
  ]);

  // 今日・明日でデータを分割
  const todayShifts = (allShiftRows ?? []).filter(r => r.shift_date === today);
  const tomorrowShiftRows = (allShiftRows ?? []).filter(r => r.shift_date === tomorrow);
  const assignmentRows = (allAssignmentRows ?? []).filter(a => a.assignment_date === today);
  const tomorrowAssignmentRows = (allAssignmentRows ?? []).filter(a => a.assignment_date === tomorrow);

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

  // project_members.section と shift_patterns.section を合わせてセクション順を構築
  const allMemberSections = [...new Set(
    (memberRows ?? [])
      .map(m => (m.section as string | null) ?? null)
      .filter((s): s is string => !!s)
  )];
  const patternSections = [...new Set(
    (shiftPatterns ?? [])
      .map(p => (p as { section?: string | null }).section as string | null)
      .filter((s): s is string => !!s)
  )];
  const allSections = [...new Set([...allMemberSections, ...patternSections])];
  const sectionOrderFull: string[] = [
    ...BASE_SECTION_ORDER.filter(s => allSections.includes(s)),
    ...allSections.filter(s => !BASE_SECTION_ORDER.includes(s) && s !== "その他" && !HIDDEN_SECTIONS.includes(s)),
    "その他",
  ];

  // 離脱リスクフラグ付きスタッフIDセット
  const churnRiskStaffIds = new Set(
    (memberRows ?? [])
      .filter(m => (m as { churn_risk?: boolean }).churn_risk === true)
      .map(m => m.staff_id)
  );

  // 連続欠勤3日以上の検知（過去14日間）
  const absencesByStaff = new Map<string, string[]>();
  for (const a of recentAbsencesRaw ?? []) {
    if (!absencesByStaff.has(a.staff_id)) absencesByStaff.set(a.staff_id, []);
    absencesByStaff.get(a.staff_id)!.push(a.absence_date as string);
  }

  const churnRiskAlerts: ChurnRiskAlert[] = [];
  for (const [staffId, dates] of absencesByStaff) {
    const sorted = [...dates].sort().reverse(); // 新しい日付順
    let streak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1] + "T12:00:00+09:00").getTime();
      const curr = new Date(sorted[i]     + "T12:00:00+09:00").getTime();
      if (prev - curr === 24 * 60 * 60 * 1000) { streak++; } else { break; }
    }
    if (streak >= 3) {
      churnRiskAlerts.push({
        staffId,
        staffName: memberMap.get(staffId)?.name ?? staffId,
        consecutiveDays: streak,
      });
    }
  }
  churnRiskAlerts.sort((a, b) => b.consecutiveDays - a.consecutiveDays);

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
      accountNumber: memberMap.get(l.staff_id as string)?.accountNumber ?? null,
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
      section:        resolveSection(shiftName, member.section, sectionOrderFull),
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
      churnRisk:         churnRiskStaffIds.has(shift.staff_id),
      shiftName,
      shiftStart:     shift.shift_start ?? pattern?.start ?? null,
      shiftEnd:       shift.shift_end   ?? pattern?.end   ?? null,
    });
  }

  const grouped = buildGrouped(allInternal, sectionOrderFull);

  // ── H MOTA スロット配置 ────────────────────────────────────
  const FIXED_MOTA_NUMBERS = [
    "ASS 130", "ASS 131", "ASS 132", "ASS 133", "ASS 134",
    "ASS 196", "ASS 197", "ASS 198", "ASS 199", "ASS 200",
  ];

  const todayShiftIds = new Set(
    (todayShifts ?? [])
      .filter(s => !OFF_SHIFT_NAMES.includes((s.shift_name ?? "") as string))
      .map(s => s.staff_id),
  );

  const hMotaRows: MotaRow[] = [
    ...(memberRows ?? [])
      .filter(m => {
        const sec = (m.section as string | null) ?? "";
        return (sec === "MOTA" || sec === "H MOTA") && !todayShiftIds.has(m.staff_id);
      })
      .map(m => {
        const info = memberMap.get(m.staff_id);
        return info?.accountNumber
          ? { accountNumber: info.accountNumber, name: info.name, isFixed: false }
          : null;
      })
      .filter((r): r is MotaRow => r !== null),
    ...FIXED_MOTA_NUMBERS.map(n => ({ accountNumber: n, name: n, isFixed: true })),
  ];

  const initialMotaAssignments: MotaAssignment[] = (motaAssignmentRows ?? []).map(r => ({
    id: r.id as string,
    accountNumber: r.account_number as string,
    staffName: (r as { staff_name?: string }).staff_name ?? "",
    assignedAccount: (r as { assigned_account?: string | null }).assigned_account ?? null,
    slot: r.slot as string,
    isFixed: (r.is_fixed as boolean) ?? false,
  }));

  // 配置スタッフのアカウント番号 → スロット（座席表用）
  const motaAccountSlotMap = new Map<string, string[]>();
  for (const a of initialMotaAssignments) {
    const key = a.assignedAccount;
    if (!key) continue;
    if (!motaAccountSlotMap.has(key)) motaAccountSlotMap.set(key, []);
    motaAccountSlotMap.get(key)!.push(a.slot);
  }

  // ── 座席データ ─────────────────────────────────────────
  const seatAssignMap = new Map((assignmentRows ?? []).map(a => [a.seat_id, a.staff_id]));
  const seatShiftMap  = new Map((todayShifts ?? []).map(s => [s.staff_id, s.shift_name as string | null]));

  // 打刻ステータス計算（座席用）
  const seatAbsenceIds = new Set((absenceRows ?? []).map(a => a.staff_id));
  const seatLatestPunch = new Map<string, string>();
  const seatLatestBreak = new Map<string, string>();
  for (const p of punchLogs ?? []) {
    if (p.punch_type === "clock_in" || p.punch_type === "clock_out") seatLatestPunch.set(p.staff_id, p.punch_type);
    if (p.punch_type === "break_start" || p.punch_type === "break_end") seatLatestBreak.set(p.staff_id, p.punch_type);
  }
  function deriveSeatStatus(sId: string): NonNullable<SeatData["status"]> {
    if (seatAbsenceIds.has(sId)) return "absent";
    const punch = seatLatestPunch.get(sId);
    const brk   = seatLatestBreak.get(sId);
    if (punch === "clock_out") return "clocked_out";
    if (punch === "clock_in")  return brk === "break_start" ? "on_break" : "working";
    return "not_arrived";
  }

  const seatData: SeatData[] = (seatRows ?? []).map(s => {
    const seatType = (s as { seat_type?: string }).seat_type ?? "normal";
    const sId  = seatType === "disabled" ? null : (seatAssignMap.get(s.id) ?? null);
    const mInfo = sId ? memberMap.get(sId) : null;
    const motaSlots = mInfo?.accountNumber ? motaAccountSlotMap.get(mInfo.accountNumber) : undefined;
    return {
      id:            s.id,
      label:         s.label,
      xPct:          s.x_pct,
      yPct:          s.y_pct,
      section:       s.section ?? null,
      seatType:      seatType as SeatData["seatType"],
      shiftSlot:     (s as { shift_slot?: string | null }).shift_slot ?? null,
      staffId:       sId,
      staffName:     mInfo?.name ?? null,
      accountNumber: mInfo?.accountNumber ?? null,
      shiftName:     sId ? (seatShiftMap.get(sId) ?? null) : null,
      status:        sId ? deriveSeatStatus(sId) : null,
      motaSlot:      motaSlots ? motaSlots.join(" / ") : null,
    };
  });

  const wallData: WallData[] = (wallRows ?? []).map(w => ({
    x1Pct: w.x1_pct as number, y1Pct: w.y1_pct as number,
    x2Pct: w.x2_pct as number, y2Pct: w.y2_pct as number,
  }));

  const OFF_NAMES_SEAT = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤", "希望休"];
  const todayShiftStaffIds = new Set(
    (todayShifts ?? [])
      .filter(r => r.shift_name && !OFF_NAMES_SEAT.includes(r.shift_name as string))
      .map(r => r.staff_id)
  );
  const seatStaffList: StaffInfo[] = (memberRows ?? [])
    .filter(m => todayShiftStaffIds.size === 0 || todayShiftStaffIds.has(m.staff_id))
    .map(m => {
      const info = memberMap.get(m.staff_id);
      return {
        id:            m.staff_id,
        name:          info?.name ?? m.staff_id,
        accountNumber: info?.accountNumber ?? null,
        section:       info?.section ?? null,
        shiftName:     seatShiftMap.get(m.staff_id) ?? null,
      };
    });

  // ── 休憩実績（break_start/end ペア）────────────────────
  const breakRecordMap = new Map<string, { started_at: string; break_type: string | null; ended_at: string | null }[]>();
  for (const p of punchLogs ?? []) {
    const note = (p as { note?: string | null }).note ?? null;
    if (p.punch_type === "break_start") {
      if (!breakRecordMap.has(p.staff_id)) breakRecordMap.set(p.staff_id, []);
      breakRecordMap.get(p.staff_id)!.push({ started_at: p.recorded_at, break_type: note, ended_at: null });
    } else if (p.punch_type === "break_end") {
      const list = breakRecordMap.get(p.staff_id);
      if (list && list.length > 0) {
        const last = list[list.length - 1];
        if (last.ended_at === null) last.ended_at = p.recorded_at;
      }
    }
  }
  const breakRecords: BreakRecord[] = [];
  for (const [staffId, records] of breakRecordMap) {
    for (const r of records) {
      breakRecords.push({ staff_id: staffId, break_type: r.break_type, started_at: r.started_at, ended_at: r.ended_at });
    }
  }

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
      key={today}
      projectId={projectId}
      today={today}
      prevDate={prevDate}
      nextDate={tomorrow}
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
      churnRiskAlerts={churnRiskAlerts}
      seatData={seatData}
      wallData={wallData}
      seatStaffList={seatStaffList}
      hMotaRows={hMotaRows}
      initialMotaAssignments={initialMotaAssignments}
      breakSlots={breakSlots}
      breakAssignments={breakAssignments}
      breakShortSettings={breakShortSettings}
      breakRecords={breakRecords}
    />
  );
}
