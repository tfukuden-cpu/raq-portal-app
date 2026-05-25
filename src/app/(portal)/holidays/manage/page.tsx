/**
 * 休暇申請管理画面（管理者用）
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import HolidayReviewClient from "./HolidayReviewClient";
import { ChevronLeftIcon } from "@/components/icons";

export default async function HolidayManagePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const { data: myMembership } = await supabase
    .from("project_members").select("role")
    .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
  const { data: myStaff } = await supabase
    .from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  const isAuthorized =
    myMembership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";

  if (!isAuthorized) redirect("/holidays");

  const { data: project } = await supabase
    .from("projects").select("id, name").eq("id", projectId).maybeSingle();

  const { data: raw } = await supabase
    .from("holiday_requests")
    .select("id, request_date, status, note, created_at, staff_id, review_note, staffs(name, display_name)")
    .eq("project_id", projectId)
    .order("request_date", { ascending: false });

  const requests = (raw ?? []).map((r) => {
    const staff = Array.isArray(r.staffs) ? r.staffs[0] : r.staffs;
    return {
      id: r.id,
      request_date: r.request_date,
      status: r.status,
      note: r.note,
      review_note: r.review_note,
      created_at: r.created_at,
      staff_id: r.staff_id,
      staff_name: staff?.display_name ?? staff?.name ?? r.staff_id,
    };
  });

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-4">
          <a href="/holidays" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-600 transition-colors mb-1.5">
            <ChevronLeftIcon className="w-3.5 h-3.5" />休暇申請
          </a>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">休暇申請管理</h1>
          <p className="text-sm font-semibold text-zinc-400 mt-0.5">{project?.name}</p>
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-10">
        <HolidayReviewClient requests={requests} />
      </div>
    </main>
  );
}

