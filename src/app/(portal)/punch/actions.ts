/**
 * 打刻アクション
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseBreakRoomBox } from "@/lib/break-room";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";
import { sendEventNotify } from "@/lib/notify";

export type PunchType =
  | "clock_in"
  | "clock_out"
  | "break_start"
  | "break_end";

export type PunchResult = {
  success: boolean;
  message?: string;
};

const PUNCH_LABEL: Record<PunchType, string> = {
  clock_in:    "出勤",
  clock_out:   "退勤",
  break_start: "休憩開始",
  break_end:   "休憩終了",
};

export async function recordPunchAction(
  formData: FormData
): Promise<PunchResult> {
  const punchType    = String(formData.get("punchType")    ?? "") as PunchType;
  const punchKind    = String(formData.get("punchKind")    ?? "").trim();
  const approverName = String(formData.get("approverName") ?? "").trim();

  if (!["clock_in", "clock_out", "break_start", "break_end"].includes(punchType)) {
    return { success: false, message: "不正な打刻種別です" };
  }
  if ((punchKind === "早退" || punchKind === "残業") && !approverName) {
    return { success: false, message: "承認者を選択してください" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const { error } = await supabase.from("punch_logs").insert({
    project_id:    projectId,
    staff_id:      staffId,
    punch_type:    punchType,
    note:          punchKind    || null,
    approver_name: approverName || null,
  });

  if (error) {
    console.error("punch error:", error);
    return { success: false, message: "打刻に失敗しました：" + error.message };
  }

  // 休憩終了・退勤時は休憩室の箱を自動解放（RLSをバイパスするため admin 経由）
  if (punchType === "break_end" || punchType === "clock_out") {
    const todayJST = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    await releaseBreakRoomBox(createAdminClient(), projectId, staffId, todayJST);
  }

  revalidatePath("/punch");
  revalidatePath("/dashboard");

  // LINE通知：出勤・退勤のみ管理者へ通知（休憩は除外）
  if (punchType === "clock_in" || punchType === "clock_out") {
    const { data: staffData } = await supabase
      .from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
    const name   = staffData?.display_name ?? staffData?.name ?? staffId;
    const timeJST = new Date().toLocaleTimeString("ja-JP", {
      timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit",
    });

    void sendEventNotify(projectId, "clock", {
      "名前": name,
      "時刻": timeJST,
      "種別": PUNCH_LABEL[punchType],
    });
  }

  return { success: true, message: `${PUNCH_LABEL[punchType]}を記録しました` };
}
