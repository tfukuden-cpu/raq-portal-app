"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEventNotify } from "@/lib/notify";
import { revalidatePath } from "next/cache";

export type TerminalPunchResult = { ok: boolean; message: string };
export type PunchKind = "normal" | "late" | "early" | "overtime";

// ── 打刻時刻の丸め処理 ─────────────────────────────────────────

/** JST の現在時刻を 15分単位で切り上げた ISO 文字列を返す */
function ceil15minISO(): string {
  const now  = new Date();
  const date = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // YYYY-MM-DD
  const hhmm = now.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = hhmm.split(":").map(Number);
  const rounded = Math.ceil((h * 60 + m) / 15) * 15;
  const rh = Math.floor(rounded / 60) % 24;
  const rm = rounded % 60;
  return `${date}T${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}:00+09:00`;
}

/** JST の現在時刻を 15分単位で切り下げた ISO 文字列を返す */
function floor15minISO(): string {
  const now  = new Date();
  const date = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // YYYY-MM-DD
  const hhmm = now.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = hhmm.split(":").map(Number);
  const rounded = Math.floor((h * 60 + m) / 15) * 15;
  const rh = Math.floor(rounded / 60) % 24;
  const rm = rounded % 60;
  return `${date}T${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}:00+09:00`;
}

/** シフト時刻（"HH:MM" または "HH:MM:SS"）を今日の JST ISO 文字列に変換 */
function shiftTimeToISO(shiftTime: string): string {
  const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // YYYY-MM-DD
  const [h, m] = shiftTime.split(":").map(Number);
  return `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`;
}

/**
 * punchKind と shift 時刻から記録すべき打刻時刻を決定する
 *   normal   → シフト開始/終了時刻
 *   late     → 15分繰り上げ（ceil）
 *   early    → 15分切り下げ（floor）
 *   overtime → 15分切り下げ（floor）
 */
function resolveRecordedAt(
  punchType: "clock_in" | "clock_out",
  punchKind: PunchKind,
  shiftStart: string | null | undefined,
  shiftEnd:   string | null | undefined,
): string {
  if (punchKind === "normal") {
    if (punchType === "clock_in"  && shiftStart) return shiftTimeToISO(shiftStart);
    if (punchType === "clock_out" && shiftEnd)   return shiftTimeToISO(shiftEnd);
    return new Date().toISOString();
  }
  if (punchKind === "late")     return ceil15minISO();
  if (punchKind === "early")    return floor15minISO();
  if (punchKind === "overtime") return new Date().toISOString(); // 残業は実打刻時刻
  return new Date().toISOString();
}

/**
 * 現場端末用打刻アクション（認証不要・adminClient使用）
 */
export async function terminalPunchAction(
  projectId:  string,
  staffId:    string,
  punchType:  "clock_in" | "clock_out",
  punchKind:  PunchKind,
  approverName?: string,
  shiftStart?: string | null,
  shiftEnd?:   string | null,
): Promise<TerminalPunchResult> {
  if (!projectId || !staffId) {
    return { ok: false, message: "パラメータが不正です" };
  }

  const admin = createAdminClient();

  // 打刻時刻を決定
  const recordedAt = resolveRecordedAt(punchType, punchKind, shiftStart, shiftEnd);

  const actualTimeJST = new Date().toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit",
  });
  const punchLabel = punchType === "clock_in" ? "出勤打刻" : "退勤打刻";
  const parts: string[] = [`${punchLabel}: ${actualTimeJST}`];
  if (punchType === "clock_out") {
    if (punchKind === "early" && approverName) parts.push(`早退承認者: ${approverName}`);
    if (punchKind === "overtime" && approverName) parts.push(`残業承認者: ${approverName}`);
  }
  const note = parts.length > 1 ? parts.join("  ") : parts[0];

  const { error } = await admin.from("punch_logs").insert({
    project_id:  projectId,
    staff_id:    staffId,
    punch_type:  punchType,
    recorded_at: recordedAt,
    note,
  });

  if (error) {
    return { ok: false, message: "打刻に失敗しました: " + error.message };
  }

  revalidatePath(`/attendance`);

  const LABEL = { clock_in: "出勤", clock_out: "退勤" } as const;
  const { data: staffData } = await admin
    .from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
  const name    = staffData?.display_name ?? staffData?.name ?? staffId;
  const timeJST = new Date(recordedAt).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit",
  });
  void sendEventNotify(projectId, "clock", {
    "名前": name,
    "時刻": timeJST,
    "種別": LABEL[punchType],
  });

  const kindLabel: Record<PunchKind, string> = {
    normal: "", late: "（遅刻）", early: "（早退）", overtime: "（残業）",
  };
  return { ok: true, message: `${LABEL[punchType]}${kindLabel[punchKind]}を記録しました` };
}

/**
 * 現場端末用休憩トグルアクション（認証不要・adminClient使用）
 */
export async function terminalBreakAction(
  projectId: string,
  staffId: string,
  breakNote?: string,
): Promise<{ ok: boolean; message: string; newStatus?: "on_break" | "working" }> {
  if (!projectId || !staffId) {
    return { ok: false, message: "パラメータが不正です" };
  }
  const admin = createAdminClient();
  const today      = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
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
    note:        !isOnBreak && breakNote ? breakNote : null,
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath(`/punch/${projectId}`);
  return {
    ok: true,
    message: isOnBreak ? "離席を終了しました" : `${breakNote ?? "離席"}を記録しました`,
    newStatus: isOnBreak ? "working" : "on_break",
  };
}

/**
 * 同意書サイン保存（当月初回打刻時）
 */
export async function saveConsentAction(
  projectId: string,
  staffId: string,
  signatureData: string,
): Promise<{ ok: boolean }> {
  if (!projectId || !staffId || !signatureData) return { ok: false };

  const admin = createAdminClient();
  const consentMonth = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).slice(0, 7);

  const { error } = await admin.from("consent_records").upsert(
    {
      staff_id:       staffId,
      project_id:     projectId,
      consent_month:  consentMonth,
      confirmed_name: signatureData, // 名前テキストを保存
      signed_at:      new Date().toISOString(),
    },
    { onConflict: "staff_id,project_id,consent_month" }
  );

  return { ok: !error };
}
