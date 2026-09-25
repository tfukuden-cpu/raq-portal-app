"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

function tokyoToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** 管理者判定（全社admin/executive または当該案件の project_admin） */
async function isProjectAdmin(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const staffId = user?.email?.split("@")[0]?.toUpperCase() ?? "";
  if (!staffId) return false;
  const admin = createAdminClient();
  const { data: staff } = await admin
    .from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  const role = (staff as { global_role?: string } | null)?.global_role;
  if (role === "admin" || role === "executive") return true;
  const { data: mem } = await admin
    .from("project_members").select("role")
    .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
  return (mem as { role?: string } | null)?.role === "project_admin";
}

/** 退避に入れる1件（jsonb の要素と同じ形） */
type SeatSnapshotEntry = { seat_id: string; staff_id: string };

/** jsonb から読んだ退避を検証しつつ SeatSnapshotEntry[] にする（壊れた要素は捨てる） */
function parseSnapshotAssignments(raw: unknown): SeatSnapshotEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SeatSnapshotEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const seatId  = (r as { seat_id?:  unknown }).seat_id;
    const staffId = (r as { staff_id?: unknown }).staff_id;
    if (typeof seatId === "string" && seatId && typeof staffId === "string" && staffId) {
      out.push({ seat_id: seatId, staff_id: staffId });
    }
  }
  return out;
}

/**
 * その日の現在の座席割当を退避テーブルに保存（1世代のみ・「席替えを元に戻す」で使う）。
 * 0件でも空配列で退避する（「誰も配置していない状態」に戻せるようにするため）。
 */
async function snapshotSeatAssignments(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  date: string,
  savedBy: string,
  entries?: SeatSnapshotEntry[],
): Promise<void> {
  let rows = entries;
  if (!rows) {
    const { data, error } = await admin
      .from("seat_assignments")
      .select("seat_id, staff_id")
      .eq("project_id", projectId)
      .eq("assignment_date", date);
    if (error) throw new Error(error.message);
    rows = (data ?? []).map(r => ({
      seat_id:  r.seat_id  as string,
      staff_id: r.staff_id as string,
    }));
  }
  const { error: upErr } = await admin
    .from("seat_assignment_snapshots")
    .upsert(
      {
        project_id:      projectId,
        assignment_date: date,
        assignments:     rows,
        saved_by:        savedBy,
        // 既存行を更新するときは default now() が効かないので明示的に入れる
        saved_at:        new Date().toISOString(),
      },
      { onConflict: "project_id,assignment_date" },
    );
  if (upErr) throw new Error(upErr.message);
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
  if (!(await isProjectAdmin(projectId))) {
    return { success: false, message: "座席の保存は管理者のみ可能です" };
  }

  const admin = createAdminClient();
  const savedBy = user.email?.split("@")[0]?.toUpperCase() ?? "";

  // 上書きする前の配置を退避（1手アンドゥ用）。
  // 退避に失敗しても席替えの保存は続ける（保存が止まる方が現場は困る）。
  // ただし古い退避を残すと「元に戻す」が2世代以上前に戻ってしまい、
  // ボタンの時刻表示だけでは気づけないので、失敗したらその日の退避を消して
  // 「戻せない（ボタン無効）」状態に寄せる
  try {
    await snapshotSeatAssignments(admin, projectId, date, savedBy);
  } catch (e) {
    console.error("[saveSeatAssignmentsAction] 直前の配置の退避に失敗", e);
    try {
      await admin.from("seat_assignment_snapshots")
        .delete()
        .eq("project_id", projectId)
        .eq("assignment_date", date);
    } catch (e2) {
      console.error("[saveSeatAssignmentsAction] 古い退避の削除にも失敗", e2);
    }
  }

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
      created_by:      savedBy,
    }));
    const { error } = await admin.from("seat_assignments").insert(rows);
    if (error) return { success: false, message: error.message };
  }

  revalidatePath("/seating");
  revalidatePath("/seating/plan");

  // 休憩スロットの自動割り振りは行わない（現場はスプレッドシートで休憩を決めているため、
  // 「シートから休憩を取り込む」で明示的に取り込む。保存の副作用で上書きしないこと）

  return { success: true };
}

/**
 * 席替えを1手だけ元に戻す（座席だけ・休憩スロットには一切触らない）。
 *
 * 退避は1世代のみ。戻すときに「いまの配置」を新しい退避にするのでトグルになる
 * （もう一度押すと戻す前の配置に戻る＝やり直し）。
 */
