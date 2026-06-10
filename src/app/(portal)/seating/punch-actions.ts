"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { releaseBreakRoomBox } from "@/lib/break-room";
import { revalidatePath } from "next/cache";

function tokyoToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function dayRange(today: string) {
  return {
    start: `${today}T00:00:00+09:00`,
    end:   `${today}T23:59:59+09:00`,
  };
}

// ── 型定義 ────────────────────────────────────────────────

export type PunchResult = { ok: boolean; error?: string };

export type BreakRecord = {
  startId:   string;
  startTime: string;        // ISO
  endId:     string | null;
  endTime:   string | null; // ISO
};

export type StaffPunchSummary = {
  clockInId:      string | null;
  clockIn:        string | null;
  clockOutId:     string | null;
  clockOut:       string | null;
  isOnBreak:      boolean;
  isOnSeatLeave:  boolean;
  breakStartTime: string | null;
  seatLeaveTime:  string | null;
  breakCount:     number;
  breakRecords:   BreakRecord[];
  derivedStatus:  "not_arrived" | "working" | "on_break" | "seat_leave" | "clocked_out";
};

// ── 打刻詳細取得 ──────────────────────────────────────────
export async function getStaffPunchSummaryAction(
  projectId: string,
  staffId: string,
): Promise<StaffPunchSummary> {
  const admin = createAdminClient();
  const today = tokyoToday();
  const { start, end } = dayRange(today);

  const { data: logs } = await admin
    .from("punch_logs")
    .select("id, punch_type, recorded_at, note")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .gte("recorded_at", start)
    .lte("recorded_at", end)
    .order("recorded_at");

  let clockInId:      string | null = null;
  let clockIn:        string | null = null;
  let clockOutId:     string | null = null;
  let clockOut:       string | null = null;
  let isOnBreak      = false;
  let isOnSeatLeave  = false;
  let breakStartTime: string | null = null;
  let seatLeaveTime:  string | null = null;
  let breakCount     = 0;
  const breakRecords: BreakRecord[] = [];
  let currentBreak:  { id: string; time: string } | null = null;

  for (const l of logs ?? []) {
    switch (l.punch_type) {
      case "clock_in":
        // 管理者補正(note=admin_manual)は実打刻として扱わない＝スタッフ本人が出勤打刻できる
        if ((l as { note?: string | null }).note === "admin_manual") break;
        clockInId = l.id; clockIn = l.recorded_at; break;
      case "clock_out":
        clockOutId = l.id; clockOut = l.recorded_at; break;
      case "break_start":
        isOnBreak = true; breakStartTime = l.recorded_at; breakCount++;
        currentBreak = { id: l.id, time: l.recorded_at };
        break;
      case "break_end":
        isOnBreak = false; breakStartTime = null;
        if (currentBreak) {
          breakRecords.push({ startId: currentBreak.id, startTime: currentBreak.time, endId: l.id, endTime: l.recorded_at });
          currentBreak = null;
        }
        break;
      case "seat_leave":  isOnSeatLeave = true;  seatLeaveTime = l.recorded_at; break;
      case "seat_return": isOnSeatLeave = false; seatLeaveTime = null; break;
    }
  }
  // 終了していない休憩
  if (currentBreak) {
    breakRecords.push({ startId: currentBreak.id, startTime: currentBreak.time, endId: null, endTime: null });
  }

  let derivedStatus: StaffPunchSummary["derivedStatus"];
  if (!clockIn)           derivedStatus = "not_arrived";
  else if (clockOut)      derivedStatus = "clocked_out";
  else if (isOnBreak)     derivedStatus = "on_break";
  else if (isOnSeatLeave) derivedStatus = "seat_leave";
  else                    derivedStatus = "working";

  return {
    clockInId, clockIn, clockOutId, clockOut,
    isOnBreak, isOnSeatLeave, breakStartTime, seatLeaveTime,
    breakCount, breakRecords, derivedStatus,
  };
}

