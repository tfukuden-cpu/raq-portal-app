"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";

/** 自分の希望休を申請 */
export async function submitMyOffRequestAction(
  requestDate: string,
  priority: string,
): Promise<{ success: boolean; message?: string; id?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const admin = createAdminClient();

  // 重複チェック
  const { data: existing } = await admin
    .from("shift_off_requests")
    .select("id")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .eq("request_date", requestDate)
    .maybeSingle();
  if (existing) return { success: false, message: "この日は既に申請済みです" };

  const { data, error } = await admin
    .from("shift_off_requests")
    .insert({ project_id: projectId, staff_id: staffId, request_date: requestDate, priority, source: "app" })
    .select("id")
    .single();

  if (error) return { success: false, message: error.message };
  return { success: true, id: data.id as string };
}

/** 自分の希望休を取り下げ（日付指定） */
export async function withdrawMyOffRequestAction(
  id: string,
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const admin   = createAdminClient();

  // 自分の申請のみ削除可能
  const { error } = await admin
    .from("shift_off_requests")
    .delete()
    .eq("id", id)
    .eq("staff_id", staffId);

  if (error) return { success: false, message: error.message };
  return { success: true };
}

/** 自分の希望休一覧取得（対象月） */
export async function fetchMyOffRequestsForMonthAction(
  year: number,
  month: number,
): Promise<{ id: string; request_date: string; priority: string }[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const projectId = await getCurrentProjectId();
  if (!projectId) return [];

  const pad  = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const to   = `${year}-${pad(month)}-${new Date(year, month, 0).getDate()}`;

  // RLS があれば supabase で十分だが念のため admin
  const admin = createAdminClient();
  const { data } = await admin
    .from("shift_off_requests")
    .select("id, request_date, priority")
    .eq("project_id", projectId)
    .eq("staff_id", user.email?.split("@")[0]?.toUpperCase() ?? "")
    .gte("request_date", from)
    .lte("request_date", to)
    .order("request_date");

  return (data ?? []).map(r => ({
    id:           r.id as string,
    request_date: r.request_date as string,
    priority:     r.priority as string,
  }));
}
