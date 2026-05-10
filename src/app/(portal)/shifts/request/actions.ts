"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";

export type ActionResult = { success: boolean; message?: string };

/** シフト募集への申請 */
export async function applyShiftOpeningAction(
  openingId: string,
  requestDate: string,
): Promise<ActionResult> {
  if (!openingId || !requestDate) {
    return { success: false, message: "申請情報が不足しています" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  // 同日に既に申請がないか確認
  const { data: existing } = await supabase
    .from("shift_requests")
    .select("id")
    .eq("staff_id", staffId)
    .eq("project_id", projectId)
    .eq("request_date", requestDate)
    .maybeSingle();

  if (existing) {
    return { success: false, message: "この日はすでに申請済みです" };
  }

  const { error } = await supabase.from("shift_requests").insert({
    staff_id:   staffId,
    project_id: projectId,
    request_date: requestDate,
    opening_id: openingId,
    status: "pending",
  });

  if (error) return { success: false, message: "申請失敗: " + error.message };

  revalidatePath("/shifts");
  return { success: true, message: "申請しました" };
}

/** 既存の申請をキャンセル */
export async function cancelShiftRequestAction(
  requestId: string,
): Promise<ActionResult> {
  if (!requestId) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  // pending のみキャンセル可
  const { error } = await supabase
    .from("shift_requests")
    .delete()
    .eq("id", requestId)
    .eq("staff_id", staffId)
    .eq("status", "pending");

  if (error) return { success: false, message: "キャンセル失敗: " + error.message };

  revalidatePath("/shifts");
  return { success: true, message: "申請をキャンセルしました" };
}
