"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type ActionResult = { success: boolean; message?: string };

export async function approveShiftRequestAction(requestId: string): Promise<ActionResult> {
  if (!requestId) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("shift_requests")
    .update({ status: "approved" })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { success: false, message: error.message };

  revalidatePath("/shifts/manage");
  revalidatePath("/shifts");
  return { success: true, message: "承認しました" };
}

export async function rejectShiftRequestAction(requestId: string): Promise<ActionResult> {
  if (!requestId) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("shift_requests")
    .update({ status: "rejected" })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { success: false, message: error.message };

  revalidatePath("/shifts/manage");
  revalidatePath("/shifts");
  return { success: true, message: "却下しました" };
}
