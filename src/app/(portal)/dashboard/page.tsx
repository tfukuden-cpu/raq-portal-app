/**
 * ホーム画面（スタッフ用）
 * 出発報告 → 現場端末打刻の状態遷移を管理
 */
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentProjectId } from "@/lib/project-context";
import HomeClient from "./HomeClient";

function tokyoToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function getTodayLabel(): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default async function DashboardPage() {
  // ops モードのときは案件一覧へ即リダイレクト（DBクエリ前に判定）
  // /admin 側に独自のアクセス制御があるため、ここはcookieだけで判断してOK
  const cookieStore = await cookies();
  const viewMode = cookieStore.get("rqp-view-mode")?.value ?? "";
  if (viewMode === "ops") redirect("/admin");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: staff } = await supabase
    .from("staffs")
    .select("id, name, display_name, global_role, must_change_password")
    .eq("id", staffId)
    .maybeSingle();

  if (staff?.must_change_password) redirect("/change-password");

  const displayName = staff?.display_name ?? staff?.name ?? staffId;

  // ── 一般スタッフ / 案件管理者 ──

  const { data: memberships } = await supabase
    .from("project_members")
    .select("project_id, role, is_main, projects(id, name, is_active)")
    .eq("staff_id", staffId);

  const activeMemberships = (memberships ?? []).filter((m) => {
    const p = Array.isArray(m.projects) ? m.projects[0] : m.projects;
    return p?.is_active;
  });

  if (activeMemberships.length === 0) redirect("/select-project");

  let currentProjectId = await getCurrentProjectId();
  const isCurrentValid = activeMemberships.some(
    (m) => m.project_id === currentProjectId
  );

  if (!currentProjectId || !isCurrentValid) {
    if (activeMemberships.length === 1) {
      // Server Component では cookies().set() 不可 → Route Handler 経由でセット＆リダイレクト
      redirect(`/api/set-project?id=${activeMemberships[0].project_id}&next=/dashboard`);
    } else {
      redirect("/select-project");
    }
  }

  const currentMembership = activeMemberships.find(
    (m) => m.project_id === currentProjectId
  )!;
  const currentProject = Array.isArray(currentMembership.projects)
    ? currentMembership.projects[0]
    : currentMembership.projects;

  const today = tokyoToday();
  const todayStart = `${today}T00:00:00+09:00`;
  const todayEnd = `${today}T23:59:59+09:00`;
  const weekLater = new Date(); weekLater.setDate(weekLater.getDate() + 7);
  const weekLaterStr = weekLater.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  // 並列クエリ
  const [
    { data: todayPunches },
    { data: todayShift },
    { data: todayDeparture },
    { data: todayAbsence },
    { data: todayLate },
    { data: allNotices },
    { data: readNotices },
    { data: upcomingShiftRows },
    { data: projectSettings },
  ] = await Promise.all([
    supabase
      .from("punch_logs")
      .select("id, punch_type, recorded_at")
      .eq("staff_id", staffId)
      .eq("project_id", currentProjectId!)
      .gte("recorded_at", todayStart)
      .lte("recorded_at", todayEnd)
      .order("recorded_at"),
    supabase
      .from("shifts")
      .select("shift_name, shift_start, shift_end")
      .eq("staff_id", staffId)
      .eq("project_id", currentProjectId!)
      .eq("shift_date", today)
      .maybeSingle(),
    supabase
      .from("departure_reports")
      .select("id, reported_at, eta_minutes")
      .eq("staff_id", staffId)
      .eq("project_id", currentProjectId!)
      .gte("reported_at", todayStart)
      .lte("reported_at", todayEnd)
      .order("reported_at")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("absence_reports")
      .select("id, status")
      .eq("staff_id", staffId)
      .eq("project_id", currentProjectId!)
      .eq("absence_date", today)
      .maybeSingle(),
    supabase
      .from("late_reports")
      .select("id, status")
      .eq("staff_id", staffId)
      .eq("project_id", currentProjectId!)
      .eq("late_date", today)
      .maybeSingle(),
    supabase
      .from("notices")
      .select("id")
      .eq("project_id", currentProjectId!),
    supabase
      .from("notice_reads")
      .select("notice_id")
      .eq("staff_id", staffId),
    supabase
      .from("shifts")
      .select("shift_date, shift_name, shift_start, shift_end")
      .eq("staff_id", staffId)
      .eq("project_id", currentProjectId!)
      .gt("shift_date", today)
      .lte("shift_date", weekLaterStr)
      .not("shift_name", "in", '("公休","休","公休日")')
      .order("shift_date")
      .limit(5),
    supabase
      .from("project_settings")
      .select("enable_departure_report")
      .eq("project_id", currentProjectId!)
      .maybeSingle(),
  ]);

  const readIds = new Set((readNotices ?? []).map(r => r.notice_id as string));
  const unreadCount = (allNotices ?? []).filter(n => !readIds.has(n.id as string)).length;

  const clockInEntry = todayPunches?.find((p) => p.punch_type === "clock_in");
  const clockOutEntry = [...(todayPunches ?? [])]
    .reverse()
    .find((p) => p.punch_type === "clock_out");

  return (
    <HomeClient
      displayName={displayName}
      projectName={currentProject?.name ?? ""}
      hasMultipleProjects={activeMemberships.length > 1}
      todayLabel={getTodayLabel()}
      shift={
        todayShift
          ? {
              name: todayShift.shift_name,
              start: todayShift.shift_start,
              end: todayShift.shift_end,
            }
          : null
      }
      departureTime={
        todayDeparture?.reported_at
          ? fmtTime(todayDeparture.reported_at)
          : null
      }
      clockInTime={
        clockInEntry?.recorded_at ? fmtTime(clockInEntry.recorded_at) : null
      }
      clockOutTime={
        clockOutEntry?.recorded_at ? fmtTime(clockOutEntry.recorded_at) : null
      }
      hasAbsenceReport={!!todayAbsence}
      absenceStatus={todayAbsence?.status ?? null}
      hasLateReport={!!todayLate}
      lateStatus={todayLate?.status ?? null}
      enableDeparture={(projectSettings as { enable_departure_report?: boolean | null } | null)?.enable_departure_report ?? true}
      noticeCount={unreadCount}
      upcomingShifts={(upcomingShiftRows ?? []).map(s => ({
        date: s.shift_date as string,
        name: s.shift_name as string | null,
        start: s.shift_start as string | null,
        end: s.shift_end as string | null,
      }))}
    />
  );
}
