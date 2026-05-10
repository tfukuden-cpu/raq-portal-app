/**
 * ホーム画面アクション（出発報告・欠勤報告・遅刻報告）
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";
import { appendSheetRow, extractSpreadsheetId } from "@/lib/gsheets";
import { sendEventNotify } from "@/lib/notify";

export type ActionResult = {
  success: boolean;
  message?: string;
};

/** 出発報告 */
export async function recordDepartureAction(
  fd: FormData
): Promise<ActionResult> {
  const etaMinutes = Number(fd.get("etaMinutes") ?? 0) || null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const { error } = await supabase.from("departure_reports").insert({
    staff_id:    staffId,
    project_id:  projectId,
    eta_minutes: etaMinutes,
  });

  if (error) {
    console.error("departure error:", error);
    return { success: false, message: "送信失敗: " + error.message };
  }

  revalidatePath("/dashboard");
  return { success: true, message: "出発報告を送信しました" };
}

/** 欠勤報告 */
export async function submitAbsenceAction(
  fd: FormData
): Promise<ActionResult> {
  const reason   = String(fd.get("reason")   ?? "").trim();
  const nextDay  = fd.get("nextDay")  === "true";
  const dayAfter = fd.get("dayAfter") === "true";

  if (!reason) return { success: false, message: "理由を入力してください" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  const { error } = await supabase.from("absence_reports").insert({
    staff_id:           staffId,
    project_id:         projectId,
    absence_date:       today,
    reason,
    next_day_available: nextDay,
    day_after_available: dayAfter,
    status:             "pending",
  });

  if (error) {
    console.error("absence error:", error);
    return { success: false, message: "送信失敗: " + error.message };
  }

  revalidatePath("/dashboard");

  // スタッフ名取得
  const { data: staffData } = await supabase
    .from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
  const name = staffData?.display_name ?? staffData?.name ?? staffId;

  // スプレッドシートへ追記
  try {
    const { data: settings } = await supabase
      .from("project_settings")
      .select("sheet_url")
      .eq("project_id", projectId)
      .maybeSingle();
    const spreadsheetId = settings?.sheet_url
      ? extractSpreadsheetId(settings.sheet_url) : null;
    if (spreadsheetId) {
      const nowJST = new Date()
        .toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).replace("T", " ");
      await appendSheetRow(spreadsheetId, "欠勤報告", [
        nowJST, staffId, name, today, reason,
        nextDay  ? "出勤可" : "欠勤",
        dayAfter ? "出勤可" : "欠勤",
      ]);
    }
  } catch (e) {
    console.error("欠勤報告スプシ追記エラー:", e);
  }

  // LINE通知：管理者グループへ（欠勤申請）
  void sendEventNotify(projectId, "absence", {
    "名前":          name,
    "日付":          today,
    "欠勤理由":      reason,
    "翌日出勤可否":   nextDay  ? "翌日：出勤可" : "翌日：欠勤",
    "翌々日出勤可否": dayAfter ? "翌々日：出勤可" : "翌々日：欠勤",
  });

  // LINE通知：申請したスタッフ本人へ（受付完了）
  void sendEventNotify(projectId, "absence_confirm", {
    "名前": name,
  }, staffId);

  return { success: true, message: "欠勤報告を送信しました" };
}

/** 遅刻報告 */
export async function submitLateAction(fd: FormData): Promise<ActionResult> {
  const reason          = String(fd.get("reason")          ?? "").trim();
  const expectedArrival = String(fd.get("expectedArrival") ?? "").trim();

  if (!reason) return { success: false, message: "理由を入力してください" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  const { error } = await supabase.from("late_reports").insert({
    staff_id:         staffId,
    project_id:       projectId,
    late_date:        today,
    reason,
    expected_arrival: expectedArrival || null,
    status:           "pending",
  });

  if (error) {
    console.error("late error:", error);
    return { success: false, message: "送信失敗: " + error.message };
  }

  revalidatePath("/dashboard");

  // スタッフ名取得
  const { data: staffData } = await supabase
    .from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
  const name = staffData?.display_name ?? staffData?.name ?? staffId;

  // LINE通知：管理者グループへ（遅刻申請）
  void sendEventNotify(projectId, "tardiness", {
    "名前":        name,
    "日付":        today,
    "遅刻理由":    reason,
    "到着目安時間": expectedArrival || "未定",
  });

  return { success: true, message: "遅刻報告を送信しました" };
}
