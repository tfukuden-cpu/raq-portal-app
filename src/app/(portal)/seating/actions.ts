"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

function tokyoToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** 休憩開始 / 終了トグル */
export async function toggleBreakAction(
  projectId: string,
  staffId: string,
): Promise<{ success: boolean; message?: string; newStatus?: "on_break" | "working" }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();
  const today = tokyoToday();
  const todayStart = `${today}T00:00:00+09:00`;
  const todayEnd   = `${today}T23:59:59+09:00`;

  const { data: logs } = await admin
    .from("punch_logs")
    .select("punch_type")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .in("punch_type", ["break_start", "break_end"])
    .gte("recorded_at", todayStart)
    .lte("recorded_at", todayEnd)
    .order("recorded_at", { ascending: false })
    .limit(1);

  const isOnBreak = logs?.[0]?.punch_type === "break_start";
  const newType   = isOnBreak ? "break_end" : "break_start";

  const { error } = await admin.from("punch_logs").insert({
    project_id:  projectId,
    staff_id:    staffId,
    punch_type:  newType,
    recorded_at: new Date().toISOString(),
  });

  if (error) return { success: false, message: error.message };
  revalidatePath("/seating");
  return { success: true, newStatus: isOnBreak ? "working" : "on_break" };
}

/** 座席割当を保存（翌日分など） */
export async function saveSeatAssignmentsAction(
  projectId: string,
  date: string,
  assignments: { seatId: string; staffId: string }[],
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();
  await admin.from("seat_assignments")
    .delete()
    .eq("project_id", projectId)
    .eq("assignment_date", date);

  if (assignments.length > 0) {
    const rows = assignments.map(a => ({
      project_id:      projectId,
      seat_id:         a.seatId,
      staff_id:        a.staffId,
      assignment_date: date,
      created_by:      user.email?.split("@")[0]?.toUpperCase() ?? "",
    }));
    const { error } = await admin.from("seat_assignments").insert(rows);
    if (error) return { success: false, message: error.message };
  }

  revalidatePath("/seating");
  revalidatePath("/seating/plan");
  return { success: true };
}

/** セクション×シフトで自動配置（翌日） */
export async function autoAssignSeatsAction(
  projectId: string,
  date: string,
): Promise<{ success: boolean; message?: string; assignments?: { seatId: string; staffId: string }[] }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();

  const OFF_NAMES = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤", "希望休"];

  const [{ data: seats }, { data: shifts }, { data: members }] = await Promise.all([
    admin.from("seats").select("id, section, seat_type").eq("project_id", projectId).eq("is_active", true),
    admin.from("shifts")
      .select("staff_id, shift_name")
      .eq("project_id", projectId)
      .eq("shift_date", date),
    admin.from("project_members")
      .select("staff_id, section")
      .eq("project_id", projectId),
  ]);

  // 当日出勤予定スタッフ
  const sectionMap = new Map((members ?? []).map(m => [m.staff_id, m.section ?? ""]));
  const workingStaff = (shifts ?? [])
    .filter(s => s.shift_name && !OFF_NAMES.includes(s.shift_name))
    .map(s => ({ staffId: s.staff_id, section: sectionMap.get(s.staff_id) ?? "" }));

  // セクションごとに席と人を対応付け
  const assignments: { seatId: string; staffId: string }[] = [];
  const usedSeats  = new Set<string>();
  const usedStaff  = new Set<string>();

  // 無効席は配置対象外
  const activeSeats = (seats ?? []).filter(s => (s as { seat_type?: string }).seat_type !== "disabled");

  // パス1: セクション一致（通常席）
  for (const seat of activeSeats) {
    if (!seat.section || (seat as { seat_type?: string }).seat_type === "free") continue;
    const match = workingStaff.find(s => !usedStaff.has(s.staffId) && s.section === seat.section);
    if (match) {
      assignments.push({ seatId: seat.id, staffId: match.staffId });
      usedSeats.add(seat.id);
      usedStaff.add(match.staffId);
    }
  }

  // パス2: フリー席・セクション未指定席 → 余ったスタッフを順番に
  const remainSeats  = activeSeats.filter(s => !usedSeats.has(s.id));
  const remainStaff  = workingStaff.filter(s => !usedStaff.has(s.staffId));
  for (let i = 0; i < Math.min(remainSeats.length, remainStaff.length); i++) {
    assignments.push({ seatId: remainSeats[i].id, staffId: remainStaff[i].staffId });
  }

  return { success: true, assignments };
}

/** 壁レイアウト保存 */
export async function saveSeatWallsAction(
  projectId: string,
  walls: { id?: string; x1Pct: number; y1Pct: number; x2Pct: number; y2Pct: number }[],
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();
  // 既存を全削除して入れ直す
  await admin.from("seat_walls").delete().eq("project_id", projectId);

  if (walls.length > 0) {
    const rows = walls.map(w => ({
      project_id: projectId,
      x1_pct: w.x1Pct, y1_pct: w.y1Pct,
      x2_pct: w.x2Pct, y2_pct: w.y2Pct,
    }));
    const { error } = await admin.from("seat_walls").insert(rows);
    if (error) return { success: false, message: error.message };
  }

  revalidatePath("/seating");
  return { success: true };
}

/** 座席レイアウト保存 */
export async function saveSeatLayoutAction(
  projectId: string,
  seats: { id?: string; label: string; xPct: number; yPct: number; section: string; seatType?: string; shiftSlot?: string }[],
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();

  // 既存の全席を取得
  const { data: existing } = await admin
    .from("seats").select("id").eq("project_id", projectId);

  const existingIds = new Set((existing ?? []).map(s => s.id as string));
  const inputIds    = new Set(seats.filter(s => s.id).map(s => s.id as string));

  // 削除（inputにないもの）
  const toDelete = [...existingIds].filter(id => !inputIds.has(id));
  if (toDelete.length > 0) {
    await admin.from("seats").delete().in("id", toDelete);
  }

  // 新規（id なし）と既存（id あり）を分けて処理
  // upsert に id なし行を渡すと PostgREST が id:null 扱いして not-null エラーになるため
  const newSeats      = seats.filter(s => !s.id);
  const existingSeats = seats.filter(s =>  s.id);

  if (newSeats.length > 0) {
    const newRows = newSeats.map(s => ({
      project_id: projectId,
      label:      s.label,
      x_pct:      s.xPct,
      y_pct:      s.yPct,
      section:    s.section || null,
      seat_type:  s.seatType ?? "normal",
      shift_slot: s.shiftSlot || null,
      is_active:  true,
    }));
    const { error } = await admin.from("seats").insert(newRows);
    if (error) return { success: false, message: error.message };
  }

  if (existingSeats.length > 0) {
    const existingRows = existingSeats.map(s => ({
      id:         s.id!,
      project_id: projectId,
      label:      s.label,
      x_pct:      s.xPct,
      y_pct:      s.yPct,
      section:    s.section || null,
      seat_type:  s.seatType ?? "normal",
      shift_slot: s.shiftSlot || null,
      is_active:  true,
    }));
    const { error } = await admin.from("seats").upsert(existingRows, { onConflict: "id" });
    if (error) return { success: false, message: error.message };
  }

  revalidatePath("/seating");
  revalidatePath("/seating/plan");
  return { success: true };
}
