/**
 * 稼働実績エクスポート（管理者用）
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import WorkRecordsClient from "./WorkRecordsClient";
import type { StaffEntry } from "./WorkRecordsClient";

export default async function WorkRecordsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId  = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const [{ data: membership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);

  const isAuthorized =
    membership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";
  if (!isAuthorized) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: members } = await admin
    .from("project_members")
    .select("staff_id, section, staffs(id, name, display_name, account_number, company_name)")
    .eq("project_id", projectId)
    .order("staff_id");

  const { data: project } = await admin
    .from("projects").select("name").eq("id", projectId).maybeSingle();

  const staffs: StaffEntry[] = (members ?? []).map(m => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as {
      display_name?: string | null; name?: string | null;
      account_number?: string | null; company_name?: string | null;
    } | null;
    return {
      staffId:       m.staff_id,
      name:          s?.display_name ?? s?.name ?? m.staff_id,
      accountNumber: s?.account_number ?? null,
      company:       s?.company_name  ?? null,
      section:       m.section        ?? null,
    };
  });

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-24">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            稼働実績エクスポート
          </h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            {project?.name ?? projectId} · {staffs.length}名
          </p>
        </div>
        <WorkRecordsClient projectId={projectId} staffs={staffs} />
      </div>
    </main>
  );
}
