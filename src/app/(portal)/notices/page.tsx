/**
 * お知らせ一覧
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import NoticesClient from "./NoticesClient";

export default async function NoticesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  // 表示モード確認（"staff" モード中は管理者権限を無効化）
  const cookieStore = await cookies();
  const viewMode = cookieStore.get("rqp-view-mode")?.value ?? "staff";

  // 管理者判定
  const [{ data: staffData }, { data: memberData }] = await Promise.all([
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
    supabase.from("project_members").select("role")
      .eq("project_id", projectId).eq("staff_id", staffId).maybeSingle(),
  ]);
  const isAdmin = viewMode !== "staff" && (
    staffData?.global_role === "admin" ||
    staffData?.global_role === "executive" ||
    memberData?.role === "project_admin"
  );

  // お知らせ一覧（ピン留め優先・新しい順）
  const { data: rawNotices } = await supabase
    .from("notices")
    .select("id, title, body, is_pinned, created_at, posted_by")
    .eq("project_id", projectId)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  // 投稿者名を別途取得（JOIN に依存しない）
  const posterIds = [...new Set((rawNotices ?? []).map((n) => n.posted_by).filter(Boolean))];
  const { data: posterStaffs } = posterIds.length > 0
    ? await supabase.from("staffs").select("id, display_name, name").in("id", posterIds)
    : { data: [] };
  const posterMap = new Map((posterStaffs ?? []).map((s) => [s.id, s]));

  // 確認済みID
  const { data: reads } = await supabase
    .from("notice_reads").select("notice_id").eq("staff_id", staffId);
  const readIds = (reads ?? []).map((r) => r.notice_id as string);

  const notices = (rawNotices ?? []).map((n) => {
    const poster = posterMap.get(n.posted_by ?? "");
    return {
      id:         n.id,
      title:      n.title,
      body:       n.body,
      is_pinned:  n.is_pinned,
      created_at: n.created_at,
      posterName: poster?.display_name ?? poster?.name ?? n.posted_by ?? "",
    };
  });

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      {/* ヘッダーは NoticesClient 内で管理（isAdmin によるボタン表示のため） */}
      <NoticesClient notices={notices} readIds={readIds} isAdmin={isAdmin} />
      {/* コンテンツ余白は NoticesClient 内で完結 */}
    </main>
  );
}

