"use server";

import { createAdminClient } from "@/lib/supabase/admin";
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

export type StaffPunchSummary = {
  clockIn:        string | null;
  clockOut:       string | null;
  isOnBreak:      boolean;
  isOnSeatLeave:  boolean;
  breakStartTime: string | null;
  seatLeaveTime:  string | null;
  breakCount:     number;
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
    .select("punch_type, recorded_at")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .gte("recorded_at", start)
    .lte("recorded_at", end)
    .order("recorded_at");

  let clockIn:        string | null = null;
  let clockOut:       string | null = null;
  let isOnBreak      = false;
  let isOnSeatLeave  = false;
  let breakStartTime: string | null = null;
  let seatLeaveTime:  string | null = null;
  let breakCount     = 0;

  for (const l of logs ?? []) {
    switch (l.punch_type) {
      case "clock_in":    clockIn = l.recorded_at; break;
      case "clock_out":   clockOut = l.recorded_at; break;
      case "break_start": isOnBreak = true;  breakStartTime = l.recorded_at; breakCount++; break;
      case "break_end":   isOnBreak = false; breakStartTime = null; break;
      case "seat_leave":  isOnSeatLeave = true;  seatLeaveTime = l.recorded_at; break;
      case "seat_return": isOnSeatLeave = false; seatLeaveTime = null; break;
    }
  }

  let derivedStatus: StaffPunchSummary["derivedStatus"];
  if (!clockIn)         derivedStatus = "not_arrived";
  else if (clockOut)    derivedStatus = "clocked_out";
  else if (isOnBreak)   derivedStatus = "on_break";
  else if (isOnSeatLeave) derivedStatus = "seat_leave";
  else                  derivedStatus = "working";

  return {
    clockIn, clockOut, isOnBreak, isOnSeatLeave,
    breakStartTime, seatLeaveTime, breakCount, derivedStatus,
  };
}

// ── 出勤打刻 ──────────────────────────────────────────────
// 開始時刻より前 → 開始時刻に補正
// 開始時刻より後 → 実打刻時刻
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
  let recordedAt = now.toISOString();

  if (shiftStartHHMM) {
    const [hh, mm] = shiftStartHHMM.split(":").map(Number);
    const shiftStart = new Date(`${today}T${pad(hh)}:${pad(mm)}:00+09:00`);
    if (now < shiftStart) recordedAt = shiftStart.toISOString();
  }

  const { error } = await admin.from("punch_logs").insert({
    project_id: projectId, staff_id: staffId,
    punch_type: "clock_in", recorded_at: recordedAt,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/seating");
  return { ok: true };
}

export type ClockOutJudgment = "early_leave" | "on_time" | "overtime_choice";

// ── 退勤打刻（定時・残業） ────────────────────────────────
// mode="on_time"   → 終了時刻に補正
// mode="overtime"  → 実打刻時刻 + 残業申請
export async function clockOutAction(
  projectId: string,
  staffId: string,
  shiftEndHHMM: string | null,
  mode: "on_time" | "overtime",
  signerName?: string,
  reason?: string,
): Promise<PunchResult> {
  const admin = createAdminClient();
  const today = tokyoToday();
  const { start, end } = dayRange(today);
  const now = new Date();

  let recordedAt = now.toISOString();
  if (mode === "on_time" && shiftEndHHMM) {
    const [hh, mm] = shiftEndHHMM.split(":").map(Number);
    recordedAt = new Date(`${today}T${pad(hh)}:${pad(mm)}:00+09:00`).toISOString();
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
  inserts.push({ project_id: projectId, staff_id: staffId, punch_type: "clock_out", recorded_at: recordedAt });

  const { error } = await admin.from("punch_logs").insert(inserts);
  if (error) return { ok: false, error: error.message };

  if (mode === "overtime" && shiftEndHHMM && signerName) {
    await admin.from("work_exception_requests").insert({
      project_id: projectId, staff_id: staffId,
      request_type: "overtime",
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
