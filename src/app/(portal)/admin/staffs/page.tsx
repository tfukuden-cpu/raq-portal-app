import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import StaffsClient from "./StaffsClient";

export default async function AllStaffsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: myStaff } = await supabase
    .from("staffs").select("global_role")
    .eq("id", staffId).maybeSingle();

  if (myStaff?.global_role !== "executive") redirect("/dashboard");

  const admin = createAdminClient();

  // 全スタッフ取得（executive含む）
  const { data: staffs } = await admin
    .from("staffs")
    .select("id, name, display_name, company_name, global_role, is_active, must_change_password, account_number, line_user_id, line_blocked")
    .order("global_role")   // executive → admin → staff の順
    .order("id");

  // 全プロジェクトメンバーシップ（アクティブ案件のみ）
  const { data: memberships } = await admin
    .from("project_members")
    .select("staff_id, project_id, role, projects!inner(name, is_active)")
    .eq("projects.is_active", true)
    .order("staff_id");

  // スタッフIDごとに所属案件をまとめる
  const projectsByStaff = new Map<string, { id: string; name: string; role: string }[]>();
  for (const m of memberships ?? []) {
    const proj = (Array.isArray(m.projects) ? m.projects[0] : m.projects) as
      { name: string; is_active: boolean } | null;
    if (!proj) continue;
    const list = projectsByStaff.get(m.staff_id) ?? [];
    list.push({ id: m.project_id, name: proj.name, role: m.role ?? "staff" });
    projectsByStaff.set(m.staff_id, list);
  }

  const staffList = (staffs ?? []).map((s) => ({
    id:                   s.id,
    name:                 s.display_name ?? s.name ?? s.id,
    company_name:         (s as { company_name?: string | null }).company_name ?? null,
    global_role:          s.global_role ?? "staff",
    is_active:            (s as { is_active?: boolean }).is_active ?? true,
    must_change_password: (s as { must_change_password?: boolean }).must_change_password ?? false,
    account_number:       (s as { account_number?: string | null }).account_number ?? null,
    line_linked:          !!(s as { line_user_id?: string | null }).line_user_id,
    line_blocked:         (s as { line_blocked?: boolean }).line_blocked ?? false,
    projects:             projectsByStaff.get(s.id) ?? [],
  }));

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 pt-5 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">スタッフ管理</h1>
          <p className="text-sm font-semibold text-zinc-400 mt-0.5">全案件のスタッフ・管理者アカウント一覧</p>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 pt-4 pb-20">
        <StaffsClient staffs={staffList} />
      </div>
    </main>
  );
}