// ── 打刻時刻を管理者が手動修正 ────────────────────────────
export async function updatePunchLogTimeAction(
  punchLogId: string,
  newTimeHHMM: string, // "HH:MM"（当日JST）
): Promise<PunchResult> {
  const admin = createAdminClient();
  const today = tokyoToday();
  const [hh, mm] = newTimeHHMM.split(":").map(Number);
  const newISO = new Date(`${today}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00+09:00`).toISOString();

  const { error } = await admin
    .from("punch_logs")
    .update({ recorded_at: newISO })
    .eq("id", punchLogId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/seating");
  return { ok: true };
}

// ── 打刻レコードを管理者が削除 ────────────────────────────
export async function deletePunchLogAction(
  punchLogId: string,
): Promise<PunchResult> {
  const admin = createAdminClient();
  const { error } = await admin.from("punch_logs").delete().eq("id", punchLogId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/seating");
  return { ok: true };
}

// 15分切り上げ
function ceil15min(now: Date, today: string): string {
  const hhmm = now.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = hhmm.split(":").map(Number);
  const rounded = Math.ceil((h * 60 + m) / 15) * 15;
  const rh = Math.floor(rounded / 60) % 24;
  const rm = rounded % 60;
  return `${today}T${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}:00+09:00`;
}

// 15分切り下げ
function floor15min(now: Date, today: string): string {
  const hhmm = now.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = hhmm.split(":").map(Number);
  const rounded = Math.floor((h * 60 + m) / 15) * 15;
  const rh = Math.floor(rounded / 60) % 24;
  const rm = rounded % 60;
  return `${today}T${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}:00+09:00`;
}

// 実打刻時刻の HH:MM 文字列
function actualTimeHHMM(now: Date): string {
  return now.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
}

// ── 出勤打刻 ──────────────────────────────────────────────
// 開始時刻より前 → 開始時刻に補正（実打刻をnoteに記録）
// 開始時刻より後 → 遅刻として15分切り上げ（実打刻をnoteに記録）
export async function clockInAction(
  projectId: string,
  staffId: string,
  shiftStartHHMM: string | null,
): Promise<PunchResult> {
  const admin = createAdminClient();
  const today = tokyoToday();
  const { start, end } = dayRange(today);

  const { data: existing } = await admin
    .from("punch_logs")
    .select("id")
    .eq("project_id", projectId).eq("staff_id", staffId)
    .eq("punch_type", "clock_in")
    .gte("recorded_at", start).lte("recorded_at", end)
    .maybeSingle();
  if (existing) return { ok: false, error: "既に出勤打刻済みです" };

  const now = new Date();
  const actualTime = actualTimeHHMM(now);
  let recordedAt = now.toISOString();
  const note = `出勤打刻: ${actualTime}`;

  if (shiftStartHHMM) {
    const [hh, mm] = shiftStartHHMM.split(":").map(Number);
    const shiftStart = new Date(`${today}T${pad(hh)}:${pad(mm)}:00+09:00`);
    if (now < shiftStart) {
      // 早め打刻 → シフト開始時刻に補正
      recordedAt = shiftStart.toISOString();
    } else {
      // 遅刻 → 15分切り上げ
      recordedAt = ceil15min(now, today);
    }
  }

  const { error } = await admin.from("punch_logs").insert({
    project_id: projectId, staff_id: staffId,
    punch_type: "clock_in", recorded_at: recordedAt, note,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/seating");
  return { ok: true };
}

export type ClockOutJudgment = "early_leave" | "on_time" | "overtime_choice";

// ── 退勤打刻（早退/定時/残業の選択式）────────────────────
// mode="early_leave" → 15分切り下げ・承認者名必須
// mode="on_time"     → シフト終了時刻
// mode="overtime"    → 実打刻時刻・承認者名必須
export async function clockOutAction(
  projectId: string,
  staffId: string,
  shiftEndHHMM: string | null,
  mode: "early_leave" | "on_time" | "overtime",
  signerName?: string,
  reason?: string,
): Promise<PunchResult> {
  const admin = createAdminClient();
  const today = tokyoToday();
  const { start, end } = dayRange(today);
  const now = new Date();
  const actualTime = actualTimeHHMM(now);

  let recordedAt = now.toISOString();
  const parts: string[] = [`退勤打刻: ${actualTime}`];
  let note: string;

  if (mode === "early_leave") {
    recordedAt = floor15min(now, today);
    if (signerName) parts.push(`早退承認者: ${signerName}`);
    note = parts.join("  ");
  } else if (mode === "on_time" && shiftEndHHMM) {
    const [hh, mm] = shiftEndHHMM.split(":").map(Number);
    recordedAt = new Date(`${today}T${pad(hh)}:${pad(mm)}:00+09:00`).toISOString();
    note = parts.join("  ");
  } else if (mode === "overtime") {
    recordedAt = now.toISOString();
    if (signerName) parts.push(`残業承認者: ${signerName}`);
    note = parts.join("  ");
  } else {
    note = parts.join("  ");
  }

  // 進行中の break/seat_leave を自動終了
  const latestPunch = await getLatestOfTypes(admin, projectId, staffId, start, end,
    ["break_start", "break_end", "seat_leave", "seat_return"]);
  const inserts: object[] = [];
  if (latestPunch === "break_start") {
    inserts.push({ project_id: projectId, staff_id: staffId, punch_type: "break_end", recorded_at: recordedAt });
  }
  if (latestPunch === "seat_leave") {
    inserts.push({ project_id: projectId, staff_id: staffId, punch_type: "seat_return", recorded_at: recordedAt });
  }
  inserts.push({ project_id: projectId, staff_id: staffId, punch_type: "clock_out", recorded_at: recordedAt, note });

  const { error } = await admin.from("punch_logs").insert(inserts);
  if (error) return { ok: false, error: error.message };

  // 休憩室の箱を自動解放（休憩中のまま退勤した場合の取り残し防止）
  await releaseBreakRoomBox(admin, projectId, staffId, today);

  if ((mode === "overtime" || mode === "early_leave") && shiftEndHHMM && signerName) {
    await admin.from("work_exception_requests").insert({
      project_id: projectId, staff_id: staffId,
      request_type: mode === "overtime" ? "overtime" : "early_leave",
      shift_date: today,
      shift_end_time: shiftEndHHMM + ":00",
      actual_punch_time: now.toISOString(),
      signer_name: signerName,
      reason: reason ?? null,
      status: "pending",
    });
  }

  revalidatePath("/seating");
  return { ok: true };
}

// ── 早退申請（退勤打刻含む） ──────────────────────────────
export async function earlyLeaveAction(
  projectId: string,
  staffId: string,
  shiftEndHHMM: string,
  signerName: string,
  reason?: string,
): Promise<PunchResult> {
  const admin = createAdminClient();
  const today = tokyoToday();
  const { start, end } = dayRange(today);
  const now = new Date();

  // 進行中 break/seat_leave を自動終了してから退勤
  const latestPunch = await getLatestOfTypes(admin, projectId, staffId, start, end,
    ["break_start", "break_end", "seat_leave", "seat_return"]);
  const inserts: object[] = [];
  if (latestPunch === "break_start") {
    inserts.push({ project_id: projectId, staff_id: staffId, punch_type: "break_end", recorded_at: now.toISOString() });
  }
  if (latestPunch === "seat_leave") {
    inserts.push({ project_id: projectId, staff_id: staffId, punch_type: "seat_return", recorded_at: now.toISOString() });
  }
  inserts.push({ project_id: projectId, staff_id: staffId, punch_type: "clock_out", recorded_at: now.toISOString() });

  const { error } = await admin.from("punch_logs").insert(inserts);
  if (error) return { ok: false, error: error.message };

  // 休憩室の箱を自動解放
  await releaseBreakRoomBox(admin, projectId, staffId, today);

  await admin.from("work_exception_requests").insert({
    project_id: projectId, staff_id: staffId,
    request_type: "early_leave",
    shift_date: today,
    shift_end_time: shiftEndHHMM + ":00",
    actual_punch_time: now.toISOString(),
    signer_name: signerName,
    reason: reason ?? null,
    status: "pending",
  });

  revalidatePath("/seating");
  return { ok: true };
}

// ── 離席 ─────────────────────────────────────────────────
export async function seatLeaveAction(projectId: string, staffId: string): Promise<PunchResult> {
  const admin = createAdminClient();
  const { error } = await admin.from("punch_logs").insert({
    project_id: projectId, staff_id: staffId,
    punch_type: "seat_leave", recorded_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/seating");
  return { ok: true };
}

// ── 着席戻り ──────────────────────────────────────────────
export async function seatReturnAction(projectId: string, staffId: string): Promise<PunchResult> {
  const admin = createAdminClient();
  const { error } = await admin.from("punch_logs").insert({
    project_id: projectId, staff_id: staffId,
    punch_type: "seat_return", recorded_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/seating");
  return { ok: true };
}

// ── 休憩開始 ──────────────────────────────────────────────
// 1回目=休憩(60分)、2回目以降=小休憩(15分)
export async function breakStartAction(
  projectId: string,
  staffId: string,
): Promise<PunchResult & { breakType?: "regular" | "short"; limitMinutes?: number }> {
  const admin = createAdminClient();
  const today = tokyoToday();
  const { start, end } = dayRange(today);

  const { count } = await admin.from("punch_logs")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId).eq("staff_id", staffId)
    .eq("punch_type", "break_start")
    .gte("recorded_at", start).lte("recorded_at", end);

  const isFirst    = (count ?? 0) === 0;
  const breakType  = isFirst ? "regular" : "short";
  const limitMinutes = isFirst ? 60 : 15;

  const { error } = await admin.from("punch_logs").insert({
    project_id: projectId, staff_id: staffId,
    punch_type: "break_start", recorded_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/seating");
  return { ok: true, breakType, limitMinutes };
}

// ── 休憩戻り ──────────────────────────────────────────────
export async function breakEndAction(projectId: string, staffId: string): Promise<PunchResult> {
  const admin = createAdminClient();
  const { error } = await admin.from("punch_logs").insert({
    project_id: projectId, staff_id: staffId,
    punch_type: "break_end", recorded_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  // 休憩室の箱を自動解放
  await releaseBreakRoomBox(admin, projectId, staffId, tokyoToday());
  revalidatePath("/seating");
  return { ok: true };
}

// ── 休憩リセット（進行中の break_start を1件削除） ────────
export async function breakResetAction(projectId: string, staffId: string): Promise<PunchResult> {
  const admin = createAdminClient();
  const today = tokyoToday();
  const { start, end } = dayRange(today);

  const { data: latest } = await admin.from("punch_logs")
    .select("id, punch_type")
    .eq("project_id", projectId).eq("staff_id", staffId)
    .in("punch_type", ["break_start", "break_end"])
    .gte("recorded_at", start).lte("recorded_at", end)
    .order("recorded_at", { ascending: false })
    .limit(1);

  if (!latest?.[0] || latest[0].punch_type !== "break_start") {
    return { ok: false, error: "進行中の休憩がありません" };
  }

  const { error } = await admin.from("punch_logs").delete().eq("id", latest[0].id);
  if (error) return { ok: false, error: error.message };
  // 休憩リセット時も休憩室の箱を解放
  await releaseBreakRoomBox(admin, projectId, staffId, today);
  revalidatePath("/seating");
  return { ok: true };
}

// ── 勤怠申請の承認/却下（管理者） ────────────────────────
export async function updateExceptionStatusAction(
  requestId: string,
  status: "approved" | "rejected",
): Promise<PunchResult> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("work_exception_requests")
    .update({ status })
    .eq("id", requestId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── 休憩持ち時間（分数）の取得 ────────────────────────────
// 優先順: 個人オーバーライド → スロット時間幅 → デフォルト(60/15)
export async function getBreakDurationAction(
  projectId: string,
  staffId: string,
  date?: string,
): Promise<{ regularMinutes: number; shortMinutes: number }> {
  const admin = createAdminClient();
  const today = date ?? tokyoToday();

  // ① 個人オーバーライドを確認
  const { data: override } = await admin
    .from("staff_break_overrides")
    .select("regular_minutes, short_minutes")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .eq("override_date", today)
    .maybeSingle();

  if (override) {
    return {
      regularMinutes: (override as { regular_minutes?: number }).regular_minutes ?? 60,
      shortMinutes:   (override as { short_minutes?: number }).short_minutes   ?? 15,
    };
  }

  // ② スロット割当から時間幅を計算
  const { data: slotAssign } = await admin
    .from("break_slot_assignments")
    .select("slot_number")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .eq("assignment_date", today)
    .maybeSingle();

  if (slotAssign) {
    const slotNum = (slotAssign as { slot_number?: number }).slot_number;
    if (slotNum) {
      const { data: slotSetting } = await admin
        .from("break_slot_settings")
        .select("start_time, end_time")
        .eq("project_id", projectId)
        .eq("slot_number", slotNum)
        .maybeSingle();

      if (slotSetting) {
        const [sh, sm] = ((slotSetting as { start_time: string }).start_time).split(":").map(Number);
        const [eh, em] = ((slotSetting as { end_time:   string }).end_time).split(":").map(Number);
        const slotMinutes = (eh * 60 + em) - (sh * 60 + sm);
        if (slotMinutes > 0) return { regularMinutes: slotMinutes, shortMinutes: 15 };
      }
    }
  }

  // ③ デフォルト
  return { regularMinutes: 60, shortMinutes: 15 };
}

// ── 休憩持ち時間（分数）の設定（管理者） ─────────────────
export async function setBreakDurationAction(
  projectId: string,
  staffId: string,
  regularMinutes: number,
  shortMinutes: number,
  date?: string,
): Promise<PunchResult> {
  const admin = createAdminClient();
  const today = date ?? tokyoToday();

  const { error } = await admin
    .from("staff_break_overrides")
    .upsert(
      { project_id: projectId, staff_id: staffId, override_date: today, regular_minutes: regularMinutes, short_minutes: shortMinutes },
      { onConflict: "project_id,staff_id,override_date" },
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── 当日の休憩スロット割り当てを取得 ─────────────────────
// .maybeSingle() は複数行あると null を返すため .limit(1) を使用
export async function getBreakSlotAssignmentAction(
  projectId: string,
  staffId: string,
  date?: string,
): Promise<number | null> {
  const admin = createAdminClient();
  const today = date ?? tokyoToday();
  const { data } = await admin
    .from("break_slot_assignments")
    .select("slot_number")
    .eq("staff_id", staffId)
    .eq("assignment_date", today)
    .limit(1);
  const rows = data as { slot_number?: number }[] | null;
  return rows?.[0]?.slot_number ?? null;
}

// ── 休憩スロット割り当てを変更（管理者） ─────────────────
export async function setBreakSlotAction(
  projectId: string,
  staffId: string,
  date: string,
  slotNumber: number | null,
): Promise<PunchResult> {
  const admin = createAdminClient();
  if (slotNumber === null) {
    const { error } = await admin.from("break_slot_assignments")
      .delete()
      .eq("project_id", projectId).eq("staff_id", staffId).eq("assignment_date", date);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin.from("break_slot_assignments")
      .upsert(
        { project_id: projectId, staff_id: staffId, assignment_date: date, slot_number: slotNumber },
        { onConflict: "project_id,assignment_date,staff_id" },
      );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/seating");
  return { ok: true };
}

// ── ヘルパー ──────────────────────────────────────────────
function pad(n: number) { return String(n).padStart(2, "0"); }

async function getLatestOfTypes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  projectId: string,
  staffId: string,
  start: string,
  end: string,
  types: string[],
): Promise<string | null> {
  const { data } = await admin.from("punch_logs")
    .select("punch_type")
    .eq("project_id", projectId).eq("staff_id", staffId)
    .in("punch_type", types)
    .gte("recorded_at", start).lte("recorded_at", end)
    .order("recorded_at", { ascending: false })
    .limit(1);
  return data?.[0]?.punch_type ?? null;
}
