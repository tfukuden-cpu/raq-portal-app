/**
 * 周知管理画面（管理者用）
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import NoticesManageClient from "./NoticesManageClient";

export default async function ManageNoticesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  // 権限チェック
  const [{ data: myMembership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);

  const isAuthorized =
    myMembership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";

  if (!isAuthorized) redirect("/dashboard");

  const admin = createAdminClient();

  // 案件情報・周知事項・メンバーを並列取得
  const [
    { data: project },
    { data: rawNotices },
    { data: rawMembers },
  ] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
    admin.from("notices")
      .select("id, title, body, is_pinned, created_at, posted_by, target_staff_id, staffs!notices_posted_by_fkey(display_name, name)")
      .eq("project_id", projectId)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false }),
    admin.from("project_members")
      .select("staff_id, staffs(display_name, name)")
      .eq("project_id", projectId)
      .is("end_date", null),
  ]);

  // 個人宛お知らせの宛先スタッフ名を取得
  const targetIds = [...new Set(
    (rawNotices ?? []).map(n => n.target_staff_id as string | null).filter(Boolean) as string[]
  )];
  const { data: targetStaffRows } = targetIds.length > 0
    ? await admin.from("staffs").select("id, display_name, name").in("id", targetIds)
    : { data: [] };
  const targetStaffMap = new Map(
    (targetStaffRows ?? []).map(s => [s.id as string, (s.display_name ?? s.name ?? s.id) as string])
  );

  // 周知事項を整形
  const notices = (rawNotices ?? []).map((n) => {
    const staff = Array.isArray(n.staffs) ? n.staffs[0] : n.staffs;
    const targetId = n.target_staff_id as string | null;
    return {
      id: n.id,
      title: n.title,
      body: n.body,
      is_pinned: n.is_pinned,
      created_at: n.created_at,
      posted_by: n.posted_by,
      poster_name: (staff as { display_name?: string; name?: string } | null)?.display_name
        ?? (staff as { display_name?: string; name?: string } | null)?.name
        ?? n.posted_by,
      target_staff_id: targetId,
      target_name: targetId ? (targetStaffMap.get(targetId) ?? targetId) : null,
    };
  });

  // メンバー一覧（投稿先選択用）
  const members = (rawMembers ?? []).map(m => {
    const s = Array.isArray(m.staffs) ? m.staffs[0] : m.staffs;
    return {
      id: m.staff_id as string,
      name: (s as { display_name?: string; name?: string } | null)?.display_name
        ?? (s as { display_name?: string; name?: string } | null)?.name
        ?? (m.staff_id as string),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "ja"));

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">周知管理</h1>
          <p className="text-sm font-semibold text-zinc-400 mt-0.5">{project?.name}</p>
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-10">
        <NoticesManageClient notices={notices} members={members} />
      </div>
    </main>
  );
}
