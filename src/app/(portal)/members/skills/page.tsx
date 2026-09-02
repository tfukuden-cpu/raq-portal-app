import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import SkillsMatrixClient, { type SkillMember } from "./SkillsMatrixClient";

export default async function MemberSkillsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/login");

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

  const [{ data: project }, { data: members }, { data: shiftPatterns }, { data: skillItems }, { data: skillValues }] = await Promise.all([
    supabase.from("projects").select("name").eq("id", projectId).maybeSingle(),
    supabase.from("project_members")
      .select("staff_id, section, sections, staffs(name, display_name, account_number)")
      .eq("project_id", projectId)
      .is("end_date", null),
    supabase.from("shift_patterns")
      .select("section")
      .eq("project_id", projectId),
    supabase.from("skill_items")
      .select("id, label, sort_order")
      .eq("project_id", projectId)
      .order("sort_order"),
    supabase.from("staff_skill_values")
      .select("staff_id, item_id, value")
      .eq("project_id", projectId),
  ]);

  if (!project) redirect("/dashboard");

  const availableSections = [...new Set(
    (shiftPatterns ?? []).map(p => (p as { section?: string | null }).section).filter(Boolean) as string[]
  )].sort();

  // カスタム項目の値マップ: staffId → itemId → value
  const valueMap = new Map<string, Record<string, boolean>>();
  for (const v of (skillValues ?? []) as { staff_id: string; item_id: string; value: boolean }[]) {
    if (!valueMap.has(v.staff_id)) valueMap.set(v.staff_id, {});
    valueMap.get(v.staff_id)![v.item_id] = v.value;
  }

  const memberList: SkillMember[] = (members ?? []).map((m) => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null; account_number: string | null } | null;
    const sections = ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean);
    return {
      staffId: m.staff_id,
      name: s?.display_name ?? s?.name ?? m.staff_id,
      accountNumber: s?.account_number ?? null,
      mainSection: m.section ?? null,
      sections: sections.length > 0 ? sections : (m.section ? [m.section] : []),
      itemValues: valueMap.get(m.staff_id) ?? {},
    };
  });

  memberList.sort((a, b) => {
    const an = a.accountNumber, bn = b.accountNumber;
    if (an == null && bn == null) return a.name.localeCompare(b.name, "ja");
    if (an == null) return 1;
    if (bn == null) return -1;
    const af = parseFloat(an), bf = parseFloat(bn);
    if (!isNaN(af) && !isNaN(bf) && af !== bf) return af - bf;
    return an.localeCompare(bn, "ja", { numeric: true });
  });

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      <div className="max-w-6xl mx-auto px-4 pb-20">
        <SkillsMatrixClient
          projectId={projectId}
          projectName={project.name}
          members={memberList}
          availableSections={availableSections}
          skillItems={((skillItems ?? []) as { id: string; label: string }[]).map(i => ({ id: i.id, label: i.label }))}
        />
      </div>
    </main>
  );
}
