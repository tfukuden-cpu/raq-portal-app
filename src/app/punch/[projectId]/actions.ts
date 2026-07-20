"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { releaseBreakRoomBox } from "@/lib/break-room";
import { sendEventNotify } from "@/lib/notify";
import { pushLineWithButton } from "@/lib/line";
import { revalidatePath } from "next/cache";

const APP_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app";

/** 管理者グループLINEへ申請通知（失敗しても本体は成功扱い） */
async function notifyAdminGroup(projectId: string, text: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: ps } = await admin
      .from("project_settings")
      .select("line_group_id")
      .eq("project_id", projectId)
      .maybeSingle();
    const groupId = (ps as { line_group_id?: string | null } | null)?.line_group_id;
    if (!groupId) return;
    await pushLineWithButton(groupId, text, "承認画面を開く", `${APP_URL}/attendance/edit?tab=corrections`);
  } catch (e) {
    console.error("[terminal] notifyAdminGroup failed:", e);
  }
}

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
  reason?: string,
): Promise<TerminalPunchResult> {
  if (!projectId || !staffId) {
    return { ok: false, message: "パラメータが不正です" };
  }
  // 遅刻打刻は申請制：依頼SVと理由が必須
  if (punchType === "clock_in" && punchKind === "late") {
    if (!approverName?.trim()) return { ok: false, message: "依頼SVの名前を入力してください" };
    if (!reason?.trim())       return { ok: false, message: "遅刻の理由を入力してください" };
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
  if (punchType === "clock_in" && punchKind === "late" && approverName) {
    parts.push(`遅刻依頼SV: ${approverName}`);
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

  // 退勤時は休憩室の箱を自動解放
  if (punchType === "clock_out") {
    const todayJST = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    await releaseBreakRoomBox(admin, projectId, staffId, todayJST);
  }

  // 遅刻打刻は「遅刻申請」を自動作成（管理者が当日中に承認する運用）
  if (punchType === "clock_in" && punchKind === "late") {
    try {
      const todayJST = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
      const { data: existing } = await admin
        .from("late_reports")
        .select("id, status")
        .eq("project_id", projectId)
        .eq("staff_id", staffId)
        .eq("late_date", todayJST)
        .limit(1);
      if (existing && existing.length > 0) {
        // ホームからの遅刻報告が既にある場合は申請情報を追記して承認待ちに
        await admin.from("late_reports").update({
          sv_name: approverName?.trim() ?? null,
          status: "pending",
          source: "punch",
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
        }).eq("id", (existing[0] as { id: string }).id);
      } else {
        await admin.from("late_reports").insert({
          project_id: projectId,
          staff_id:   staffId,
          late_date:  todayJST,
          reason:     reason?.trim() ?? null,
          sv_name:    approverName?.trim() ?? null,
          status:     "pending",
          source:     "punch",
        });
      }

      const { data: staffRow } = await admin.from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
      const staffName = (staffRow as { display_name?: string | null; name?: string | null } | null)?.display_name
        ?? (staffRow as { display_name?: string | null; name?: string | null } | null)?.name ?? staffId;
      await notifyAdminGroup(
        projectId,
        `⚠ 遅刻打刻の申請が届きました\n【名前】${staffName}\n【実打刻】${actualTimeJST}\n【理由】${reason?.trim() ?? "－"}\n【依頼SV】${approverName?.trim() ?? "－"}\n当日中の承認をお願いします。`,
      );
    } catch (e) {
      console.error("[terminal] late request create failed:", e);
    }
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

  // 離席終了（break_end）時は休憩室の箱を自動解放
  if (isOnBreak) {
    await releaseBreakRoomBox(admin, projectId, staffId, today);
  }

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

/**
 * 現場端末用：打刻漏れ申請（punch_corrections に pending で登録・承認で打刻反映）
 */
export async function terminalMissedPunchRequestAction(
  projectId: string,
  staffId: string,
  input: {
    targetDate: string;         // YYYY-MM-DD
    correctedIn?: string | null;  // HH:MM
    correctedOut?: string | null; // HH:MM
    reason: string;
    svName: string;
  },
): Promise<TerminalPunchResult> {
  if (!projectId || !staffId) return { ok: false, message: "パラメータが不正です" };
  const reason = (input.reason ?? "").trim();
  const svName = (input.svName ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) return { ok: false, message: "対象日が不正です" };
  if (!input.correctedIn && !input.correctedOut) return { ok: false, message: "出勤または退勤の時刻を入力してください" };
  if (!reason) return { ok: false, message: "理由を入力してください" };
  if (!svName) return { ok: false, message: "依頼SVの名前を入力してください" };

  const admin = createAdminClient();
  const { error } = await admin.from("punch_corrections").insert({
    project_id:    projectId,
    staff_id:      staffId,
    target_date:   input.targetDate,
    corrected_in:  input.correctedIn || null,
    corrected_out: input.correctedOut || null,
    reason:        `[打刻漏れ] ${reason}`,
    sv_name:       svName,
  });
  if (error) return { ok: false, message: "申請に失敗しました: " + error.message };

  const { data: staffRow } = await admin.from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
  const staffName = (staffRow as { display_name?: string | null; name?: string | null } | null)?.display_name
    ?? (staffRow as { display_name?: string | null; name?: string | null } | null)?.name ?? staffId;
  const times = [input.correctedIn ? `出勤 ${input.correctedIn}` : null, input.correctedOut ? `退勤 ${input.correctedOut}` : null]
    .filter(Boolean).join(" / ");
  await notifyAdminGroup(
    projectId,
    `⚠ 打刻漏れ申請が届きました\n【名前】${staffName}\n【対象日】${input.targetDate}\n【申請時刻】${times}\n【理由】${reason}\n【依頼SV】${svName}\n当日中の承認をお願いします（承認すると打刻に反映されます）。`,
  );

  return { ok: true, message: "打刻漏れ申請を送信しました（管理者の承認後に反映されます）" };
}
