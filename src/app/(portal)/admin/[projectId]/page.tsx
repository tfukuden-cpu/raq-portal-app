import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { isGSheetsConfigured } from "@/lib/gsheets";
import { archiveProjectAction } from "./settings/actions";
import { SettingsContainer } from "./settings/SettingsClient";
import { ChevronLeftIcon } from "@/components/icons";

export default async function ProjectDetailPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await props.params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: myStaff } = await supabase
    .from("staffs").select("global_role")
    .eq("id", staffId).maybeSingle();

  const isExecutive = myStaff?.global_role === "executive";
  const isAdmin     = myStaff?.global_role === "admin";

  if (!isExecutive && !isAdmin) redirect("/dashboard");

  // 管理者は自分の担当案件のみアクセス可
  if (isAdmin) {
    const { data: membership } = await supabase
      .from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
    if (!membership) redirect("/dashboard");
  }

  const [
    { data: project },
    { data: members },
    { data: settings },
    { data: shiftPatterns },
    { data: holidayRules },
  ] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
    supabase.from("project_members")
      .select("staff_id, role, section, shift_note, work_days_type, work_days_count, staffs(name, display_name, company_name, line_user_id, account_number)")
      .eq("project_id", projectId),
    createAdminClient().from("project_settings").select("sheet_url, notification_settings, line_group_id, enable_departure_report").eq("project_id", projectId).maybeSingle(),
    createAdminClient().from("shift_patterns")
      .select("id, name, short_name, start_time, end_time, required_count, required_weekday, required_weekend, section, target_role")
      .eq("project_id", projectId).order("sort_order"),
    createAdminClient().from("holiday_rules")
      .select("rule_type, value")
      .eq("project_id", projectId).order("sort_order"),
  ]);

  if (!project) redirect("/admin");

  const patternList = (shiftPatterns ?? []).map((p) => ({
    id:          p.id,
    name:        p.name,
    short_name:  (p as { short_name?: string }).short_name ?? "",
    start_time:  (p.start_time ?? "") as string,
    end_time:    (p.end_time   ?? "") as string,
    section:     (p as { section?: string | null }).section ?? "",
    target_role: (p as { target_role?: string }).target_role ?? "all",
  }));

  const memberList = (members ?? []).map((m) => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null; company_name: string | null; line_user_id: string | null; account_number: string | null } | null;
    return {
      staffId:         m.staff_id,
      name:            s?.display_name ?? s?.name ?? m.staff_id,
      company_name:    s?.company_name ?? null,
      role:            m.role ?? "staff",
      lineLinked:      !!s?.line_user_id,
      section:         m.section ?? null,
      account_number:  s?.account_number ?? null,
      shift_note:      (m as { shift_note?: string | null }).shift_note ?? null,
      work_days_type:  (m as { work_days_type?: string | null }).work_days_type ?? null,
      work_days_count: (m as { work_days_count?: number | null }).work_days_count ?? null,
    };
  });

  async function archiveAction(fd: FormData) {
    "use server";
    fd.set("projectId", projectId);
    await archiveProjectAction(fd);
  }

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-20">

        {/* ヘッダー */}
        <div className="mb-6">
          <a href={isExecutive ? "/admin" : "/dashboard"}
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-600 transition-colors mb-3">
            <ChevronLeftIcon className="w-3.5 h-3.5" />
            {isExecutive ? "案件一覧" : "ホーム"}
          </a>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {project.name}
          </h1>
          <p className="text-sm text-zinc-400 mt-0.5 font-mono">{projectId}</p>
        </div>

        <SettingsContainer
          projectId={projectId}
          projectName={project.name}
          currentUrl={settings?.sheet_url ?? null}
          isGSheetsConfigured={isGSheetsConfigured()}
          members={memberList}
          shiftPatterns={patternList}
          holidayRules={(holidayRules ?? []).map((r) => ({
            rule_type: r.rule_type,
            value:     String(r.value),
          }))}
          notificationSettings={
            (settings?.notification_settings as Record<string, boolean> | null) ?? {}
          }
          lineGroupId={settings?.line_group_id ?? null}
          enableDeparture={(settings as { enable_departure_report?: boolean | null } | null)?.enable_departure_report ?? true}
          archiveAction={archiveAction}
        />
      </div>
    </main>
  );
}
