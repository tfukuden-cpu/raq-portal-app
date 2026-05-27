"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type OffRequestRow = {
  id: string;
  staff_id: string;
  staff_name: string;
  request_date: string;
  priority: string;
  submitted_at: string | null;
  source: string;
};

/** 指定案件・月の希望休申請を全件取得（管理者用） */
export async function fetchOffRequestsAction(
  projectId: string,
  year: number,
  month: number,
): Promise<{ success: boolean; message?: string; rows?: OffRequestRow[] }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shift_off_requests")
    .select("id, staff_id, request_date, priority, submitted_at, source")
    .eq("project_id", projectId)
    .gte("request_date", from)
    .lte("request_date", to)
    .order("submitted_at", { ascending: true })
    .order("staff_id")
    .order("request_date");

  if (error) return { success: false, message: error.message };

  // スタッフ名を取得
  const staffIds = [...new Set((data ?? []).map(r => r.staff_id))];
  const nameMap = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: staffsRaw } = await admin
      .from("staffs")
      .select("id, name, display_name")
      .in("id", staffIds);
    for (const s of staffsRaw ?? []) {
      nameMap.set(s.id, (s.display_name ?? s.name ?? s.id) as string);
    }
  }

  const rows: OffRequestRow[] = (data ?? []).map(r => ({
    id:           r.id,
    staff_id:     r.staff_id,
    staff_name:   nameMap.get(r.staff_id) ?? r.staff_id,
    request_date: r.request_date as string,
    priority:     r.priority as string,
    submitted_at: r.submitted_at as string | null,
    source:       (r.source as string | null) ?? "excel",
  }));

  return { success: true, rows };
}

export type AppHolidayRow = {
  staff_id: string;
  staff_name: string;
  request_date: string;
  submitted_at: string;
};

/** 指定案件・月のアプリ申請（holiday_requests）を全件取得（管理者用） */
export async function fetchAppHolidayRequestsAction(
  projectId: string,
  year: number,
  month: number,
): Promise<{ success: boolean; message?: string; rows?: AppHolidayRow[] }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("holiday_requests")
    .select("staff_id, request_date, created_at")
    .eq("project_id", projectId)
    .gte("request_date", from)
    .lte("request_date", to)
    .order("staff_id")
    .order("request_date");

  if (error) return { success: false, message: error.message };

  const staffIds = [...new Set((data ?? []).map(r => r.staff_id as string))];
  const nameMap = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: staffsRaw } = await admin
      .from("staffs").select("id, name, display_name").in("id", staffIds);
    for (const s of staffsRaw ?? []) {
      nameMap.set(s.id, (s.display_name ?? s.name ?? s.id) as string);
    }
  }

  return {
    success: true,
    rows: (data ?? []).map(r => ({
      staff_id:     r.staff_id as string,
      staff_name:   nameMap.get(r.staff_id as string) ?? (r.staff_id as string),
      request_date: r.request_date as string,
      submitted_at: r.created_at as string,
    })),
  };
}

/** スタッフの希望休を全件取得（管理者用・ID付き） */
export async function fetchOffRequestsForStaffAction(
  projectId: string,
  staffId: string,
): Promise<{ id: string; request_date: string; priority: string }[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shift_off_requests")
    .select("id, request_date, priority")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .order("request_date");
  return (data ?? []).map(r => ({
    id: r.id as string,
    request_date: r.request_date as string,
    priority: r.priority as string,
  }));
}

/** 希望休を1件追加（管理者操作） */
export async function addOffRequestForStaffAction(
  projectId: string,
  staffId: string,
  requestDate: string,
  priority: string,
): Promise<{ success: boolean; message?: string; id?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("shift_off_requests")
    .select("id")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .eq("request_date", requestDate)
    .maybeSingle();
  if (existing) return { success: false, message: "同じ日付が既に登録されています" };

  const { data, error } = await admin
    .from("shift_off_requests")
    .insert({ project_id: projectId, staff_id: staffId, request_date: requestDate, priority, source: "app" })
    .select("id")
    .single();

  if (error) return { success: false, message: error.message };
  return { success: true, id: data.id as string };
}

/** 希望休を1件削除（管理者操作・IDで指定） */
export async function removeOffRequestForStaffAction(
  id: string,
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();
  const { error } = await admin.from("shift_off_requests").delete().eq("id", id);
  if (error) return { success: false, message: error.message };
  return { success: true };
}

/** スタッフ自身の希望休申請を1件取り下げ */
export async function withdrawOffRequestAction(
  projectId: string,
  requestDate: string,
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { error } = await supabase
    .from("shift_off_requests")
    .delete()
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .eq("request_date", requestDate);

  if (error) return { success: false, message: error.message };
  return { success: true };
}

/** スタッフ自身の希望休申請を取得 */
export async function fetchMyOffRequestsAction(
  projectId: string,
  year: number,
  month: number,
): Promise<{ success: boolean; message?: string; rows?: { request_date: string; priority: string; submitted_at: string | null }[] }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;

  const { data, error } = await supabase
    .from("shift_off_requests")
    .select("request_date, priority, submitted_at")
    .eq("project_id", projectId)
    .gte("request_date", from)
    .lte("request_date", to)
    .order("request_date");

  if (error) return { success: false, message: error.message };

  return {
    success: true,
    rows: (data ?? []).map(r => ({
      request_date: r.request_date as string,
      priority:     r.priority as string,
      submitted_at: r.submitted_at as string | null,
    })),
  };
}
