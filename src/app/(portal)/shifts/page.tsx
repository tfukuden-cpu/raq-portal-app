/**
 * シフト・希望休・追加申請（タブ切り替え）
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import ShiftsTabs from "./ShiftsTabs";
import type { ShiftChangeLog } from "./ShiftCalendar";

function dateKey(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d).slice(0, 10);
}

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/login");

  const today = new Date();
  const todayStr = dateKey(today);

  // ?month=YYYY-MM パラメータで初期表示月を制御
  let initialYear  = today.getFullYear();
  let initialMonth = today.getMonth() + 1;
  if (monthParam) {
    const [py, pm] = monthParam.split("-").map(Number);
    if (py && pm && pm >= 1 && pm <= 12) {
      initialYear  = py;
      initialMonth = pm;
    }
  }

  // シフト：前後3ヶ月
  const rangeStart = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  const rangeEnd   = new Date(today.getFullYear(), today.getMonth() + 4, 0);

  const admin = createAdminClient();

  const [shiftsRes, holidaysRes, requestsRes, openingsRes, rulesRes, changeLogsRes, staffsRes] = await Promise.all([
    supabase
      .from("shifts")
      .select("shift_date, shift_name, shift_start, shift_end, note")
      .eq("project_id", projectId)
      .eq("staff_id", staffId)
      .gte("shift_date", dateKey(rangeStart))
      .lte("shift_date", dateKey(rangeEnd))
      .order("shift_date"),

    // 希望休：今月〜3ヶ月先
    supabase
      .from("holiday_requests")
      .select("id, request_date, status, note")
      .eq("project_id", projectId)
      .eq("staff_id", staffId)
      .gte("request_date", `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`)
      .order("request_date"),

    // 追加申請（opening_id 含む）
    supabase
      .from("shift_requests")
      .select("id, request_date, opening_id, preferred_start, preferred_end, reason, status, created_at")
      .eq("staff_id", staffId)
      .eq("project_id", projectId)
      .order("request_date", { ascending: false })
      .limit(100),

    // シフト募集：今日〜3ヶ月先
    supabase
      .from("shift_openings")
      .select("id, opening_date, shift_name, shift_start, shift_end, capacity, note")
      .eq("project_id", projectId)
      .gte("opening_date", todayStr)
      .lte("opening_date", dateKey(rangeEnd))
      .order("opening_date"),

    // 希望休ルール（RLSバイパスで確実に取得）
    admin.from("holiday_rules")
      .select("rule_type, value")
      .eq("project_id", projectId),

    // このスタッフのシフト変更ログ（前後3ヶ月）
    admin.from("shift_change_logs")
      .select("shift_date, action, before_data, after_data, changed_by, created_at")
      .eq("project_id", projectId)
      .eq("staff_id", staffId)
      .gte("shift_date", dateKey(rangeStart))
      .lte("shift_date", dateKey(rangeEnd))
      .order("created_at", { ascending: false })
      .limit(200),

    // 変更者名解決
    admin.from("staffs").select("id, display_name, name"),
  ]);

  const ruleMap = new Map((rulesRes.data ?? []).map(r => [r.rule_type, r.value as number]));

  // 変更ログ整形
  const staffNameLookup = new Map(
    (staffsRes.data ?? []).map((s) => [s.id as string, (s.display_name ?? s.name ?? s.id) as string])
  );
  const changeLogs: ShiftChangeLog[] = (changeLogsRes.data ?? []).map((l) => {
    const before = l.before_data as { shift_name?: string | null } | null;
    const after  = l.after_data  as { shift_name?: string | null } | null;
    return {
      shift_date:        l.shift_date as string,
      action:            l.action as string,
      before_shift_name: before?.shift_name ?? null,
      after_shift_name:  after?.shift_name  ?? null,
      changed_by_name:   staffNameLookup.get(l.changed_by as string) ?? (l.changed_by as string),
      changed_at:        l.created_at as string,
    };
  });
  const holidayOpenDay         = ruleMap.get("open_day") ?? null;
  const holidayDeadlineDay     = ruleMap.get("deadline_day") ?? null;
  const holidayMaxDaysPerMonth = ruleMap.get("monthly_limit_per_person") ?? null;
  const holidayWeekendLimit    = ruleMap.get("weekend_limit") ?? null;

  const minMonth = `${rangeStart.getFullYear()}-${String(rangeStart.getMonth() + 1).padStart(2, "0")}`;
  const maxMonth = `${rangeEnd.getFullYear()}-${String(rangeEnd.getMonth() + 1).padStart(2, "0")}`;

  return (
    <main className="flex flex-col md:h-dvh md:overflow-hidden" style={{ background: "#02040f" }}>
      {/* ShiftsTabs がヘッダー（タイトル・タブ・月ナビ）を内包 */}
      <ShiftsTabs
        projectId={projectId}
        shifts={shiftsRes.data ?? []}
        changeLogs={changeLogs}
        todayStr={todayStr}
        initialYear={initialYear}
        initialMonth={initialMonth}
        minMonth={minMonth}
        maxMonth={maxMonth}
        holidayRequests={holidaysRes.data ?? []}
        shiftRequests={requestsRes.data ?? []}
        shiftOpenings={openingsRes.data ?? []}
        holidayOpenDay={holidayOpenDay}
        holidayDeadlineDay={holidayDeadlineDay}
        holidayMaxDaysPerMonth={holidayMaxDaysPerMonth}
        holidayWeekendLimit={holidayWeekendLimit}
      />
    </main>
  );
}

