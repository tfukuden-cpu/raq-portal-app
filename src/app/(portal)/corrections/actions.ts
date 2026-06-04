"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";
import { sendEventNotify } from "@/lib/notify";

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
  const admin = createAdminClient();

  // 申請内容を取得
  const { data: correction } = await admin
    .from("punch_corrections")
    .select("project_id, staff_id, target_date, corrected_in, corrected_out")
    .eq("id", id)
    .maybeSingle();

  if (!correction) return { success: false, message: "申請が見つかりません" };

  const { error } = await admin
    .from("punch_corrections")
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), review_note: reviewNote })
    .eq("id", id);

  if (error) return { success: false, message: "更新失敗：" + error.message };

  // 承認時は punch_logs を上書き
  if (status === "approved") {
    const { project_id, staff_id, target_date, corrected_in, corrected_out } = correction;
    const dateStr = target_date as string;
    const startISO = `${dateStr}T00:00:00+09:00`;
    const endISO   = `${dateStr}T23:59:59+09:00`;

    // 当日の出退勤打刻を削除して差し替え
    await admin.from("punch_logs")
      .delete()
      .eq("project_id", project_id)
      .eq("staff_id", staff_id)
      .in("punch_type", ["clock_in", "clock_out"])
      .gte("recorded_at", startISO)
      .lte("recorded_at", endISO);

    const inserts: { project_id: string; staff_id: string; punch_type: string; recorded_at: string; note: string }[] = [];
    // "HH:MM:SS" or "HH:MM" → slice to HH:MM before appending :00
    if (corrected_in) {
      inserts.push({
        project_id, staff_id,
        punch_type: "clock_in",
        recorded_at: `${dateStr}T${(corrected_in as string).slice(0, 5)}:00+09:00`,
        note: "勤怠補正申請による修正",
      });
    }
    if (corrected_out) {
      inserts.push({
        project_id, staff_id,
        punch_type: "clock_out",
        recorded_at: `${dateStr}T${(corrected_out as string).slice(0, 5)}:00+09:00`,
        note: "勤怠補正申請による修正",
      });
    }
    if (inserts.length > 0) {
      await admin.from("punch_logs").insert(inserts);
    }
  }

  // スタッフへLINE通知
  const { data: staffRow } = await admin.from("staffs").select("display_name, name").eq("id", correction.staff_id).maybeSingle();
  const staffName = (staffRow as { display_name?: string | null; name?: string | null } | null)?.display_name
    ?? (staffRow as { display_name?: string | null; name?: string | null } | null)?.name
    ?? correction.staff_id;
  await sendEventNotify(
    correction.project_id as string,
    "correction_result",
    { 名前: staffName, 日付: correction.target_date as string, 結果: status === "approved" ? "承認" : "却下" },
    correction.staff_id as string,
  );

  revalidatePath("/corrections/manage");
  return { success: true };
}
