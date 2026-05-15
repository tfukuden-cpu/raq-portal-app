/**
 * 当日状況（案件管理者用）
 * 現在選択中の案件のメンバー全員の本日の出退勤状況を表示
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { ChevronLeftIcon } from "@/components/icons";

function tokyoToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

export default async function AttendancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  // 権限確認
  const [{ data: myMembership }, { data: myStaff }] = await Promise.all([
    supabase
      .from("project_members")
      .select("role")
      .eq("staff_id", staffId)
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("staffs")
      .select("global_role")
      .eq("id", staffId)
      .maybeSingle(),
  ]);

  const isAuthorized =
    myMembership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";

  if (!isAuthorized) redirect("/dashboard");

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  // 案件メンバー一覧
  const { data: memberRows } = await supabase
    .from("project_members")
    .select("staff_id, staffs(name, display_name)")
    .eq("project_id", projectId);

  // 今日の打刻ログ
  const today = tokyoToday();
  const todayStart = today + "T00:00:00+09:00";
  const todayEnd = today + "T23:59:59+09:00";

  const { data: punchLogs } = await supabase
    .from("punch_logs")
    .select("staff_id, punch_type, recorded_at")
    .eq("project_id", projectId)
    .gte("recorded_at", todayStart)
    .lte("recorded_at", todayEnd)
    .order("recorded_at");

  // 打刻を staff ごとに集約
  const punchMap = new Map<
    string,
    { clockIn: string | null; clockOut: string | null }
  >();
  for (const log of punchLogs ?? []) {
    const time = new Date(log.recorded_at).toLocaleTimeString("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    if (!punchMap.has(log.staff_id)) {
      punchMap.set(log.staff_id, { clockIn: null, clockOut: null });
    }
    const entry = punchMap.get(log.staff_id)!;
    if (log.punch_type === "clock_in" && !entry.clockIn) entry.clockIn = time;
    if (log.punch_type === "clock_out") entry.clockOut = time;
  }

  type MemberRow = {
    staffId: string;
    staffName: string;
    clockIn: string | null;
    clockOut: string | null;
  };

  const members: MemberRow[] = (memberRows ?? []).map((m) => {
    const s = Array.isArray(m.staffs) ? m.staffs[0] : m.staffs;
    const punch = punchMap.get(m.staff_id);
    return {
      staffId: m.staff_id,
      staffName: s?.display_name ?? s?.name ?? m.staff_id,
      clockIn: punch?.clockIn ?? null,
      clockOut: punch?.clockOut ?? null,
    };
  });

  // 勤務中 → 出勤済み（退勤済み）→ 未出勤 の順
  members.sort((a, b) => {
    const rankA = a.clockIn ? (a.clockOut ? 2 : 3) : 1;
    const rankB = b.clockIn ? (b.clockOut ? 2 : 3) : 1;
    if (rankA !== rankB) return rankB - rankA;
    return a.staffName.localeCompare(b.staffName, "ja");
  });

  const clockedIn = members.filter((m) => m.clockIn && !m.clockOut).length;
  const clockedOut = members.filter((m) => m.clockOut).length;
  const notYet = members.filter((m) => !m.clockIn).length;

  const [, monthStr, dayStr] = today.split("-");
  const noonJST = new Date(`${today}T12:00:00+09:00`);
  const weekday = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", weekday: "narrow" }).format(noonJST);
  const dateLabel = `${parseInt(monthStr)}月${parseInt(dayStr)}日（${weekday}）`;

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-10">
        <div className="mb-5">
          <a href="/dashboard" className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-blue-500 transition-colors mb-2">
            <ChevronLeftIcon className="w-4 h-4" />ホーム
          </a>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">当日状況</h1>
          <p className="text-sm text-zinc-400 mt-0.5">{project?.name}</p>
        </div>
        <div className="space-y-4">
        {/* サマリー */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-amber-500">{clockedIn}</div>
            <div className="text-xs text-zinc-500 mt-1">勤務中</div>
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-blue-500">{clockedOut}</div>
            <div className="text-xs text-zinc-500 mt-1">退勤済み</div>
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-zinc-400">{notYet}</div>
            <div className="text-xs text-zinc-500 mt-1">未出勤</div>
          </div>
        </div>

        {/* メンバー一覧 */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              {dateLabel}
            </div>
            <div className="text-xs text-zinc-500">計 {members.length}名</div>
          </div>
          {members.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">
              メンバーがいません
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {members.map((m) => (
                <div
                  key={m.staffId}
                  className="flex items-center px-4 py-3 gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-zinc-900 dark:text-zinc-100">
                      {m.staffName}
                    </span>
                    <span className="text-xs text-zinc-400 ml-1.5 font-mono">
                      {m.staffId}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono flex-shrink-0">
                    {m.clockIn ? (
                      <span className="text-green-600 dark:text-green-400">
                        出 {m.clockIn}
                      </span>
                    ) : (
                      <span className="text-zinc-300 dark:text-zinc-600">
                        未出勤
                      </span>
                    )}
                    {m.clockOut ? (
                      <span className="text-blue-600 dark:text-blue-400">
                        退 {m.clockOut}
                      </span>
                    ) : m.clockIn ? (
                      <span className="text-amber-500 dark:text-amber-400 font-medium">
                        勤務中
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
    </main>
  );
}
