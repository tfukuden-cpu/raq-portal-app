/**
 * 勤怠補正申請画面（スタッフ用）
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import CorrectionFormClient from "./CorrectionFormClient";
import { ChevronLeftIcon } from "@/components/icons";

export default async function CorrectionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const { data: project } = await supabase
    .from("projects").select("id, name").eq("id", projectId).maybeSingle();

  const { data: myMembership } = await supabase
    .from("project_members").select("role")
    .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
  const { data: myStaff } = await supabase
    .from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  const isAdmin =
    myMembership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";

  const { data: raw } = await supabase
    .from("punch_corrections")
    .select("id, target_date, corrected_in, corrected_out, reason, status, review_note, created_at")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .order("target_date", { ascending: false })
    .limit(30);

  const corrections = (raw ?? []).map((c) => ({
    id: c.id,
    target_date: c.target_date,
    corrected_in: c.corrected_in,
    corrected_out: c.corrected_out,
    reason: c.reason,
    status: c.status,
    review_note: c.review_note,
    created_at: c.created_at,
  }));

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 pt-4 pb-3 flex items-end justify-between gap-3">
          <div>
            <a href="/dashboard" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-600 transition-colors mb-1.5">
              <ChevronLeftIcon className="w-3.5 h-3.5" />ホーム
            </a>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">補正申請</h1>
            <p className="text-sm font-semibold text-zinc-400 mt-0.5">{project?.name}</p>
          </div>
          {isAdmin && (
            <a href="/corrections/manage" className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors">
              管理
            </a>
          )}
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-10">
        <CorrectionFormClient corrections={corrections} />
      </div>
    </main>
  );
}

