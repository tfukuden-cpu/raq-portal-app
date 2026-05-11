/**
 * 休暇申請画面（スタッフ用）
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import HolidayCalendar from "./HolidayCalendar";
import { ChevronLeftIcon } from "@/components/icons";

export default async function HolidaysPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  // 権限確認
  const { data: myMembership } = await supabase
    .from("project_members").select("role")
    .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
  const { data: myStaff } = await supabase
    .from("staffs").select("global_role")
    .eq("id", staffId).maybeSingle();
  const isAdmin =
    myMembership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";

  // 今後3ヶ月分の申請を取得
  const today = new Date();
  const from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const futureDate = new Date(today.getFullYear(), today.getMonth() + 3, 0);
  const to = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, "0")}-${String(futureDate.getDate()).padStart(2, "0")}`;

  const admin = createAdminClient();
  const [{ data: requests }, { data: ruleRows }] = await Promise.all([
    supabase
      .from("holiday_requests")
      .select("id, request_date, status, note")
      .eq("project_id", projectId)
      .eq("staff_id", staffId)
      .gte("request_date", from)
      .lte("request_date", to)
      .order("request_date"),
    admin
      .from("holiday_rules")
      .select("rule_type, value")
      .eq("project_id", projectId),
  ]);

  const ruleMap = new Map((ruleRows ?? []).map(r => [r.rule_type, r.value as number]));
  const deadlineDay = ruleMap.get("deadline_day") ?? null;
  const maxDaysPerMonth = ruleMap.get("monthly_limit_per_person") ?? null;

  const appliedRequests = (requests ?? []).map((r) => ({
    id: r.id,
    request_date: r.request_date,
    status: r.status,
    note: r.note,
  }));

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-10 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <a href="/dashboard" className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-blue-500 transition-colors mb-2">
              <ChevronLeftIcon className="w-4 h-4" />ホーム
            </a>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">休暇申請</h1>
          </div>
          {isAdmin && (
            <a href="/holidays/manage" className="flex-shrink-0 mt-6 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors">
              管理
            </a>
          )}
        </div>
        <HolidayCalendar
          initialYear={today.getFullYear()}
          initialMonth={today.getMonth() + 1}
          appliedRequests={appliedRequests}
          deadlineDay={deadlineDay}
          maxDaysPerMonth={maxDaysPerMonth}
        />
      </div>
    </main>
  );
}
