"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";

export type CorrectionResult = { success: boolean; message?: string };

/** 勤怠補正申請 */
export async function submitCorrectionAction(
  formData: FormData
): Promise<CorrectionResult> {
  const targetDate = String(formData.get("targetDate") ?? "").trim();
  const correctedIn = String(formData.get("correctedIn") ?? "").trim() || null;
  const correctedOut = String(formData.get("correctedOut") ?? "").trim() || null;
  const reason = String(formData.get("reason") ?? "").trim();

  if (!targetDate) return { success: false, message: "対象日は必須です" };
  if (!correctedIn && !correctedOut) return { success: false, message: "修正後の出勤または退勤時刻を入力してください" };
  if (!reason) return { success: false, message: "理由は必須です" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const { error } = await supabase.from("punch_corrections").insert({
    project_id: projectId,
    staff_id: staffId,
    target_date: targetDate,
    corrected_in: correctedIn,
    corrected_out: correctedOut,
    reason,
  });

  if (error) return { success: false, message: "申請失敗：" + error.message };

  revalidatePath("/corrections");
  return { success: true };
}

/** 申請を取り下げ（pending のみ） */
export async function withdrawCorrectionAction(
  formData: FormData
): Promise<CorrectionResult> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("punch_corrections")
    .delete()
    .eq("id", id)
    .eq("status", "pending");

  if (error) return { success: false, message: "取り下げ失敗：" + error.message };

  revalidatePath("/corrections");
  return { success: true };
}

/** 管理者：承認・却下 */
export async function reviewCorrectionAction(
  formData: FormData
): Promise<CorrectionResult> {
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  const reviewNote = String(formData.get("reviewNote") ?? "").trim() || null;

  if (!id || !["approved", "rejected"].includes(status)) {
    return { success: false, message: "不正なパラメータです" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const reviewerId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { error } = await supabase
    .from("punch_corrections")
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), review_note: reviewNote })
    .eq("id", id);

  if (error) return { success: false, message: "更新失敗：" + error.message };

  revalidatePath("/corrections/manage");
  return { success: true };
}
