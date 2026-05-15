/**
 * 当日状況（案件管理者用）
 * - 本日シフトがあるメンバーのみ表示
 * - セクション別グループ表示
 * - 欠勤/遅刻連絡・出発状況・打刻状況を一覧表示
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

export default async function AttendancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  // 権限確認
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

  // ── 並列データ取得 ──────────────────────────────────────
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

  // ── スタッフ情報マップ ─────────────────────────────────
  const memberMap = new Map<string, { name: string; section: string | null; role: string }>();
  for (const m of memberRows ?? []) {
    const s = Array.isArray(m.staffs) ? m.staffs[0] : m.staffs as { display_name?: string | null; name?: string | null } | null;
    memberMap.set(m.staff_id, {
      name:    s?.display_name ?? s?.name ?? m.staff_id,
      section: m.section ?? null,
      role:    m.role ?? "staff",
    });
  }

  // ── 今日シフトのある staff_id セット ─────────────────
  const shiftMap = new Map<string, { shift_name: string; shift_start: string | null; shift_end: string | null }>();
  for (const s of todayShifts ?? []) {
    shiftMap.set(s.staff_id, {
      shift_name:  s.shift_name ?? "",
      shift_start: s.shift_start,
      shift_end:   s.shift_end,
    });
  }

  // ── 打刻マップ ───────────────────────────────────────
  const punchMap = new Map<string, { clockIn: string | null; clockOut: string | null }>();
  for (const p of punchLogs ?? []) {
    if (!punchMap.has(p.staff_id)) punchMap.set(p.staff_id, { clockIn: null, clockOut: null });
    const e = punchMap.get(p.staff_id)!;
    if (p.punch_type === "clock_in"  && !e.clockIn)  e.clockIn  = p.recorded_at;
    if (p.punch_type === "clock_out")                 e.clockOut = p.recorded_at;
  }

  // ── 各レポートマップ ──────────────────────────────────
  const departureMap = new Map<string, { reportedAt: string; etaMinutes: number | null }>();
  for (const d of departureRows ?? []) {
    departureMap.set(d.staff_id, { reportedAt: d.reported_at, etaMinutes: d.eta_minutes });
  }

  const absenceMap = new Map<string, { reason: string | null }>();
  for (const a of absenceRows ?? []) absenceMap.set(a.staff_id, { reason: a.reason });

  const lateMap = new Map<string, { reason: string | null; expectedArrival: string | null }>();
  for (const l of lateRows ?? []) lateMap.set(l.staff_id, { reason: l.reason, expectedArrival: l.expected_arrival });

  // ── 今日出勤予定のメンバーのみ対象 ────────────────────
  type MemberData = {
    staffId: string;
    name: string;
    section: string | null;
    shift: { shift_name: string; shift_start: string | null; shift_end: string | null } | null;
    clockIn: string | null;
    clockOut: string | null;
    departure: { reportedAt: string; etaMinutes: number | null } | null;
    absence: { reason: string | null } | null;
    late: { reason: string | null; expectedArrival: string | null } | null;
    status: StatusKey;
  };

  const members: MemberData[] = [];
  for (const [sid, shift] of shiftMap) {
    const member = memberMap.get(sid);
    if (!member) continue;

    const punch     = punchMap.get(sid) ?? null;
    const departure = departureMap.get(sid) ?? null;
    const absence   = absenceMap.get(sid) ?? null;
    const late      = lateMap.get(sid) ?? null;

    let status: StatusKey;
    if (absence)                       status = "absent";
    else if (punch?.clockOut)          status = "clocked_out";
    else if (punch?.clockIn)           status = "working";
    else if (late)                     status = "late";
    else if (departure)                status = "departed";
    else                               status = "not_departed";

    members.push({
      staffId: sid,
      name:    member.name,
      section: member.section,
      shift,
      clockIn:   punch?.clockIn  ?? null,
      clockOut:  punch?.clockOut ?? null,
      departure,
      absence,
      late,
      status,
    });
  }

  // ── セクション別グループ化 ────────────────────────────
  const sectionOrder = [...new Set(members.map(m => m.section))].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b, "ja");
  });

  const statusOrder: StatusKey[] = ["absent", "late", "working", "departed", "clocked_out", "not_departed"];
  const grouped = sectionOrder.map(sec => ({
    section: sec,
    members: members
      .filter(m => m.section === sec)
      .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)),
  }));

  // ── サマリー ─────────────────────────────────────────
  const counts: Record<StatusKey, number> = {
    working: 0, clocked_out: 0, departed: 0, absent: 0, late: 0, not_departed: 0,
  };
  for (const m of members) counts[m.status]++;

  // ── 日付ラベル ────────────────────────────────────────
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

        {/* サマリーバッジ */}
        <div className="flex flex-wrap gap-2 mb-5">
          {(["working","clocked_out","departed","absent","late","not_departed"] as StatusKey[]).map(s => (
            counts[s] > 0 && (
              <span key={s} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_COLOR[s]}`}>
                {STATUS_LABEL[s]} {counts[s]}
              </span>
            )
          ))}
          {members.length === 0 && (
            <span className="text-sm text-zinc-400">本日の出勤予定者はいません</span>
          )}
        </div>

        {/* セクション別リスト */}
        <div className="space-y-4">
          {grouped.map(({ section, members: sMembers }) => (
            sMembers.length > 0 && (
              <div key={section ?? "__none__"} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                {/* セクションヘッダー */}
                <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/50">
                  <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200">
                    {section ?? "未割当"}
                  </span>
                  <span className="text-xs text-zinc-400">{sMembers.length}名</span>
                </div>

                {/* メンバー一覧 */}
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {sMembers.map(m => (
                    <div key={m.staffId} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        {/* 左：名前・シフト */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{m.name}</span>
                            <span className="text-xs text-zinc-400 font-mono">{m.staffId}</span>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${STATUS_COLOR[m.status]}`}>
                              {STATUS_LABEL[m.status]}
                            </span>
                          </div>
                          {m.shift && (
                            <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
                              {m.shift.shift_name}
                              {m.shift.shift_start && m.shift.shift_end && ` ${m.shift.shift_start}〜${m.shift.shift_end}`}
                            </p>
                          )}
                        </div>

                        {/* 右：打刻時刻 */}
                        <div className="flex-shrink-0 text-right text-xs font-mono tabular-nums space-y-0.5">
                          {m.clockIn && (
                            <div className="text-green-600 dark:text-green-400">出 {fmtTime(m.clockIn)}</div>
                          )}
                          {m.clockOut && (
                            <div className="text-zinc-400">退 {fmtTime(m.clockOut)}</div>
                          )}
                        </div>
                      </div>

                      {/* 追加情報行 */}
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                        {m.departure && !m.clockIn && (
                          <span className="text-blue-600 dark:text-blue-400">
                            出発済 {fmtTime(m.departure.reportedAt)}
                            {m.departure.etaMinutes !== null && ` (到着予定 ${m.departure.etaMinutes}分)`}
                          </span>
                        )}
                        {m.absence && (
                          <span className="text-red-600 dark:text-red-400">
                            欠勤理由: {m.absence.reason ?? "未記入"}
                          </span>
                        )}
                        {m.late && !m.clockIn && (
                          <span className="text-amber-600 dark:text-amber-400">
                            遅刻連絡: {m.late.reason ?? "未記入"}
                            {m.late.expectedArrival && ` / 到着予定 ${m.late.expectedArrival.slice(0, 5)}`}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>

      </div>
    </main>
  );
}
