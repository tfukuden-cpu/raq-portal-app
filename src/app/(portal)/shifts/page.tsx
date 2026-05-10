/**
 * シフト・希望休・追加申請（タブ切り替え）
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import ShiftsTabs from "./ShiftsTabs";

function dateKey(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d).slice(0, 10);
}

export default async function ShiftsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const today = new Date();
  const todayStr = dateKey(today);

  // シフト：前後3ヶ月
  const rangeStart = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  const rangeEnd   = new Date(today.getFullYear(), today.getMonth() + 4, 0);

  const [shiftsRes, holidaysRes, requestsRes, openingsRes] = await Promise.all([
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
  ]);

  const minMonth = `${rangeStart.getFullYear()}-${String(rangeStart.getMonth() + 1).padStart(2, "0")}`;
  const maxMonth = `${rangeEnd.getFullYear()}-${String(rangeEnd.getMonth() + 1).padStart(2, "0")}`;

  return (
    <main className="h-dvh flex flex-col bg-white dark:bg-zinc-950 overflow-hidden">
      <div className="max-w-2xl w-full mx-auto px-4 pt-5 pb-20 flex flex-col gap-3 h-full">

        {/* ヘッダー */}
        <div className="flex-shrink-0">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">シフト</h1>
        </div>

        {/* タブ全体（残りスペースを埋める） */}
        <div className="flex-1 min-h-0 flex flex-col">
          <ShiftsTabs
            shifts={shiftsRes.data ?? []}
            todayStr={todayStr}
            initialYear={today.getFullYear()}
            initialMonth={today.getMonth() + 1}
            minMonth={minMonth}
            maxMonth={maxMonth}
            holidayRequests={holidaysRes.data ?? []}
            shiftRequests={requestsRes.data ?? []}
            shiftOpenings={openingsRes.data ?? []}
          />
        </div>
      </div>
    </main>
  );
}
