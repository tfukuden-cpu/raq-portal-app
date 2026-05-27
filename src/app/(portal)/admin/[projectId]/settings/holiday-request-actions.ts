"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export type HolidayRequestEntry = {
  id: string;
  request_date: string; // YYYY-MM-DD
  status: string;       // pending / approved / rejected / cancelled
  note: string | null;
};

/** 管理者：スタッフの希望休一覧を取得 */
export async function fetchHolidayRequestsForStaffAction(
  staffId: string,
  projectId: string,
): Promise<HolidayRequestEntry[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("holiday_requests")
    .select("id, request_date, status, note")
    .eq("staff_id", staffId)
    .eq("project_id", projectId)
    .order("request_date");

  return (data ?? []).map(r => ({
    id:           r.id           as string,
    request_date: String(r.request_date),
    status:       String(r.status),
    note:         r.note         as string | null,
  }));
}

/** 管理者：希望休を追加（1日分・status=pending で登録） */
export async function addHolidayRequestForStaffAction(
  staffId: string,
  projectId: string,
  requestDate: string,
): Promise<{ success: boolean; id?: string; message?: string }> {
  const admin = createAdminClient();

  // 重複チェック
  const { data: existing } = await admin
    .from("holiday_requests")
    .select("id")
    .eq("staff_id", staffId)
    .eq("project_id", projectId)
    .eq("request_date", requestDate)
    .maybeSingle();
  if (existing) return { success: false, message: "同じ日付が既に登録されています" };

  const { data, error } = await admin
    .from("holiday_requests")
    .insert({ staff_id: staffId, project_id: projectId, request_date: requestDate, status: "pending" })
    .select("id")
    .single();

  if (error) return { success: false, message: error.message };
  return { success: true, id: data.id as string };
}

/** 管理者：希望休を削除 */
export async function removeHolidayRequestForStaffAction(
  id: string,
): Promise<{ success: boolean; message?: string }> {
  const admin = createAdminClient();
  const { error } = await admin.from("holiday_requests").delete().eq("id", id);
  if (error) return { success: false, message: error.message };
  return { success: true };
}
