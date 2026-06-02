import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import SeatingClient, { type SeatData, type WallData, type StaffInfo } from "./SeatingClient";
import { getBreakSlotAssignmentsAction } from "./break-actions";

function tokyoToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export default async function SeatingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const admin  = createAdminClient();
  const today  = tokyoToday();
  const start  = `${today}T00:00:00+09:00`;
  const end    = `${today}T23:59:59+09:00`;

  const [
    { data: seats },
    { data: assignments },
    { data: memberRows },
    { data: punchLogs },
    { data: absenceRows },
    { data: shiftRows },
    { data: wallRows },
    breakAssignmentRows,
  ] = await Promise.all([
    admin.from("seats")
      .select("id, label, x_pct, y_pct, section, seat_type, shift_slot")
      .eq("project_id", projectId).eq("is_active", true),
    admin.from("seat_assignments")
      .select("seat_id, staff_id")
      .eq("project_id", projectId).eq("assignment_date", today),
    admin.from("project_members")
      .select("staff_id, section, staffs(name, display_name, account_number)")
      .eq("project_id", projectId),
    admin.from("punch_logs")
      .select("staff_id, punch_type, recorded_at")
      .eq("project_id", projectId)
      .gte("recorded_at", start).lte("recorded_at", end)
      .order("recorded_at"),
    admin.from("absence_reports")
      .select("staff_id")
      .eq("project_id", projectId).eq("absence_date", today),
    // 当日シフト（早番/遅番・開始終了時刻）
    admin.from("shifts")
      .select("staff_id, shift_name, shift_start, shift_end")
      .eq("project_id", projectId).eq("shift_date", today),
    admin.from("seat_walls")
      .select("x1_pct, y1_pct, x2_pct, y2_pct")
      .eq("project_id", projectId),
    getBreakSlotAssignmentsAction(projectId, today),
  ]);

  // メンバーマップ
  const memberMap = new Map<string, { name: string; accountNumber: string | null }>();
  for (const m of memberRows ?? []) {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { display_name?: string | null; name?: string | null; account_number?: string | null } | null;
    memberMap.set(m.staff_id, {
      name:          s?.display_name ?? s?.name ?? m.staff_id,
      accountNumber: (s?.account_number as string | null | undefined) ?? null,
    });
  }

  // ステータス計算
  type StaffStatus = SeatData["status"];
  const absenceIds     = new Set((absenceRows ?? []).map(a => a.staff_id));
  const latestPunch    = new Map<string, string>();
  const latestBreak    = new Map<string, string>();
  const latestSeatMove = new Map<string, string>();
  const breakStartTimeMap = new Map<string, string>();   // staffId → ISO
  const seatLeaveTimeMap  = new Map<string, string>();   // staffId → ISO
  for (const p of punchLogs ?? []) {
    const t = p.punch_type as string;
    if (t === "clock_in" || t === "clock_out") latestPunch.set(p.staff_id, t);
    if (t === "break_start") { latestBreak.set(p.staff_id, t); breakStartTimeMap.set(p.staff_id, p.recorded_at as string); }
    if (t === "break_end")   { latestBreak.set(p.staff_id, t); breakStartTimeMap.delete(p.staff_id); }
    if (t === "seat_leave")  { latestSeatMove.set(p.staff_id, t); seatLeaveTimeMap.set(p.staff_id, p.recorded_at as string); }
    if (t === "seat_return") { latestSeatMove.set(p.staff_id, t); seatLeaveTimeMap.delete(p.staff_id); }
  }
  function deriveStatus(staffId: string): NonNullable<StaffStatus> {
    if (absenceIds.has(staffId)) return "absent";
    const punch = latestPunch.get(staffId);
    const brk   = latestBreak.get(staffId);
    const seat  = latestSeatMove.get(staffId);
    if (punch === "clock_out") return "clocked_out";
    if (punch === "clock_in") {
      if (brk  === "break_start") return "on_break";
      if (seat === "seat_leave")  return "seat_leave";
      return "working";
    }
    return "not_arrived";
  }

  // 割当マップ / シフト名マップ（早番/遅番判定用）
  const assignMap   = new Map((assignments ?? []).map(a => [a.seat_id, a.staff_id]));
  const shiftNameMap = new Map((shiftRows ?? []).map(r => [r.staff_id as string, r.shift_name as string | null]));
  const shiftTimeMap: Record<string, { start: string | null; end: string | null }> = {};
  for (const r of shiftRows ?? []) {
    shiftTimeMap[r.staff_id as string] = {
      start: (r as { shift_start?: string | null }).shift_start ?? null,
      end:   (r as { shift_end?:   string | null }).shift_end   ?? null,
    };
  }

  const seatData: SeatData[] = (seats ?? []).map(s => {
    const seatType = (s as { seat_type?: string }).seat_type ?? "normal";
    // 無効席はスタッフ割当を表示しない
    const staffId = seatType === "disabled" ? null : (assignMap.get(s.id) ?? null);
    const member  = staffId ? memberMap.get(staffId) : null;
    return {
      id:            s.id,
      label:         s.label,
      xPct:          s.x_pct,
      yPct:          s.y_pct,
      section:       s.section ?? null,
      seatType:      seatType as SeatData["seatType"],
      shiftSlot:     (s as { shift_slot?: string | null }).shift_slot ?? null,
      staffId,
      staffName:     member?.name ?? null,
      accountNumber: member?.accountNumber ?? null,
      shiftName:      staffId ? (shiftNameMap.get(staffId) ?? null) : null,
      status:         staffId ? deriveStatus(staffId) : null,
      breakStartTime: staffId ? (breakStartTimeMap.get(staffId) ?? null) : null,
      seatLeaveTime:  staffId ? (seatLeaveTimeMap.get(staffId)  ?? null) : null,
    };
  });

  const wallData: WallData[] = (wallRows ?? []).map(w => ({
    x1Pct: w.x1_pct as number,
    y1Pct: w.y1_pct as number,
    x2Pct: w.x2_pct as number,
    y2Pct: w.y2_pct as number,
  }));

  // 席替えモード用：当日シフトあり（公休除く）のスタッフ一覧
  const OFF_NAMES_SEATING = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤", "希望休"];
  const todayShiftStaffIds = new Set(
    (shiftRows ?? [])
      .filter(r => r.shift_name && !OFF_NAMES_SEATING.includes(r.shift_name as string))
      .map(r => r.staff_id as string)
  );
  const staffList: StaffInfo[] = (memberRows ?? [])
    .filter(m => todayShiftStaffIds.size === 0 || todayShiftStaffIds.has(m.staff_id))
    .map(m => {
      const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
        { display_name?: string | null; name?: string | null; account_number?: string | null } | null;
      return {
        id:            m.staff_id,
        name:          s?.display_name ?? s?.name ?? m.staff_id,
        accountNumber: (s?.account_number as string | null | undefined) ?? null,
        section:       (m as { section?: string | null }).section ?? null,
        shiftName:     shiftNameMap.get(m.staff_id) ?? null,
      };
    });

  // 休憩スロット割り当てマップ（staffId → slotNumber）
  const breakAssignmentMap: Record<string, number> = {};
  for (const a of breakAssignmentRows) {
    breakAssignmentMap[a.staff_id] = a.slot_number;
  }

  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const [{ data: myMembership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role").eq("staff_id", myStaffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", myStaffId).maybeSingle(),
  ]);
  const isAdmin =
    myMembership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";

  return (
    <SeatingClient
      projectId={projectId}
      today={today}
      seats={seatData}
      walls={wallData}
      isAdmin={isAdmin}
      myStaffId={myStaffId}
      staffList={staffList}
      breakAssignmentMap={breakAssignmentMap}
      shiftTimeMap={shiftTimeMap}
    />
  );
}
