import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import NewProjectModal from "./NewProjectModal";
import ProjectList from "./ProjectList";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: myStaff } = await supabase
    .from("staffs")
    .select("global_role")
    .eq("id", staffId)
    .maybeSingle();

  const isExecutive = myStaff?.global_role === "executive";

  if (!isExecutive) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();
  const [{ data: projects }, { data: settings }] = await Promise.all([
    supabase.from("projects").select("id, name").eq("is_active", true).order("id"),
    admin.from("project_settings").select("project_id, sheet_url"),
  ]);

  const sheetUrlMap = new Map((settings ?? []).map((s) => [s.project_id, s.sheet_url as string | null]));

  const projectList = (projects ?? []).map((p) => ({
    ...p,
    sheetUrl: sheetUrlMap.get(p.id) ?? null,
  }));

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-10 space-y-6">

        {/* ページヘッダー */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              運用管理
            </p>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              案件管理
            </h1>
          </div>
          <NewProjectModal />
        </div>

        {/* 案件リスト */}
        <ProjectList projects={projectList} />

      </div>
    </main>
  );
}
