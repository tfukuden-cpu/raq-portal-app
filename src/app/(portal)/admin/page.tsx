import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import NewProjectModal from "./NewProjectModal";
import ProjectList from "./ProjectList";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: myStaff } = await supabase
    .from("staffs")
    .select("global_role")
    .eq("id", staffId)
    .maybeSingle();

  const isExecutive   = myStaff?.global_role === "executive";
  const isGlobalAdmin = myStaff?.global_role === "admin";

  // project_admin のアクセスも許可
  const { data: myMemberships } = await supabase
    .from("project_members")
    .select("project_id, role")
    .eq("staff_id", staffId)
    .eq("role", "project_admin");

  const isProjectAdmin = (myMemberships ?? []).length > 0;

  if (!isExecutive && !isGlobalAdmin && !isProjectAdmin) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  // executive / global_admin → 全案件表示
  // project_admin → 自分が管理者の案件のみ表示
  const managedProjectIds = (myMemberships ?? []).map(m => m.project_id);

  const [{ data: projects }, { data: settings }] = await Promise.all([
    isExecutive || isGlobalAdmin
      ? supabase.from("projects").select("id, name").eq("is_active", true).order("id")
      : supabase.from("projects").select("id, name").eq("is_active", true)
          .in("id", managedProjectIds.length > 0 ? managedProjectIds : ["__none__"]).order("id"),
    admin.from("project_settings").select("project_id, sheet_url"),
  ]);

  const sheetUrlMap = new Map((settings ?? []).map(s => [s.project_id, s.sheet_url as string | null]));
  const projectList = (projects ?? []).map(p => ({
    ...p,
    sheetUrl: sheetUrlMap.get(p.id) ?? null,
  }));

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">案件設定</h1>
            {!isExecutive && !isGlobalAdmin && (
              <p className="text-xs text-zinc-400 mt-0.5">担当案件の設定・メンバー管理</p>
            )}
          </div>
          {(isExecutive || isGlobalAdmin) && <NewProjectModal />}
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-10">
        <ProjectList projects={projectList} />
      </div>
    </main>
  );
}
