"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEventNotify } from "@/lib/notify";
import { revalidatePath } from "next/cache";

export type TerminalPunchResult = { ok: boolean; message: string };

/**
 * 現場端末用打刻アクション（認証不要・adminClient使用）
 */
export async function terminalPunchAction(
  projectId: string,
  staffId: string,
  punchType: "clock_in" | "clock_out",
  punchKind: "normal" | "late" | "early", // 定時/遅刻/早退
  approverName?: string,                   // 遅刻・早退時の承認SV名
): Promise<TerminalPunchResult> {
  if (!projectId || !staffId) {
    return { ok: false, message: "パラメータが不正です" };
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // note: 遅刻 [承認: 田中SV] / 早退 [承認: 田中SV]
  const baseNote = punchKind === "late" ? "遅刻" : punchKind === "early" ? "早退" : null;
  const note = baseNote && approverName
    ? `${baseNote} [承認: ${approverName}]`
    : baseNote;

  const { error } = await admin.from("punch_logs").insert({
    project_id: projectId,
    staff_id:   staffId,
    punch_type: punchType,
    note,
  });

  if (error) {
    return { ok: false, message: "打刻に失敗しました: " + error.message };
  }

  revalidatePath(`/attendance`);

  // LINE通知
  const LABEL = { clock_in: "出勤", clock_out: "退勤" } as const;
  const { data: staffData } = await admin
    .from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
  const name    = staffData?.display_name ?? staffData?.name ?? staffId;
  const timeJST = new Date(now).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit",
  });
  void sendEventNotify(projectId, "clock", {
    "名前": name,
    "時刻": timeJST,
    "種別": LABEL[punchType],
  });

  const kindLabel = punchKind === "late" ? "（遅刻）" : punchKind === "early" ? "（早退）" : "";
  return { ok: true, message: `${LABEL[punchType]}${kindLabel}を記録しました` };
}
