/**
 * 投稿（スタッフ掲示板）
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import PostClient from "./PostClient";

export default async function PostPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  // 表示モード確認
  const cookieStore = await cookies();
  const viewMode = cookieStore.get("rqp-view-mode")?.value ?? "staff";

  // 管理者判定（"staff" モード中は無効化）
  const [{ data: staffData }, { data: memberData }] = await Promise.all([
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
    supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("staff_id", staffId)
      .maybeSingle(),
  ]);
  const isAdmin = viewMode !== "staff" && (
    staffData?.global_role === "admin" ||
    staffData?.global_role === "executive" ||
    memberData?.role === "project_admin"
  );

  // 投稿一覧（新しい順・最新100件）
  const { data: rawPosts } = await supabase
    .from("posts")
    .select("id, body, created_at, staff_id, staffs(display_name, name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);

  const posts = (rawPosts ?? []).map((p) => {
    const staff = Array.isArray(p.staffs) ? p.staffs[0] : p.staffs;
    return {
      id:         p.id,
      body:       p.body,
      created_at: p.created_at,
      staffId:    p.staff_id,
      posterName: staff?.display_name ?? staff?.name ?? p.staff_id ?? "",
    };
  });

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">掲示板</h1>
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-10 space-y-4">
        <PostClient posts={posts} currentStaffId={staffId} isAdmin={isAdmin} />
      </div>
    </main>
  );
}

