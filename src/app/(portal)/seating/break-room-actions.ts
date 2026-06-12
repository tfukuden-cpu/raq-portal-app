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
  /** 占有者の表示名・キャラ（getBreakRoomStateAction が staffs から解決） */
  name?: string;
  rpgCharId?: number | null;
};

export type BreakRoomAmenity = { label: string; ok: boolean };

export type BreakRoomState = {
  capacity: number;
  uses: BreakRoomUse[];
  amenities: BreakRoomAmenity[];
  isOpen: boolean;
};

// 設定行が無い案件のデフォルト設備（DBカラムのdefaultと同値）
const DEFAULT_AMENITIES: BreakRoomAmenity[] = [
  { label: "トイレ", ok: true },
  { label: "Wi-Fi", ok: true },
  { label: "冷蔵庫", ok: false },
  { label: "電子レンジ", ok: false },
];

function normalizeAmenities(raw: unknown): BreakRoomAmenity[] {
  if (!Array.isArray(raw)) return DEFAULT_AMENITIES;
  return raw
    .filter((a): a is { label: string; ok: boolean } =>
      !!a && typeof a === "object"
      && typeof (a as { label?: unknown }).label === "string"
      && typeof (a as { ok?: unknown }).ok === "boolean")
    .map(a => ({ label: a.label.slice(0, 20), ok: a.ok }))
    .slice(0, 12);
}

export type BreakRoomResult = { ok: boolean; error?: string };

// ── 現在の占有状況＋定員を取得 ────────────────────────────
export async function getBreakRoomStateAction(projectId: string): Promise<BreakRoomState> {
  const admin = createAdminClient();
  const today = tokyoToday();

  const [{ data: setting }, { data: uses }] = await Promise.all([
    admin
      .from("break_room_settings")
      .select("capacity, amenities, is_open")
      .eq("project_id", projectId)
      .maybeSingle(),
    admin
      .from("break_room_uses")
      .select("box_number, staff_id, entered_at")
      .eq("project_id", projectId)
      .eq("use_date", today)
      .order("box_number"),
  ]);

  // 占有者の名前・キャラを解決
  const staffIds = [...new Set((uses ?? []).map(u => u.staff_id as string))];
  const nameMap = new Map<string, { name: string; rpgCharId: number | null }>();
  if (staffIds.length > 0) {
    const { data: staffRows } = await admin
      .from("staffs")
      .select("id, name, display_name, rpg_character")
      .in("id", staffIds);
    for (const s of staffRows ?? []) {
      nameMap.set(s.id as string, {
        name: (s.display_name as string | null) ?? (s.name as string | null) ?? (s.id as string),
        rpgCharId: (s as { rpg_character?: number | null }).rpg_character ?? null,
      });
    }
  }

  return {
    capacity: (setting as { capacity?: number } | null)?.capacity ?? 6,
    uses: (uses ?? []).map(u => ({
      boxNumber: u.box_number as number,
      staffId:   u.staff_id as string,
      enteredAt: u.entered_at as string,
      name:      nameMap.get(u.staff_id as string)?.name ?? (u.staff_id as string),
      rpgCharId: nameMap.get(u.staff_id as string)?.rpgCharId ?? null,
    })),
    amenities: setting ? normalizeAmenities((setting as { amenities?: unknown }).amenities) : DEFAULT_AMENITIES,
    isOpen: (setting as { is_open?: boolean } | null)?.is_open ?? true,
  };
}

// ── 設備情報の更新（管理者ビューのみ） ────────────────────
export async function setBreakRoomAmenitiesAction(
  projectId: string,
  amenities: BreakRoomAmenity[],
): Promise<BreakRoomResult> {
  const clean = normalizeAmenities(amenities).filter(a => a.label.trim().length > 0);
  const admin = createAdminClient();
  const { error } = await admin.from("break_room_settings").upsert(
    { project_id: projectId, amenities: clean, updated_at: new Date().toISOString() },
    { onConflict: "project_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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

  // 定員・開放チェック
  const { data: setting } = await admin
    .from("break_room_settings")
    .select("capacity, is_open")
    .eq("project_id", projectId)
    .maybeSingle();
  const capacity = (setting as { capacity?: number } | null)?.capacity ?? 6;
  const isOpen   = (setting as { is_open?: boolean } | null)?.is_open ?? true;
  if (!isOpen) return { ok: false, error: "休憩室は閉鎖中です" };
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

// ── 本人入室（ログインユーザー自身・ホームの休憩室ウィンドウ用） ──
// staffId はセッションから導出。休憩中チェック・閉鎖チェックは enterBreakRoomAction が行う
export async function enterMyBreakRoomAction(boxNumber: number): Promise<BreakRoomResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインしてください" };
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  if (!staffId) return { ok: false, error: "スタッフIDを特定できません" };

  const projectId = await getCurrentProjectId();
  if (!projectId) return { ok: false, error: "案件が選択されていません" };

  return enterBreakRoomAction(projectId, staffId, boxNumber);
}

// ── 開放/閉鎖の切り替え（管理者ビューのみ） ────────────────
export async function setBreakRoomOpenAction(
  projectId: string,
  isOpen: boolean,
): Promise<BreakRoomResult> {
  const admin = createAdminClient();
  const { error } = await admin.from("break_room_settings").upsert(
    { project_id: projectId, is_open: isOpen, updated_at: new Date().toISOString() },
    { onConflict: "project_id" },
  );
  if (error) return { ok: false, error: error.message };
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
