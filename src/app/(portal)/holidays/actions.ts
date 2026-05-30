"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";

const adminClient = () => createAdminClient();

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

  // 希望休ルールを取得（RLSバイパスで確実に読む）
  const { data: ruleRows } = await adminClient()
    .from("holiday_rules")
    .select("rule_type, value")
    .eq("project_id", projectId);
  const ruleMap = new Map((ruleRows ?? []).map(r => [r.rule_type, r.value as number]));
  const openDay          = ruleMap.get("open_day") ?? null;
  const deadlineDay      = ruleMap.get("deadline_day") ?? null;
  const maxDaysPerMonth  = ruleMap.get("monthly_limit_per_person") ?? null;
  const weekendLimit     = ruleMap.get("weekend_limit") ?? null;
  const dailyLimitCount  = ruleMap.get("daily_limit_count") ?? null;
  const consecutiveLimit = ruleMap.get("consecutive_limit") ?? null;

  // 日付ごとに月でグループ化してバリデーション
  const today = new Date();
  const todayDay   = today.getDate();
  const todayYear  = today.getFullYear();
  const todayMonth = today.getMonth() + 1;

  // 申請受付開始前チェック：今月の受付開始日を過ぎていないとNG
  if (openDay !== null && todayDay < openDay) {
    return { success: false, message: `希望休の申請受付は毎月${openDay}日から開始されます（現在${todayDay}日）` };
  }

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

  // 土日申請上限チェック：月ごとに土日の申請数を検証
  if (weekendLimit !== null) {
    const isWeekend = (ds: string) => {
      const dow = new Date(ds + "T00:00:00").getDay();
      return dow === 0 || dow === 6;
    };
    const byMonth = new Map<string, number>();
    for (const d of dates) {
      if (!isWeekend(d)) continue;
      const mo = d.slice(0, 7);
      byMonth.set(mo, (byMonth.get(mo) ?? 0) + 1);
    }
    for (const [mo, count] of byMonth) {
      const [y, m] = mo.split("-").map(Number);
      const from = `${mo}-01`;
      const to   = `${mo}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
      const { data: existing } = await supabase
        .from("holiday_requests")
        .select("request_date")
        .eq("project_id", projectId)
        .eq("staff_id", staffId)
        .eq("status", "approved")
        .gte("request_date", from)
        .lte("request_date", to);
      const existingWeekend = (existing ?? []).filter(r => isWeekend(r.request_date as string)).length;
      if (existingWeekend + count > weekendLimit) {
        const remaining = weekendLimit - existingWeekend;
        return {
          success: false,
          message: `${Number(m)}月の土日の残り申請枠は${remaining}日です（上限${weekendLimit}日）`,
        };
      }
    }
  }

  // E-3: 1日あたりの希望休上限チェック（プロジェクト全体）
  if (dailyLimitCount !== null) {
    const { data: dailyExisting } = await adminClient()
      .from("holiday_requests")
      .select("request_date")
      .eq("project_id", projectId)
      .in("request_date", dates)
      .eq("status", "approved");
    const dailyCountMap = new Map<string, number>();
    for (const r of dailyExisting ?? []) {
      const d = r.request_date as string;
      dailyCountMap.set(d, (dailyCountMap.get(d) ?? 0) + 1);
    }
    for (const d of dates) {
      if ((dailyCountMap.get(d) ?? 0) >= dailyLimitCount) {
        const [, m, day] = d.split("-").map(Number);
        return {
          success: false,
          message: `${m}/${day}はすでに${dailyLimitCount}名が希望休を取得しているため申請できません`,
        };
      }
    }
  }

  // E-4: 連続希望休の上限チェック
  if (consecutiveLimit !== null) {
    const sortedNew = [...dates].sort();
    const minDate = sortedNew[0];
    const maxDate = sortedNew[sortedNew.length - 1];
    // 前後バッファ込みで既存の承認済み希望休を取得
    const bufferDays = consecutiveLimit;
    const bufMin = new Date(minDate); bufMin.setDate(bufMin.getDate() - bufferDays);
    const bufMax = new Date(maxDate); bufMax.setDate(bufMax.getDate() + bufferDays);
    const fromBuf = bufMin.toISOString().slice(0, 10);
    const toBuf   = bufMax.toISOString().slice(0, 10);

    const { data: existingRows } = await adminClient()
      .from("holiday_requests")
      .select("request_date")
      .eq("project_id", projectId)
      .eq("staff_id", staffId)
      .eq("status", "approved")
      .gte("request_date", fromBuf)
      .lte("request_date", toBuf);

    const allDates = Array.from(new Set([
      ...(existingRows ?? []).map(r => r.request_date as string),
      ...dates,
    ])).sort();

    let maxConsec = 1; let cur = 1;
    for (let i = 1; i < allDates.length; i++) {
      const prev = new Date(allDates[i - 1]); prev.setDate(prev.getDate() + 1);
      if (prev.toISOString().slice(0, 10) === allDates[i]) {
        cur++; maxConsec = Math.max(maxConsec, cur);
      } else {
        cur = 1;
      }
    }
    if (maxConsec > consecutiveLimit) {
      return {
        success: false,
        message: `希望休は${consecutiveLimit}日以上連続して申請できません（最大${consecutiveLimit}日まで）`,
      };
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
