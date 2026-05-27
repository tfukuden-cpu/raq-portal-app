import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import SeatingPlanClient, { type PlanSeat, type PlanStaff } from "./SeatingPlanClient";

function tokyoToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T00:00:00+09:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

const OFF_NAMES = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤", "希望休"];

export default async function SeatingPlanPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const [{ data: myMembership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role").eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);
  const isAdmin =
    myMembership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";
  if (!isAdmin) redirect("/seating");

  const admin    = createAdminClient();
  const today    = tokyoToday();
  const tomorrow = addDays(today, 1);

  const [
    { data: seats },
    { data: assignments },
    { data: memberRows },
    { data: shifts },
  ] = await Promise.all([
    admin.from("seats")
      .select("id, label, x_pct, y_pct, section, seat_type, shift_slot")
      .eq("project_id", projectId).eq("is_active", true),
    admin.from("seat_assignments")
      .select("seat_id, staff_id")
      .eq("project_id", projectId).eq("assignment_date", tomorrow),
    admin.from("project_members")
      .select("staff_id, section, staffs(name, display_name, account_number)")
      .eq("project_id", projectId),
    admin.from("shifts")
      .select("staff_id, shift_name")
      .eq("project_id", projectId).eq("shift_date", tomorrow),
  ]);

  // メンバーマップ
  type MemberInfo = { name: string; accountNumber: string | null; section: string | null };
  const memberMap = new Map<string, MemberInfo>();
  for (const m of memberRows ?? []) {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { display_name?: string | null; name?: string | null; account_number?: string | null } | null;
    memberMap.set(m.staff_id, {
      name:          s?.display_name ?? s?.name ?? m.staff_id,
      accountNumber: (s?.account_number as string | null | undefined) ?? null,
      section:       m.section ?? null,
    });
  }

  // 翌日出勤予定スタッフ
  const assignMap    = new Map((assignments ?? []).map(a => [a.seat_id, a.staff_id]));
  // staffId → shiftName（早番/遅番判定用）
  const shiftNameMap = new Map(
    (shifts ?? []).map(s => [s.staff_id as string, s.shift_name as string | null])
  );
  const staffOnShift = new Set(
    (shifts ?? [])
      .filter(s => s.shift_name && !OFF_NAMES.includes(s.shift_name))
      .map(s => s.staff_id)
  );
  // シフトがない場合は全メンバー表示
  const targetStaffIds = staffOnShift.size > 0
    ? [...staffOnShift]
    : [...memberMap.keys()];

  const planSeats: PlanSeat[] = (seats ?? []).map(s => ({
    id:        s.id,
    label:     s.label,
    xPct:      s.x_pct,
    yPct:      s.y_pct,
    section:   s.section ?? null,
    seatType:  ((s as { seat_type?: string }).seat_type ?? "normal") as PlanSeat["seatType"],
    shiftSlot: (s as { shift_slot?: string | null }).shift_slot ?? null,
    staffId:   (s as { seat_type?: string }).seat_type === "disabled"
      ? null
      : (assignMap.get(s.id) ?? null),
  }));

  const planStaff: PlanStaff[] = targetStaffIds.map(id => {
    const m = memberMap.get(id);
    return {
      id,
      name:          m?.name          ?? id,
      accountNumber: m?.accountNumber ?? null,
      section:       m?.section       ?? null,
      shiftName:     shiftNameMap.get(id) ?? null,
    };
  });

  return (
    <SeatingPlanClient
      projectId={projectId}
      date={tomorrow}
      seats={planSeats}
      staff={planStaff}
    />
  );
}
