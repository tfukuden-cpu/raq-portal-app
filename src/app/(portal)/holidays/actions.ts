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

  // 希望休ルールを取得
  const { data: ruleRows } = await supabase
    .from("holiday_rules")
    .select("rule_type, value")
    .eq("project_id", projectId);
  const ruleMap = new Map((ruleRows ?? []).map(r => [r.rule_type, r.value as number]));
  const deadlineDay = ruleMap.get("deadline_day") ?? null;
  const maxDaysPerMonth = ruleMap.get("monthly_limit_per_person") ?? null;

  // 日付ごとに月でグループ化してバリデーション
  const today = new Date();
  const todayDay   = today.getDate();
  const todayYear  = today.getFullYear();
  const todayMonth = today.getMonth() + 1;

  // 締切チェック：今月分の申請は締切日以降NG
  if (deadlineDay !== null) {
    const hasCurrentMonthDate = dates.some(d => {
      const [y, m] = d.split("-").map(Number);
      return y === todayYear && m === todayMonth;
    });
    if (hasCurrentMonthDate && todayDay > deadlineDay) {
      return { success: false, message: `今月分の申請期限（${deadlineDay}日）を過ぎています` };
    }
  }

  // 月上限チェック：月別にカウント
  if (maxDaysPerMonth !== null) {
    const byMonth = new Map<string, number>();
    for (const d of dates) {
      const mo = d.slice(0, 7);
      byMonth.set(mo, (byMonth.get(mo) ?? 0) + 1);
    }
    for (const [mo, count] of byMonth) {
      const [y, m] = mo.split("-").map(Number);
      const from = `${mo}-01`;
      const to   = `${mo}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
      const { data: existing } = await supabase
        .from("holiday_requests")
        .select("id")
        .eq("project_id", projectId)
        .eq("staff_id", staffId)
        .eq("status", "approved")
        .gte("request_date", from)
        .lte("request_date", to);
      const existingCount = (existing ?? []).length;
      if (existingCount + count > maxDaysPerMonth) {
        const remaining = maxDaysPerMonth - existingCount;
        return {
          success: false,
          message: `${Number(m)}月の残り申請枠は${remaining}日です（上限${maxDaysPerMonth}日）`,
        };
      }
    }
  }

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
