"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";

export type HolidayResult = { success: boolean; message?: string };

/** 希望休を申請（複数日まとめて） */
export async function submitHolidayAction(
  formData: FormData
): Promise<HolidayResult> {
  const datesJson = String(formData.get("dates") ?? "[]");
  const note = String(formData.get("note") ?? "").trim() || null;

  let dates: string[] = [];
  try { dates = JSON.parse(datesJson); } catch { /* ignore */ }
  if (dates.length === 0) return { success: false, message: "日付を選択してください" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const rows = dates.map((d) => ({
    project_id: projectId,
    staff_id: staffId,
    request_date: d,
    note,
    status: "approved", // 承認フロー不要：申請即確定
  }));

  // RLS が status='approved' の直接挿入を弾くため admin client を使用
  const { error } = await createAdminClient().from("holiday_requests").insert(rows);
  if (error) return { success: false, message: "申請失敗：" + error.message };

  revalidatePath("/holidays");
  return { success: true };
}

/** 申請を取り下げ */
export async function withdrawHolidayAction(
  formData: FormData
): Promise<HolidayResult> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();
  const { error } = await supabase.from("holiday_requests").delete().eq("id", id);
  if (error) return { success: false, message: "取り下げ失敗：" + error.message };

  revalidatePath("/holidays");
  return { success: true };
}

/** 管理者：承認・却下 */
export async function reviewHolidayAction(
  formData: FormData
): Promise<HolidayResult> {
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
    .from("holiday_requests")
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), review_note: reviewNote })
    .eq("id", id);

  if (error) return { success: false, message: "更新失敗：" + error.message };

  revalidatePath("/holidays/manage");
  return { success: true };
}
