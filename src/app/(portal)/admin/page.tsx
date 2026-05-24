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
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">案件管理</h1>
          <NewProjectModal />
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-10">
        <ProjectList projects={projectList} />
      </div>
    </main>
  );
}

