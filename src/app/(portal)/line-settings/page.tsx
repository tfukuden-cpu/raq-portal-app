import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import LineSettingsClient from "./LineSettingsClient";

export default async function LineSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  // アクセス制御: project_admin または global admin
  const { data: myStaff } = await supabase
    .from("staffs").select("global_role")
    .eq("id", staffId).maybeSingle();

  const isGlobalAdmin = myStaff?.global_role === "executive" || myStaff?.global_role === "admin";

  const admin = createAdminClient();

  const [{ data: project }, { data: members }, { data: settings }] = await Promise.all([
    supabase.from("projects").select("name").eq("id", projectId).maybeSingle(),
    supabase.from("project_members")
      .select("staff_id, role, staffs(name, display_name, line_user_id)")
      .eq("project_id", projectId),
    admin.from("project_settings")
      .select("line_group_id, notification_settings")
      .eq("project_id", projectId).maybeSingle(),
  ]);

  if (!project) redirect("/dashboard");

  // アクセス制御: members 取得結果から自分の role を確認
  if (!isGlobalAdmin) {
    const myRole = (members ?? []).find(m => m.staff_id === staffId)?.role;
    if (myRole !== "project_admin") redirect("/dashboard");
  }

  const memberList = (members ?? []).map((m) => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null; line_user_id: string | null } | null;
    return {
      staffId:      m.staff_id,
      name:         s?.display_name ?? s?.name ?? m.staff_id,
      line_user_id: s?.line_user_id ?? null,
      lineLinked:   !!s?.line_user_id,
    };
  });

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 pb-20">
        <LineSettingsClient
          projectId={projectId}
          members={memberList}
          lineGroupId={settings?.line_group_id ?? null}
          notificationSettings={
            (settings?.notification_settings as Record<string, boolean> | null) ?? {}
          }
          projectName={project.name}
        />
      </div>
    </main>
  );
}