export async function undoSeatAssignmentsAction(
  projectId: string,
  date: string,
): Promise<{
  success: boolean;
  message?: string;
  /** 復元した配置の件数 */
  restoredCount?: number;
  /** 戻した世代が退避された時刻（ISO） */
  snapshotAt?: string;
  /** 席が消えている等で復元できなかった件数 */
  skipped?: number;
}> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, message: "ログインしてください" };
    const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

    if (!(await isProjectAdmin(projectId))) {
      return { success: false, message: "この操作は管理者のみ可能です" };
    }
    // 他の管理者が席替え編集中なら拒否する。ここを通すと、編集中の人が保存した
    // ときに手元の（戻す前の）配置で全件上書きされ、戻した内容が痕跡なく消える
    const { editors } = await getSeatingEditorsAction(projectId, date);
    const others = editors.filter(e => e.staffId !== staffId);
    if (others.length > 0) {
      return {
        success: false,
        message: `${others.map(e => e.staffName).join("・")}が席替えを編集中のため戻せません`,
      };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { success: false, message: "日付が不正です" };
    }

    const admin = createAdminClient();

    // ① 退避を読む
    const { data: snapRow, error: snapErr } = await admin
      .from("seat_assignment_snapshots")
      .select("assignments, saved_at")
      .eq("project_id", projectId)
      .eq("assignment_date", date)
      .maybeSingle();
    if (snapErr) {
      return { success: false, message: `退避の読み込みに失敗しました: ${snapErr.message}` };
    }
    if (!snapRow) {
      return { success: false, message: "戻せる配置がありません（まだ席替えを保存していません）" };
    }
    const snapshotAt = String((snapRow as { saved_at?: string }).saved_at ?? "");
    const restoreAll = parseSnapshotAssignments((snapRow as { assignments?: unknown }).assignments);

    // 消えた席には戻せない（座席レイアウトを編集した場合）。黙って落とさず件数を返す
    let restore = restoreAll;
    let skipped = 0;
    if (restoreAll.length > 0) {
      const { data: seatRows, error: seatErr } = await admin
        .from("seats").select("id").eq("project_id", projectId);
      if (seatErr) {
        return { success: false, message: `座席の確認に失敗しました: ${seatErr.message}` };
      }
      const seatIds = new Set((seatRows ?? []).map(s => s.id as string));
      restore = restoreAll.filter(r => seatIds.has(r.seat_id));
      skipped = restoreAll.length - restore.length;
    }

    // ② いまの配置を控える（＝次の退避＝もう一度押したときに戻る先）
    const { data: currentRows, error: curErr } = await admin
      .from("seat_assignments")
      .select("seat_id, staff_id")
      .eq("project_id", projectId)
      .eq("assignment_date", date);
    if (curErr) {
      return { success: false, message: `現在の配置の取得に失敗しました: ${curErr.message}` };
    }
    const beforeUndo: SeatSnapshotEntry[] = (currentRows ?? []).map(r => ({
      seat_id:  r.seat_id  as string,
      staff_id: r.staff_id as string,
    }));

    // ③ 入れ替え（削除 → 退避の内容を投入）
    const { error: delErr } = await admin
      .from("seat_assignments")
      .delete()
      .eq("project_id", projectId)
      .eq("assignment_date", date);
    if (delErr) {
      return { success: false, message: `現在の配置の削除に失敗しました: ${delErr.message}` };
    }

    if (restore.length > 0) {
      const { error: insErr } = await admin.from("seat_assignments").insert(
        restore.map(r => ({
          project_id:      projectId,
          seat_id:         r.seat_id,
          staff_id:        r.staff_id,
          assignment_date: date,
          created_by:      staffId,
        })),
      );
      if (insErr) {
        // 「消えただけ」で終わらせない。消した配置を戻してから失敗を返す
        if (beforeUndo.length > 0) {
          const { error: rollbackErr } = await admin.from("seat_assignments").insert(
            beforeUndo.map(r => ({
              project_id:      projectId,
              seat_id:         r.seat_id,
              staff_id:        r.staff_id,
              assignment_date: date,
              created_by:      staffId,
            })),
          );
          // 戻しにも失敗＝その日の配置が空のまま。黙って「元のまま」と言わない
          if (rollbackErr) {
            console.error("[undoSeatAssignmentsAction] 復元失敗後の切り戻しにも失敗", rollbackErr);
            return {
              success: false,
              message: `復元に失敗し、元の配置も戻せませんでした。座席が空になっています（組み直してください）: ${insErr.message}`,
            };
          }
        }
        return { success: false, message: `復元に失敗しました（配置は元のままです）: ${insErr.message}` };
      }
    }

    // ④ 退避を「戻す前の配置」で置き換える（トグル）
    try {
      await snapshotSeatAssignments(admin, projectId, date, staffId, beforeUndo);
    } catch (e) {
      // 復元自体は完了しているので失敗扱いにはしない（次の「元に戻す」が古い世代を指すだけ）
      console.error("[undoSeatAssignmentsAction] 退避の更新に失敗", e);
    }

    revalidatePath("/seating");
    revalidatePath("/seating/plan");
    revalidatePath("/attendance");

    return { success: true, restoredCount: restore.length, snapshotAt, skipped };
  } catch (e) {
    console.error("[undoSeatAssignmentsAction] failed", e);
    return {
      success: false,
      message: e instanceof Error ? e.message : "元に戻すのに失敗しました",
    };
  }
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

  const OFF_NAMES = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤", "希望休", "公募"];
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
