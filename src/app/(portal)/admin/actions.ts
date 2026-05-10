"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

/** 案件を削除（is_active = false に設定） */
export async function deleteProjectAction(fd: FormData): Promise<{ success: boolean; message?: string }> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  if (!projectId) return { success: false, message: "案件IDが不正です" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "未ログイン" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: s } = await supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  if (s?.global_role !== "executive") return { success: false, message: "権限がありません" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("projects")
    .update({ is_active: false })
    .eq("id", projectId);

  if (error) return { success: false, message: error.message };

  revalidatePath("/admin");
  return { success: true };
}
