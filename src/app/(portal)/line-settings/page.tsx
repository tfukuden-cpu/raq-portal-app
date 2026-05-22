import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import LineConnectionSection from "../admin/[projectId]/settings/LineConnectionSection";
import { LineNotifySettings, LineGroupSection } from "../admin/[projectId]/settings/SettingsClient";

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

  if (!isGlobalAdmin) {
    const { data: membership } = await supabase
      .from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
    if (membership?.role !== "project_admin") redirect("/dashboard");
  }

  const admin = createAdminClient();

  const [{ data: project }, { data: members }, { data: settings }] = await Promise.all([
    supabase.from("projects").select("name").eq("id", projectId).maybeSingle(),
    supabase.from("project_members")
      .select("staff_id, staffs(name, display_name, line_user_id)")
      .eq("project_id", projectId),
    admin.from("project_settings")
      .select("line_group_id, notification_settings")
      .eq("project_id", projectId).maybeSingle(),
  ]);

  if (!project) redirect("/dashboard");

  const memberList = (members ?? []).map((m) => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null; line_user_id: string | null } | null;
    return {
      staffId:    m.staff_id,
      name:       s?.display_name ?? s?.name ?? m.staff_id,
      line_user_id: s?.line_user_id ?? null,
      lineLinked: !!s?.line_user_id,
    };
  });

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-20 space-y-10">

        <div className="mb-6">
          <p className="text-xs font-medium text-zinc-400 mb-1">{project.name}</p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            LINE設定
          </h1>
        </div>

        {/* ── LINE連携状況 ── */}
        <section className="space-y-3">
          <div>
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">LINE連携状況</h2>
            <p className="text-[10px] text-zinc-400 mt-0.5">スタッフとのLINE連携状況を確認・管理します</p>
          </div>
          <LineConnectionSection projectId={projectId} members={memberList} />
        </section>

        <div className="border-t border-zinc-100 dark:border-zinc-800" />

        {/* ── LINEグループ連携 ── */}
        <section className="space-y-3">
          <div>
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">LINEグループ連携</h2>
            <p className="text-[10px] text-zinc-400 mt-0.5">グループIDを入力するとグループへも通知が届きます</p>
          </div>
          <LineGroupSection
            projectId={projectId}
            currentGroupId={settings?.line_group_id ?? null}
          />
        </section>

        <div className="border-t border-zinc-100 dark:border-zinc-800" />

        {/* ── LINE通知設定 ── */}
        <section className="space-y-3">
          <div>
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">LINE通知設定</h2>
            <p className="text-[10px] text-zinc-400 mt-0.5">各イベント発生時にLINEへ通知するかどうかを設定します</p>
          </div>
          <LineNotifySettings
            projectId={projectId}
            initialSettings={
              (settings?.notification_settings as Record<string, boolean> | null) ?? {}
            }
          />
        </section>

      </div>
    </main>
  );
}
