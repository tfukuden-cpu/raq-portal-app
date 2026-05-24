import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MemberList } from "../admin/[projectId]/settings/SettingsClient";

export default async function MembersPage(props: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit: initialEditStaffId } = await props.searchParams;

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

  const [{ data: project }, { data: members }, { data: shiftPatterns }] = await Promise.all([
    supabase.from("projects").select("name").eq("id", projectId).maybeSingle(),
    supabase.from("project_members")
      .select("staff_id, role, section, sections, work_days_type, work_days_count, preferred_shift, preferred_section, max_consecutive_days, end_date, staffs(name, display_name, company_name, line_user_id, account_number)")
      .eq("project_id", projectId),
    admin.from("shift_patterns")
      .select("name, section")
      .eq("project_id", projectId)
      .order("sort_order"),
  ]);

  if (!project) redirect("/dashboard");

  const memberList = (members ?? []).map((m) => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null; company_name: string | null; line_user_id: string | null; account_number: string | null } | null;
    return {
      staffId:              m.staff_id,
      name:                 s?.display_name ?? s?.name ?? m.staff_id,
      company_name:         s?.company_name ?? null,
      role:                 m.role ?? "staff",
      lineLinked:           !!s?.line_user_id,
      line_user_id:         s?.line_user_id ?? null,
      section:              m.section ?? null,
      sections:             ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean),
      account_number:       s?.account_number ?? null,
      work_days_type:       (m as { work_days_type?: string | null }).work_days_type ?? null,
      work_days_count:      (m as { work_days_count?: number | null }).work_days_count ?? null,
      preferred_shift:      (m as { preferred_shift?: string | null }).preferred_shift ?? null,
      preferred_section:    (m as { preferred_section?: string | null }).preferred_section ?? null,
      max_consecutive_days: (m as { max_consecutive_days?: number | null }).max_consecutive_days ?? null,
      end_date:             (m as { end_date?: string | null }).end_date ?? null,
      compliance:           null as number | null,
    };
  });

  const availableSections = [...new Set(
    (shiftPatterns ?? []).map(p => (p as { section?: string | null }).section).filter(Boolean) as string[]
  )].sort();

  const shiftPatternNames = (shiftPatterns ?? [])
    .map(p => p.name)
    .filter(Boolean) as string[];

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-20">
        <div className="mb-6">
          <p className="text-xs font-medium text-zinc-400 mb-1">{project.name}</p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            メンバー管理
          </h1>
        </div>

        <Suspense>
          <MemberList
            projectId={projectId}
            members={memberList}
            availableSections={availableSections}
            shiftPatternNames={shiftPatternNames}
            initialEditStaffId={initialEditStaffId}
          />
        </Suspense>
      </div>
    </main>
  );
}

