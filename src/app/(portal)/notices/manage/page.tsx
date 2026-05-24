/**
 * 周知事項管理画面（管理者用）
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import NoticesManageClient from "./NoticesManageClient";
import { ChevronLeftIcon } from "@/components/icons";

export default async function ManageNoticesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  // 権限チェック
  const { data: myMembership } = await supabase
    .from("project_members")
    .select("role")
    .eq("staff_id", staffId)
    .eq("project_id", projectId)
    .maybeSingle();
  const { data: myStaff } = await supabase
    .from("staffs")
    .select("global_role")
    .eq("id", staffId)
    .maybeSingle();
  const isAuthorized =
    myMembership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";

  if (!isAuthorized) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black p-4">
        <div className="text-center">
          <p className="text-zinc-700 dark:text-zinc-300 mb-3">
            このページにアクセスする権限がありません
          </p>
          <a href="/notices" className="text-sm text-blue-600 hover:text-blue-700">
            <ChevronLeftIcon className="w-4 h-4 inline-block mr-1" />周知事項に戻る
          </a>
        </div>
      </main>
    );
  }

  // 案件情報
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  // お知らせ一覧
  const { data: rawNotices } = await supabase
    .from("notices")
    .select("id, title, body, is_pinned, created_at, posted_by, staffs(display_name, name)")
    .eq("project_id", projectId)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  const notices = (rawNotices ?? []).map((n) => {
    const staff = Array.isArray(n.staffs) ? n.staffs[0] : n.staffs;
    return {
      id: n.id,
      title: n.title,
      body: n.body,
      is_pinned: n.is_pinned,
      created_at: n.created_at,
      posted_by: n.posted_by,
      poster_name: staff?.display_name ?? staff?.name ?? n.posted_by,
    };
  });

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-10 space-y-5">
        <div>
          <a href="/notices" className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-blue-500 transition-colors mb-2">
            <ChevronLeftIcon className="w-4 h-4" />お知らせ
          </a>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">周知事項管理</h1>
          <p className="text-sm text-zinc-400 mt-0.5">{project?.name}</p>
        </div>
        <NoticesManageClient notices={notices} />
      </div>
    </main>
  );
}

