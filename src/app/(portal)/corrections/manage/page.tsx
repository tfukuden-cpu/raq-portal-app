/**
 * 勤怠補正申請管理画面（管理者用）
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import CorrectionReviewClient from "./CorrectionReviewClient";
import { ChevronLeftIcon } from "@/components/icons";

export default async function CorrectionManagePage() {
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

  if (!isAuthorized) redirect("/corrections");

  const { data: project } = await supabase
    .from("projects").select("id, name").eq("id", projectId).maybeSingle();

  const { data: raw } = await supabase
    .from("punch_corrections")
    .select("id, target_date, corrected_in, corrected_out, reason, status, review_note, created_at, staff_id, staffs(name, display_name)")
    .eq("project_id", projectId)
    .order("target_date", { ascending: false });

  const corrections = (raw ?? []).map((c) => {
    const staff = Array.isArray(c.staffs) ? c.staffs[0] : c.staffs;
    return {
      id: c.id,
      target_date: c.target_date,
      corrected_in: c.corrected_in,
      corrected_out: c.corrected_out,
      reason: c.reason,
      status: c.status,
      review_note: c.review_note,
      created_at: c.created_at,
      staff_id: c.staff_id,
      staff_name: staff?.display_name ?? staff?.name ?? c.staff_id,
    };
  });

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-10 space-y-5">
        <div>
          <a href="/corrections" className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-blue-500 transition-colors mb-2">
            <ChevronLeftIcon className="w-4 h-4" />補正申請
          </a>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">補正申請管理</h1>
          <p className="text-sm text-zinc-400 mt-0.5">{project?.name}</p>
        </div>
        <CorrectionReviewClient corrections={corrections} />
      </div>
    </main>
  );
}
