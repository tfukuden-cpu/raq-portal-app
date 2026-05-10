"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function adminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export type ActionResult = { success: boolean; message?: string };

/** 表示名を更新する */
export async function updateDisplayNameAction(displayName: string): Promise<ActionResult> {
  const trimmed = displayName.trim();
  if (!trimmed) return { success: false, message: "表示名を入力してください" };
  if (trimmed.length > 30) return { success: false, message: "30文字以内で入力してください" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const admin = createAdminClient();
  const { error } = await admin
    .from("staffs")
    .update({ display_name: trimmed })
    .eq("id", staffId);

  if (error) return { success: false, message: "更新失敗: " + error.message };

  revalidatePath("/my");
  return { success: true, message: "表示名を更新しました" };
}

/** LINE連携を解除する */
export async function unlinkLineAction(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  await adminClient()
    .from("staffs")
    .update({ line_user_id: null })
    .eq("id", staffId);

  revalidatePath("/my");
  redirect("/my");
}
