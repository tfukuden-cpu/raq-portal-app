"use server";

/**
 * 休憩室（定員制の箱）サーバーアクション
 * - 入室はステータスが休憩中（break_start 進行中・未退勤）のスタッフのみ
 * - 箱は UNIQUE(project_id, use_date, box_number) で二重取りをDBレベルで防止
 * - 退室・休憩終了・退勤で自動解放（lib/break-room.ts の releaseBreakRoomBox）
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { releaseBreakRoomBox } from "@/lib/break-room";

function tokyoToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export type BreakRoomUse = {
  boxNumber: number;
  staffId: string;
  enteredAt: string; // ISO
};

export type BreakRoomState = {
  capacity: number;
  uses: BreakRoomUse[];
};

export type BreakRoomResult = { ok: boolean; error?: string };

// ── 現在の占有状況＋定員を取得 ────────────────────────────
export async function getBreakRoomStateAction(projectId: string): Promise<BreakRoomState> {
  const admin = createAdminClient();
  const today = tokyoToday();

  const [{ data: setting }, { data: uses }] = await Promise.all([
    admin
      .from("break_room_settings")
      .select("capacity")
      .eq("project_id", projectId)
      .maybeSingle(),
    admin
      .from("break_room_uses")
      .select("box_number, staff_id, entered_at")
      .eq("project_id", projectId)
      .eq("use_date", today)
      .order("box_number"),
  ]);

  return {
    capacity: (setting as { capacity?: number } | null)?.capacity ?? 6,
    uses: (uses ?? []).map(u => ({
      boxNumber: u.box_number as number,
      staffId:   u.staff_id as string,
      enteredAt: u.entered_at as string,
    })),
  };
}

// ── 入室（箱に名前を入れる） ──────────────────────────────
// 条件: 休憩中（break_start 進行中）かつ未退勤のスタッフのみ
export async function enterBreakRoomAction(
  projectId: string,
  staffId: string,
  boxNumber: number,
): Promise<BreakRoomResult> {
  if (!projectId || !staffId || !Number.isInteger(boxNumber) || boxNumber < 1) {
    return { ok: false, error: "パラメータが不正です" };
  }
  const admin = createAdminClient();
  const today = tokyoToday();
  const todayStart = `${today}T00:00:00+09:00`;
  const todayEnd   = `${today}T23:59:59+09:00`;

  // 定員チェック
  const { data: setting } = await admin
    .from("break_room_settings")
    .select("capacity")
    .eq("project_id", projectId)
    .maybeSingle();
  const capacity = (setting as { capacity?: number } | null)?.capacity ?? 6;
  if (boxNumber > capacity) return { ok: false, error: "定員を超えた箱番号です" };

  // ステータス確認: 最新の break が break_start、かつ未退勤
  const { data: logs } = await admin
    .from("punch_logs")
    .select("punch_type")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .in("punch_type", ["break_start", "break_end", "clock_out"])
    .gte("recorded_at", todayStart)
    .lte("recorded_at", todayEnd)
    .order("recorded_at", { ascending: false })
    .limit(1);
  if (logs?.[0]?.punch_type !== "break_start") {
    return { ok: false, error: "休憩中のスタッフのみ入室できます" };
  }

  const { error } = await admin.from("break_room_uses").insert({
    project_id: projectId,
    staff_id:   staffId,
    use_date:   today,
    box_number: boxNumber,
  });

  if (error) {
    // UNIQUE 制約違反 = 箱が取られた / 既に入室中
    if (error.code === "23505") {
      return { ok: false, error: "その箱は使用中か、既に入室済みです" };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// ── 退室（自分の箱から名前を外す） ────────────────────────
export async function leaveBreakRoomAction(
  projectId: string,
  staffId: string,
): Promise<BreakRoomResult> {
  if (!projectId || !staffId) return { ok: false, error: "パラメータが不正です" };
  const admin = createAdminClient();
  await releaseBreakRoomBox(admin, projectId, staffId, tokyoToday());
  return { ok: true };
}

// ── 本人退室（ログインユーザー自身・スマホのmyページ用） ──
// staffId はセッションから導出するため、他人の枠は外せない
export async function leaveMyBreakRoomAction(): Promise<BreakRoomResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインしてください" };
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  if (!staffId) return { ok: false, error: "スタッフIDを特定できません" };

  const projectId = await getCurrentProjectId();
  if (!projectId) return { ok: false, error: "案件が選択されていません" };

  const admin = createAdminClient();
  await releaseBreakRoomBox(admin, projectId, staffId, tokyoToday());
  return { ok: true };
}

// ── 強制解放（管理者ビューのみ） ──────────────────────────
export async function forceReleaseBreakRoomAction(
  projectId: string,
  boxNumber: number,
): Promise<BreakRoomResult> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("break_room_uses")
    .delete()
    .eq("project_id", projectId)
    .eq("use_date", tokyoToday())
    .eq("box_number", boxNumber);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── 定員変更（管理者ビューのみ） ──────────────────────────
export async function setBreakRoomCapacityAction(
  projectId: string,
  capacity: number,
): Promise<BreakRoomResult> {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
    return { ok: false, error: "定員は1〜50で指定してください" };
  }
  const admin = createAdminClient();
  const { error } = await admin.from("break_room_settings").upsert(
    { project_id: projectId, capacity, updated_at: new Date().toISOString() },
    { onConflict: "project_id" },
  );
  if (error) return { ok: false, error: error.message };

  // 定員を減らした場合、はみ出した箱を解放
  const { error: delError } = await admin
    .from("break_room_uses")
    .delete()
    .eq("project_id", projectId)
    .eq("use_date", tokyoToday())
    .gt("box_number", capacity);
  if (delError) return { ok: false, error: delError.message };
  return { ok: true };
}
