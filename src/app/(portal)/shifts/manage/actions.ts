"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { sendEventNotify } from "@/lib/notify";

export type ActionResult = { success: boolean; message?: string };

async function fetchRequestInfo(requestId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shift_requests")
    .select("project_id, staff_id, request_date, shift_openings(shift_name), staffs(display_name, name)")
    .eq("id", requestId)
    .maybeSingle();
  if (!data) return null;

  const opening = Array.isArray(data.shift_openings) ? data.shift_openings[0] : data.shift_openings;
  const staff   = Array.isArray(data.staffs)         ? data.staffs[0]         : data.staffs;

  return {
    projectId:  data.project_id as string,
    staffId:    data.staff_id as string,
    staffName:  (staff as { display_name: string | null; name: string | null } | null)?.display_name
              ?? (staff as { display_name: string | null; name: string | null } | null)?.name
              ?? (data.staff_id as string),
    date:       data.request_date as string,
    shiftName:  (opening as { shift_name: string } | null)?.shift_name ?? "シフト追加",
  };
}

export async function approveShiftRequestAction(requestId: string): Promise<ActionResult> {
  if (!requestId) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const info = await fetchRequestInfo(requestId);

  const admin = createAdminClient();
  const { error } = await admin
    .from("shift_requests")
    .update({ status: "approved" })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { success: false, message: error.message };

  revalidatePath("/shifts/manage");
  revalidatePath("/shifts");

  if (info) {
    await sendEventNotify(info.projectId, "shift_request_result", {
      名前:   info.staffName,
      日付:   info.date,
      シフト: info.shiftName,
      結果:   "承認",
    }, info.staffId);
  }

  return { success: true, message: "承認しました" };
}

export async function rejectShiftRequestAction(requestId: string): Promise<ActionResult> {
  if (!requestId) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const info = await fetchRequestInfo(requestId);

  const admin = createAdminClient();
  const { error } = await admin
    .from("shift_requests")
    .update({ status: "rejected" })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { success: false, message: error.message };

  revalidatePath("/shifts/manage");
  revalidatePath("/shifts");

  if (info) {
    await sendEventNotify(info.projectId, "shift_request_result", {
      名前:   info.staffName,
      日付:   info.date,
      シフト: info.shiftName,
      結果:   "却下",
    }, info.staffId);
  }

  return { success: true, message: "却下しました" };
}
