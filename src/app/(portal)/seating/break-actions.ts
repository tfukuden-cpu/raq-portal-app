"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type BreakSlotSetting = {
  id: string;
  slot_number: number;
  label: string;
  start_time: string;
  end_time: string;
  target_shift: "early" | "late" | "both";
  ratio: number;
  sort_order: number;
};

export type BreakSlotAssignment = {
  staff_id: string;
  slot_number: number;
};

const DEFAULT_SLOTS: Omit<BreakSlotSetting, "id">[] = [
  { slot_number: 1, label: "①", start_time: "12:00", end_time: "13:00", target_shift: "early", ratio: 20, sort_order: 0 },
  { slot_number: 2, label: "②", start_time: "13:15", end_time: "14:15", target_shift: "both",  ratio: 40, sort_order: 1 },
  { slot_number: 3, label: "③", start_time: "14:30", end_time: "15:30", target_shift: "late",  ratio: 40, sort_order: 2 },
];

const SLOT_COLORS: Record<number, { bg: string; text: string; border: string }> = {
  1: { bg: "bg-blue-100 dark:bg-blue-900/50",   text: "text-blue-700 dark:text-blue-300",   border: "border-blue-300 dark:border-blue-700" },
  2: { bg: "bg-amber-100 dark:bg-amber-900/50", text: "text-amber-700 dark:text-amber-300", border: "border-amber-300 dark:border-amber-700" },
  3: { bg: "bg-emerald-100 dark:bg-emerald-900/50", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-300 dark:border-emerald-700" },
};

function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, "").trim();
}

// Bresenham-style interleaved distribution
function spreadInterleave(
  staff: string[],
  slotCounts: { slotNumber: number; count: number }[],
): { staffId: string; slotNumber: number }[] {
  const total = slotCounts.reduce((a, b) => a + b.count, 0);
  if (total === 0 || staff.length === 0) return [];
  const result: { staffId: string; slotNumber: number }[] = [];
  const errors = slotCounts.map(s => s.count / total);
  const remaining = slotCounts.map(s => s.count);

  for (let i = 0; i < staff.length; i++) {
    let bestIdx = -1;
    let bestErr = -Infinity;
    for (let j = 0; j < slotCounts.length; j++) {
      if (remaining[j] <= 0) continue;
      if (errors[j] > bestErr) { bestErr = errors[j]; bestIdx = j; }
    }
    if (bestIdx === -1) break;
    result.push({ staffId: staff[i], slotNumber: slotCounts[bestIdx].slotNumber });
    remaining[bestIdx]--;
    errors[bestIdx] -= 1;
    for (let j = 0; j < slotCounts.length; j++) errors[j] += slotCounts[j].count / total;
  }
  return result;
}

export async function getBreakSlotSettingsAction(projectId: string): Promise<BreakSlotSetting[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("break_slot_settings")
    .select("*").eq("project_id", projectId).order("sort_order");
  if (!data?.length) return DEFAULT_SLOTS.map((s, i) => ({ ...s, id: String(i) }));
  return data as BreakSlotSetting[];
}

export async function saveBreakSlotSettingsAction(
  projectId: string,
  slots: Omit<BreakSlotSetting, "id">[],
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "未認証" };

  const admin = createAdminClient();
  await admin.from("break_slot_settings").delete().eq("project_id", projectId);
  const { error } = await admin.from("break_slot_settings").insert(
    slots.map(s => ({ ...s, project_id: projectId }))
  );
  if (error) return { success: false, error: error.message };
  revalidatePath("/seating");
  return { success: true };
}

export async function getBreakSlotAssignmentsAction(
  projectId: string,
  date: string,
): Promise<BreakSlotAssignment[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("break_slot_assignments")
    .select("staff_id, slot_number")
    .eq("project_id", projectId).eq("assignment_date", date);
  return (data ?? []) as BreakSlotAssignment[];
}

export async function updateBreakSlotAssignmentAction(
  projectId: string,
  date: string,
  staffId: string,
  slotNumber: number,
): Promise<{ success: boolean }> {
  const admin = createAdminClient();
  const { error } = await admin.from("break_slot_assignments")
    .upsert({ project_id: projectId, assignment_date: date, staff_id: staffId, slot_number: slotNumber },
      { onConflict: "project_id,assignment_date,staff_id" });
  if (error) return { success: false };
  revalidatePath("/seating");
  return { success: true };
}

