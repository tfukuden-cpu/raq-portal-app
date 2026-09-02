import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import SeatingPlanClient, { type PlanSeat, type PlanStaff, type WallData } from "./SeatingPlanClient";

function tokyoToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

const OFF_NAMES = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤", "希望休", "公募"];

export default async function SeatingPlanPage(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/login");

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

  const { date: dateParam } = await props.searchParams;
  const admin  = createAdminClient();
  const today  = tokyoToday();
  const target = dateParam ?? today;

  const [
    { data: seats },
    { data: assignments },
    { data: memberRows },
    { data: shifts },
    { data: wallRows },
  ] = await Promise.all([
    admin.from("seats")
      .select("id, label, x_pct, y_pct, section, seat_type, shift_slot")
      .eq("project_id", projectId).eq("is_active", true),
    admin.from("seat_assignments")
      .select("seat_id, staff_id")
      .eq("project_id", projectId).eq("assignment_date", target),
    admin.from("project_members")
      .select("staff_id, section, staffs(name, display_name, account_number)")
      .eq("project_id", projectId),
    admin.from("shifts")
      .select("staff_id, shift_name")
      .eq("project_id", projectId).eq("shift_date", target),
    admin.from("seat_walls")
      .select("x1_pct, y1_pct, x2_pct, y2_pct")
      .eq("project_id", projectId),
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

  const assignMap    = new Map((assignments ?? []).map(a => [a.seat_id, a.staff_id]));
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

  const wallData: WallData[] = (wallRows ?? []).map(w => ({
    x1Pct: w.x1_pct as number,
    y1Pct: w.y1_pct as number,
    x2Pct: w.x2_pct as number,
    y2Pct: w.y2_pct as number,
  }));

  return (
    <SeatingPlanClient
      projectId={projectId}
      date={target}
      today={today}
      seats={planSeats}
      staff={planStaff}
      walls={wallData}
    />
  );
}
