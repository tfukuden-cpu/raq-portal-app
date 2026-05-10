/**
 * 案件選択時の処理（クッキー設定 → ダッシュボードへ）
 * form action として使うため戻り値は void
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { setCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";

export async function selectProjectAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  // 所属チェック（不正な案件IDを弾く）
  const { data: membership } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("staff_id", staffId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!membership) return;

  await setCurrentProjectId(projectId);
  redirect("/dashboard");
}
