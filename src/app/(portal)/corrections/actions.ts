"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";
import { sendEventNotify } from "@/lib/notify";
import { pushLineWithButton } from "@/lib/line";

export type CorrectionResult = { success: boolean; message?: string };

const APP_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app";

/** 管理者グループLINEへ申請通知（失敗しても本体は成功扱い） */
export async function notifyAdminGroupPunchRequest(projectId: string, text: string): Promise<void> {
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
    console.error("[corrections] notifyAdminGroupPunchRequest failed:", e);
  }
}

/** 勤怠補正申請 */
export async function submitCorrectionAction(
  formData: FormData
): Promise<CorrectionResult> {
  const targetDate = String(formData.get("targetDate") ?? "").trim();
  const correctedIn = String(formData.get("correctedIn") ?? "").trim() || null;
  const correctedOut = String(formData.get("correctedOut") ?? "").trim() || null;
  const reason = String(formData.get("reason") ?? "").trim();
  const svName = String(formData.get("svName") ?? "").trim();

  if (!targetDate) return { success: false, message: "対象日は必須です" };
  if (!correctedIn && !correctedOut) return { success: false, message: "修正後の出勤または退勤時刻を入力してください" };
  if (!reason) return { success: false, message: "理由は必須です" };
  if (!svName) return { success: false, message: "依頼したSVの名前は必須です" };

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
    sv_name: svName,
  });

  if (error) return { success: false, message: "申請失敗：" + error.message };

  // 管理者グループLINEへ即通知（当日中の承認を促す）
  {
    const admin = createAdminClient();
    const { data: staffRow } = await admin.from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
    const name = (staffRow as { display_name?: string | null; name?: string | null } | null)?.display_name
      ?? (staffRow as { display_name?: string | null; name?: string | null } | null)?.name ?? staffId;
    const times = [correctedIn ? `出勤 ${correctedIn.slice(0, 5)}` : null, correctedOut ? `退勤 ${correctedOut.slice(0, 5)}` : null]
      .filter(Boolean).join(" / ");
    await notifyAdminGroupPunchRequest(
      projectId,
      `⚠ 打刻修正申請が届きました\n【名前】${name}\n【対象日】${targetDate}\n【修正】${times}\n【理由】${reason}\n【依頼SV】${svName}\n当日中の承認をお願いします。`,
    );
  }

  revalidatePath("/corrections");
  return { success: true };
}

/** 管理者：遅刻申請（打刻時に自動作成されたもの）の承認・却下 */
export async function reviewLateRequestAction(
  formData: FormData
): Promise<CorrectionResult> {
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  if (!id || !["approved", "rejected"].includes(status)) {
    return { success: false, message: "不正なパラメータです" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };
  const reviewerId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  // サーバー側管理者チェック
  const admin = createAdminClient();
  const { data: target } = await admin
    .from("late_reports").select("project_id").eq("id", id).maybeSingle();
  if (!target) return { success: false, message: "申請が見つかりません" };
  const projectId = (target as { project_id: string }).project_id;

  const { data: me } = await supabase.from("staffs").select("global_role").eq("id", reviewerId).maybeSingle();
  const isGlobal = me?.global_role === "executive" || me?.global_role === "admin";
  if (!isGlobal) {
    const { data: membership } = await supabase
      .from("project_members").select("role")
      .eq("staff_id", reviewerId).eq("project_id", projectId).maybeSingle();
    if (membership?.role !== "project_admin") return { success: false, message: "権限がありません" };
  }

  const { error } = await admin
    .from("late_reports")
    .update({ status, approved_by: reviewerId, approved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { success: false, message: "更新失敗：" + error.message };

  revalidatePath("/attendance/edit");
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
