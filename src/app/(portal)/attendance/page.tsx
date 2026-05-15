/**
 * 当日状況（案件管理者用）
 * - 本日シフトがあるメンバーのみ表示
 * - セクション別アコーディオン（初期折りたたみ）
 * - ヘッダーに出発済/出勤済/欠勤サマリー表示
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { ChevronLeftIcon } from "@/components/icons";

function tokyoToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const SECTION_ORDER = ["SV", "査定", "販売", "MOTA", "ローン", "リメイク"];

// これらのシフト名は「出勤なし」扱い → 当日状況に表示しない
const OFF_SHIFT_NAMES = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤"];

type StatusKey = "working" | "clocked_out" | "departed" | "absent" | "late" | "not_departed";

const STATUS_LABEL: Record<StatusKey, string> = {
  working:      "勤務中",
  clocked_out:  "退勤済",
  departed:     "出発済",
  absent:       "欠勤",
  late:         "遅刻連絡",
  not_departed: "未出発",
};

const STATUS_COLOR: Record<StatusKey, string> = {
  working:      "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  clocked_out:  "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  departed:     "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  absent:       "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  late:         "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  not_departed: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
};

const statusSortOrder: StatusKey[] = ["absent", "late", "working", "departed", "clocked_out", "not_departed"];

export default async function AttendancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const [{ data: myMembership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);

  const isAuthorized =
    myMembership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";

  if (!isAuthorized) redirect("/dashboard");

  const admin = createAdminClient();
  const today = tokyoToday();
  const todayStart = `${today}T00:00:00+09:00`;
  const todayEnd   = `${today}T23:59:59+09:00`;

  const [
    { data: project },
    { data: memberRows },
    { data: todayShifts },
    { data: punchLogs },
    { data: departureRows },
    { data: absenceRows },
    { data: lateRows },
  ] = await Promise.all([
    admin.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
    admin.from("project_members")
      .select("staff_id, section, role, staffs(id, name, display_name)")
      .eq("project_id", projectId),
    admin.from("shifts")
      .select("staff_id, shift_name, shift_start, shift_end")
      .eq("project_id", projectId)
      .eq("shift_date", today),
    admin.from("punch_logs")
      .select("staff_id, punch_type, recorded_at")
      .eq("project_id", projectId)
      .gte("recorded_at", todayStart)
      .lte("recorded_at", todayEnd)
      .order("recorded_at"),
    admin.from("departure_reports")
      .select("staff_id, reported_at, eta_minutes")
      .eq("project_id", projectId)
      .gte("reported_at", todayStart)
      .lte("reported_at", todayEnd),
    admin.from("absence_reports")
      .select("staff_id, reason")
      .eq("project_id", projectId)
      .eq("absence_date", today),
    admin.from("late_reports")
      .select("staff_id, reason, expected_arrival")
      .eq("project_id", projectId)
      .eq("late_date", today),
  ]);

  // マップ構築
  const memberMap = new Map<string, { name: string; section: string | null }>();
  for (const m of memberRows ?? []) {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as { display_name?: string | null; name?: string | null } | null;
    memberMap.set(m.staff_id, { name: s?.display_name ?? s?.name ?? m.staff_id, section: m.section ?? null });
  }

  const punchMap = new Map<string, { clockIn: string | null; clockOut: string | null }>();
  for (const p of punchLogs ?? []) {
    if (!punchMap.has(p.staff_id)) punchMap.set(p.staff_id, { clockIn: null, clockOut: null });
    const e = punchMap.get(p.staff_id)!;
    if (p.punch_type === "clock_in"  && !e.clockIn)  e.clockIn  = p.recorded_at;
    if (p.punch_type === "clock_out")                 e.clockOut = p.recorded_at;
  }

  const departureMap = new Map(
    (departureRows ?? []).map(d => [d.staff_id, { reportedAt: d.reported_at, etaMinutes: d.eta_minutes as number | null }])
  );
  const absenceMap = new Map(
    (absenceRows ?? []).map(a => [a.staff_id, { reason: a.reason as string | null }])
  );
  const lateMap = new Map(
    (lateRows ?? []).map(l => [l.staff_id, { reason: l.reason as string | null, expectedArrival: l.expected_arrival as string | null }])
  );

  // 今日シフトのあるメンバーを組み立て
  type MemberData = {
    staffId: string;
    name: string;
    section: string | null;
    shift: { shift_name: string; shift_start: string | null; shift_end: string | null };
    clockIn: string | null;
    clockOut: string | null;
    departure: { reportedAt: string; etaMinutes: number | null } | null;
    absence: { reason: string | null } | null;
    late: { reason: string | null; expectedArrival: string | null } | null;
    status: StatusKey;
  };

  const allMembers: MemberData[] = [];
  for (const shift of todayShifts ?? []) {
    const member = memberMap.get(shift.staff_id);
    if (!member) continue;
    // 休日系シフトは表示しない
    if (OFF_SHIFT_NAMES.includes(shift.shift_name ?? "")) continue;
    const punch     = punchMap.get(shift.staff_id) ?? null;
    const departure = departureMap.get(shift.staff_id) ?? null;
    const absence   = absenceMap.get(shift.staff_id) ?? null;
    const late      = lateMap.get(shift.staff_id) ?? null;

    let status: StatusKey;
    if (absence)             status = "absent";
    else if (punch?.clockOut) status = "clocked_out";
    else if (punch?.clockIn)  status = "working";
    else if (late)            status = "late";
    else if (departure)       status = "departed";
    else                      status = "not_departed";

    allMembers.push({
      staffId:   shift.staff_id,
      name:      member.name,
      section:   member.section,
      shift:     { shift_name: shift.shift_name ?? "", shift_start: shift.shift_start, shift_end: shift.shift_end },
      clockIn:   punch?.clockIn  ?? null,
      clockOut:  punch?.clockOut ?? null,
      departure,
      absence,
      late,
      status,
    });
  }

  // セクション → "その他" にまとめる
  const normalizeSection = (s: string | null): string =>
    SECTION_ORDER.includes(s ?? "") ? (s as string) : "その他";

  // セクション内をシフト名でグループ化（shift_start順に並べる）
  function groupByShift(members: MemberData[]) {
    const shiftOrder: string[] = [];
    const shiftMap = new Map<string, MemberData[]>();
    for (const m of members) {
      const key = m.shift.shift_name || "その他";
      if (!shiftMap.has(key)) { shiftMap.set(key, []); shiftOrder.push(key); }
      shiftMap.get(key)!.push(m);
    }
    // 各シフトグループを shift_start → status の順にソート
    for (const [, list] of shiftMap) {
      list.sort((a, b) => {
        const ta = a.shift.shift_start ?? "99:99";
        const tb = b.shift.shift_start ?? "99:99";
        if (ta !== tb) return ta.localeCompare(tb);
        return statusSortOrder.indexOf(a.status) - statusSortOrder.indexOf(b.status);
      });
    }
    // シフトグループ自体も shift_start の昇順で並べる
    shiftOrder.sort((a, b) => {
      const ta = shiftMap.get(a)![0].shift.shift_start ?? "99:99";
      const tb = shiftMap.get(b)![0].shift.shift_start ?? "99:99";
      return ta.localeCompare(tb);
    });
    return shiftOrder.map(name => ({ shiftName: name, members: shiftMap.get(name)! }));
  }

  const sections = [...SECTION_ORDER, "その他"];
  const grouped = sections.map(sec => {
    const members = allMembers.filter(m => normalizeSection(m.section) === sec);
    return { section: sec, shiftGroups: groupByShift(members) };
  }).filter(g => g.shiftGroups.length > 0);

  // 全体サマリー
  const total     = allMembers.length;
  const departed  = allMembers.filter(m => m.departure || m.clockIn).length;
  const clockedIn = allMembers.filter(m => m.clockIn).length;
  const absent    = allMembers.filter(m => m.absence).length;

  // 日付ラベル
  const [, monthStr, dayStr] = today.split("-");
  const noonJST = new Date(`${today}T12:00:00+09:00`);
  const weekday = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", weekday: "narrow" }).format(noonJST);
  const dateLabel = `${parseInt(monthStr)}月${parseInt(dayStr)}日（${weekday}）`;

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-16">

        {/* ヘッダー */}
        <div className="mb-5">
          <a href="/dashboard" className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-blue-500 transition-colors mb-2">
            <ChevronLeftIcon className="w-4 h-4" />ホーム
          </a>
          <div className="flex items-baseline justify-between">
            <div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">当日状況</h1>
              <p className="text-sm text-zinc-400 mt-0.5">{project?.name}</p>
            </div>
            <span className="text-sm font-semibold text-zinc-500">{dateLabel}</span>
          </div>
        </div>

        {/* 全体サマリー */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-blue-500 tabular-nums">{departed}<span className="text-sm text-zinc-400 font-normal">/{total}</span></div>
            <div className="text-xs text-zinc-500 mt-0.5">出発済</div>
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-green-500 tabular-nums">{clockedIn}<span className="text-sm text-zinc-400 font-normal">/{total}</span></div>
            <div className="text-xs text-zinc-500 mt-0.5">出勤済</div>
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-red-500 tabular-nums">{absent}</div>
            <div className="text-xs text-zinc-500 mt-0.5">欠勤</div>
          </div>
        </div>

        {/* セクション別アコーディオン */}
        {grouped.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-10">本日の出勤予定者はいません</p>
        ) : (
          <div className="space-y-2">
            {grouped.map(({ section, shiftGroups }) => {
              const sAllMembers = shiftGroups.flatMap(g => g.members);
              const sDeparted  = sAllMembers.filter(m => m.departure || m.clockIn).length;
              const sClockedIn = sAllMembers.filter(m => m.clockIn).length;
              const sAbsent    = sAllMembers.filter(m => m.absence).length;
              const sTotal     = sAllMembers.length;

              return (
                <details key={section} className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none list-none hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-zinc-400 transition-transform group-open:rotate-90 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{section}</span>
                      <span className="text-xs text-zinc-400">{sTotal}名</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs tabular-nums">
                      <span className="text-blue-600 dark:text-blue-400 font-semibold">出発 {sDeparted}/{sTotal}</span>
                      <span className="text-green-600 dark:text-green-400 font-semibold">出勤 {sClockedIn}/{sTotal}</span>
                      {sAbsent > 0 && <span className="text-red-500 font-semibold">欠勤 {sAbsent}</span>}
                    </div>
                  </summary>

                  {/* シフト名ごとのグループ */}
                  <div className="border-t border-zinc-100 dark:border-zinc-800">
                    {shiftGroups.map(({ shiftName, members: gMembers }) => (
                      <div key={shiftName}>
                        {/* シフト名ヘッダー */}
                        <div className="px-4 py-1.5 bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-between">
                          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                            {shiftName}
                            {gMembers[0].shift.shift_start && gMembers[0].shift.shift_end &&
                              ` ${gMembers[0].shift.shift_start}〜${gMembers[0].shift.shift_end}`}
                          </span>
                          <span className="text-xs text-zinc-400">{gMembers.length}名</span>
                        </div>
                        {/* メンバー一覧 */}
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                          {gMembers.map(m => (
                            <div key={m.staffId} className="px-4 py-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{m.name}</span>
                                    <span className="text-xs text-zinc-400 font-mono">{m.staffId}</span>
                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${STATUS_COLOR[m.status]}`}>
                                      {STATUS_LABEL[m.status]}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex-shrink-0 text-right text-xs font-mono tabular-nums space-y-0.5">
                                  {m.clockIn  && <div className="text-green-600 dark:text-green-400">出 {fmtTime(m.clockIn)}</div>}
                                  {m.clockOut && <div className="text-zinc-400">退 {fmtTime(m.clockOut)}</div>}
                                </div>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                                {m.departure && !m.clockIn && (
                                  <span className="text-blue-600 dark:text-blue-400">
                                    出発 {fmtTime(m.departure.reportedAt)}
                                    {m.departure.etaMinutes !== null && ` · 約${m.departure.etaMinutes}分後`}
                                  </span>
                                )}
                                {m.absence && (
                                  <span className="text-red-500">欠勤: {m.absence.reason ?? "未記入"}</span>
                                )}
                                {m.late && !m.clockIn && (
                                  <span className="text-amber-600 dark:text-amber-400">
                                    遅刻: {m.late.reason ?? "未記入"}
                                    {m.late.expectedArrival && ` · 到着予定 ${m.late.expectedArrival.slice(0, 5)}`}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
