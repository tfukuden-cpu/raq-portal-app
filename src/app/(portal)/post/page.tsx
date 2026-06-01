/**
 * 投稿（スタッフ掲示板）
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import PostClient from "./PostClient";

function tokyoToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export default async function PostPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const cookieStore = await cookies();
  const viewMode = cookieStore.get("rqp-view-mode")?.value ?? "staff";

  const [{ data: staffData }, { data: memberData }, { data: myStaff }] = await Promise.all([
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
    supabase.from("project_members").select("role").eq("project_id", projectId).eq("staff_id", staffId).maybeSingle(),
    supabase.from("staffs").select("display_name, name").eq("id", staffId).maybeSingle(),
  ]);

  const isAdmin = viewMode !== "staff" && (
    staffData?.global_role === "admin" ||
    staffData?.global_role === "executive" ||
    memberData?.role === "project_admin"
  );

  const myName = myStaff?.display_name ?? myStaff?.name ?? staffId;

  // 投稿一覧（新しい順・最新100件）
  const { data: rawPosts } = await supabase
    .from("posts")
    .select("id, body, created_at, staff_id, staffs(display_name, name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);

  const today = tokyoToday();
  const posts = (rawPosts ?? []).map((p) => {
    const staff = Array.isArray(p.staffs) ? p.staffs[0] : p.staffs;
    return {
      id:         p.id as string,
      body:       p.body as string,
      created_at: p.created_at as string,
      staffId:    p.staff_id as string,
      posterName: (staff?.display_name ?? staff?.name ?? p.staff_id ?? "") as string,
    };
  });

  const todayCount = posts.filter(p => p.created_at.startsWith(today)).length;

  return (
    <PostClient
      posts={posts}
      currentStaffId={staffId}
      currentStaffName={myName}
      isAdmin={isAdmin}
      todayCount={todayCount}
    />
  );
}
