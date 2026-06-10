"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseBreakRoomBox } from "@/lib/break-room";
import { revalidatePath } from "next/cache";
import { assignBreakSlotsAction } from "./break-actions";

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

  // 休憩終了時は休憩室の箱を自動解放
  if (isOnBreak) {
    await releaseBreakRoomBox(admin, projectId, staffId, today);
  }

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

  // 座席保存後に休憩スロットを自動割り振り（非同期・エラーは無視）
  assignBreakSlotsAction(projectId, date).catch(() => undefined);

  return { success: true };
}

/** セクション×シフトで自動配置（翌日）
 *  existingAssignments: クライアントが既に持っている配置（保持される）
 *  空席かつ未割当スタッフのみ埋める
 */
export async function autoAssignSeatsAction(
  projectId: string,
  date: string,
  existingAssignments: { seatId: string; staffId: string }[] = [],
): Promise<{ success: boolean; message?: string; assignments?: { seatId: string; staffId: string }[] }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();

  const OFF_NAMES = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤", "希望休"];
  const KNOWN_SECTIONS = ["SV", "査定", "販売", "MOTA", "ローン", "リメイク"];

  /** シフト名の先頭でセクションを解決（"MOTA_遅番_A" → "MOTA"） */
  function parseSection(shiftName: string, fallback: string): string {
    for (const sec of KNOWN_SECTIONS) {
      if (shiftName.startsWith(sec)) return sec;
    }
    return fallback;
  }

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

  // 当日出勤予定スタッフ（シフト名からセクション解決・SVは自動配置対象外）
  const memberSectionMap = new Map((members ?? []).map(m => [m.staff_id, m.section ?? ""]));
  const workingStaff = (shifts ?? [])
    .filter(s => s.shift_name && !OFF_NAMES.includes(s.shift_name as string))
    .map(s => ({
      staffId:  s.staff_id as string,
      section:  parseSection(s.shift_name as string, memberSectionMap.get(s.staff_id) ?? ""),
    }))
    .filter(s => s.section !== "SV"); // SV は自動配置しない

  // 既存配置を起点にする
  const assignments: { seatId: string; staffId: string }[] = [...existingAssignments];
  const usedSeats  = new Set(existingAssignments.map(a => a.seatId));
  const usedStaff  = new Set(existingAssignments.map(a => a.staffId));

  // 無効席は配置対象外
  const activeSeats = (seats ?? []).filter(s => (s as { seat_type?: string }).seat_type !== "disabled");
  // まだ配置されていない席・スタッフだけ対象
  const emptySeats   = activeSeats.filter(s => !usedSeats.has(s.id));
  const pendingStaff = workingStaff.filter(s => !usedStaff.has(s.staffId));

  // パス1: セクション指定席 → 同セクションのスタッフのみ配置
  //        セクション一致スタッフがいなければ空席のまま（他セクションは入れない）
  for (const seat of emptySeats) {
    const seatType = (seat as { seat_type?: string }).seat_type;
    if (!seat.section || seatType === "free") continue;
    const match = pendingStaff.find(s => !usedStaff.has(s.staffId) && s.section === seat.section);
    if (match) {
      assignments.push({ seatId: seat.id, staffId: match.staffId });
      usedSeats.add(seat.id);
      usedStaff.add(match.staffId);
    }
  }

  // パス2: フリー席・セクション未指定席のみ → パス1で配置できなかったスタッフを順番に
  //        セクション指定席はスキップ（他セクションスタッフを入れない）
  const freeOrNoSection = emptySeats.filter(s => {
    if (usedSeats.has(s.id)) return false;
    const seatType = (s as { seat_type?: string }).seat_type;
    return seatType === "free" || !s.section;
  });
  const overflow = pendingStaff.filter(s => !usedStaff.has(s.staffId));
  for (let i = 0; i < Math.min(freeOrNoSection.length, overflow.length); i++) {
    assignments.push({ seatId: freeOrNoSection[i].id, staffId: overflow[i].staffId });
  }

  return { success: true, assignments };
}

// ──────────────────────────────────────────────────
// 同時編集セッション管理
// TTL: 2分間 heartbeat がなければ期限切れとみなす
// ──────────────────────────────────────────────────
const SESSION_TTL_MINUTES = 2;

export type SeatingEditor = {
  staffId: string;
  staffName: string;
  startedAt: string;
};

/** 編集セッション取得（期限切れは除外） */
export async function getSeatingEditorsAction(
  projectId: string,
  date: string,
): Promise<{ editors: SeatingEditor[] }> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - SESSION_TTL_MINUTES * 60 * 1000).toISOString();
  const { data } = await admin
    .from("seating_edit_sessions")
    .select("staff_id, staff_name, started_at")
    .eq("project_id", projectId)
    .eq("edit_date", date)
    .gte("last_heartbeat", cutoff);
  return {
    editors: (data ?? []).map(r => ({
      staffId:   r.staff_id   as string,
      staffName: r.staff_name as string,
      startedAt: r.started_at as string,
    })),
  };
}

/** 編集開始（セッション取得・upsert） */
export async function acquireSeatingEditAction(
  projectId: string,
  date: string,
): Promise<{ ok: boolean; staffId?: string; staffName?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未ログイン" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const admin = createAdminClient();

  // スタッフ名取得
  const { data: member } = await admin
    .from("staff_members")
    .select("name")
    .eq("staff_id", staffId)
    .single();
  const staffName = (member?.name as string | null) ?? staffId;

  const now = new Date().toISOString();
  const { error } = await admin
    .from("seating_edit_sessions")
    .upsert(
      {
        project_id:      projectId,
        edit_date:       date,
        staff_id:        staffId,
        staff_name:      staffName,
        started_at:      now,
        last_heartbeat:  now,
      },
      { onConflict: "project_id,edit_date,staff_id" },
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true, staffId, staffName };
}

/** heartbeat（編集継続中を通知） */
export async function heartbeatSeatingEditAction(
  projectId: string,
  date: string,
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const admin = createAdminClient();

  await admin
    .from("seating_edit_sessions")
    .update({ last_heartbeat: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("edit_date", date)
    .eq("staff_id", staffId);

  return { ok: true };
}

/** 編集終了（セッション解放） */
export async function releaseSeatingEditAction(
  projectId: string,
  date: string,
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const admin = createAdminClient();

  await admin
    .from("seating_edit_sessions")
    .delete()
    .eq("project_id", projectId)
    .eq("edit_date", date)
    .eq("staff_id", staffId);

  return { ok: true };
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