export async function assignBreakSlotsAction(
  projectId: string,
  date: string,
): Promise<{ success: boolean; count: number; error?: string }> {
  const admin = createAdminClient();

  // 設定取得（なければデフォルト）
  const slots = await getBreakSlotSettingsAction(projectId);
  const slotByNumber = new Map(slots.map(s => [s.slot_number, s]));

  // 当日座席割り当てからスタッフ取得
  const { data: seatAssignments } = await admin.from("seat_assignments")
    .select("staff_id").eq("project_id", projectId).eq("assignment_date", date);
  const staffIds = [...new Set((seatAssignments ?? []).map(a => a.staff_id as string))];
  if (staffIds.length === 0) return { success: true, count: 0 };

  // スタッフのセクション・名前取得
  const { data: memberRows } = await admin.from("project_members")
    .select("staff_id, section, staffs(name, display_name)")
    .eq("project_id", projectId)
    .in("staff_id", staffIds);

  // 当日シフト名取得（早番/遅番判定）
  const { data: shiftRows } = await admin.from("shifts")
    .select("staff_id, shift_name")
    .eq("project_id", projectId).eq("shift_date", date)
    .in("staff_id", staffIds);

  // 番付取得（ASS査定 / ASS販売）
  const { data: rankRows } = await admin.from("rankings")
    .select("staff_name, account_number, rank")
    .eq("project_id", projectId)
    .order("rank");

  // 番付マップ（normalize済み名前 → 順位）
  const rankMap: Record<string, Map<string, number>> = {
    "査定": new Map(),
    "販売": new Map(),
  };
  for (const r of rankRows ?? []) {
    const key = normalize(r.staff_name as string);
    if ((r.account_number as string) === "ASS査定") rankMap["査定"].set(key, r.rank as number);
    if ((r.account_number as string) === "ASS販売") rankMap["販売"].set(key, r.rank as number);
  }

  const shiftMap = new Map((shiftRows ?? []).map(r => [r.staff_id as string, r.shift_name as string]));

  type StaffItem = { staffId: string; section: string; shiftType: "early" | "late"; rank: number };
  const staffItems: StaffItem[] = [];

  for (const m of memberRows ?? []) {
    const section = (m as { section?: string | null }).section ?? "";
    if (section !== "査定" && section !== "販売") continue;
    const shiftName = shiftMap.get(m.staff_id) ?? "";
    const shiftType = shiftName.includes("早番") ? "early"
                    : shiftName.includes("遅番") ? "late"
                    : null;
    if (!shiftType) continue;

    const sInfo = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { display_name?: string | null; name?: string | null } | null;
    const displayName = sInfo?.display_name ?? sInfo?.name ?? "";
    const rank = rankMap[section].get(normalize(displayName)) ?? 9999;

    staffItems.push({ staffId: m.staff_id, section, shiftType, rank });
  }

  const allAssignments: { project_id: string; assignment_date: string; staff_id: string; slot_number: number }[] = [];

  for (const sectionName of ["査定", "販売"] as const) {
    const sectionStaff = staffItems
      .filter(s => s.section === sectionName)
      .sort((a, b) => a.rank - b.rank);
    if (sectionStaff.length === 0) continue;

    const earlyStaff = sectionStaff.filter(s => s.shiftType === "early").map(s => s.staffId);
    const lateStaff  = sectionStaff.filter(s => s.shiftType === "late").map(s => s.staffId);
    const total = sectionStaff.length;

    // スロット別目標人数計算
    let rem = total;
    const targets = slots.map((s, i) => {
      const count = i === slots.length - 1 ? rem : Math.round(total * s.ratio / 100);
      rem -= count;
      return { slotNumber: s.slot_number, targetShift: s.target_shift, count: Math.max(0, count) };
    });

    const earlySlots = targets.filter(t => t.targetShift === "early" || t.targetShift === "both");
    const lateSlots  = targets.filter(t => t.targetShift === "late"  || t.targetShift === "both");

    // 早番スタッフ分配
    if (earlyStaff.length > 0 && earlySlots.length > 0) {
      const earlyTotal = earlyStaff.length;
      // early-only slot と both slot への分配
      const earlyOnlySlots = earlySlots.filter(s => s.targetShift === "early");
      const bothSlots      = earlySlots.filter(s => s.targetShift === "both");
      const earlyOnlyTarget = Math.min(earlyOnlySlots.reduce((a, b) => a + b.count, 0), earlyTotal);
      const bothFromEarly   = earlyTotal - earlyOnlyTarget;
      const earlyDist: { slotNumber: number; count: number }[] = [
        ...earlyOnlySlots.map(s => ({ slotNumber: s.slotNumber, count: Math.min(s.count, earlyOnlyTarget) })),
        ...bothSlots.map(s => ({ slotNumber: s.slotNumber, count: Math.max(0, bothFromEarly) })),
      ].filter(d => d.count > 0);
      spreadInterleave(earlyStaff, earlyDist).forEach(a =>
        allAssignments.push({ project_id: projectId, assignment_date: date, staff_id: a.staffId, slot_number: a.slotNumber })
      );
    }

    // 遅番スタッフ分配
    if (lateStaff.length > 0 && lateSlots.length > 0) {
      const lateTotal = lateStaff.length;
      const lateOnlySlots = lateSlots.filter(s => s.targetShift === "late");
      const bothSlots     = lateSlots.filter(s => s.targetShift === "both");
      // both slot は早番分を差し引いた残り
      const earlyUsedInBoth = earlyStaff.length > 0
        ? Math.max(0, earlyStaff.length - targets.filter(t => t.targetShift === "early").reduce((a, b) => a + b.count, 0))
        : 0;
      const bothRemaining = bothSlots.map(s => ({
        slotNumber: s.slotNumber,
        count: Math.max(0, s.count - earlyUsedInBoth),
      }));
      const lateOnlyTarget = Math.min(lateOnlySlots.reduce((a, b) => a + b.count, 0), lateTotal);
      const bothFromLate   = lateTotal - lateOnlyTarget;
      const lateDist: { slotNumber: number; count: number }[] = [
        ...bothRemaining.map(s => ({ slotNumber: s.slotNumber, count: Math.min(s.count, bothFromLate) })),
        ...lateOnlySlots.map(s => ({ slotNumber: s.slotNumber, count: Math.min(s.count, lateOnlyTarget) })),
      ].filter(d => d.count > 0);
      spreadInterleave(lateStaff, lateDist).forEach(a =>
        allAssignments.push({ project_id: projectId, assignment_date: date, staff_id: a.staffId, slot_number: a.slotNumber })
      );
    }
  }

  // 保存（既存を削除して挿入）
  await admin.from("break_slot_assignments").delete()
    .eq("project_id", projectId).eq("assignment_date", date);

  if (allAssignments.length > 0) {
    const { error } = await admin.from("break_slot_assignments").insert(allAssignments);
    if (error) return { success: false, count: 0, error: error.message };
  }

  revalidatePath("/seating");
  revalidatePath("/attendance");
  return { success: true, count: allAssignments.length };
}
