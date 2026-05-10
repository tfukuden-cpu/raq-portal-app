/**
 * 管理者用：担当案件の設定ページへリダイレクト
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";

export default async function ProjectSettingsRedirectPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/dashboard");

  redirect(`/admin/${projectId}`);
}
