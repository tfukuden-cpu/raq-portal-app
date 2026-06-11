/**
 * ホーム画面（スタッフ用）
 * 出発報告 → 現場端末打刻の状態遷移を管理
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentProjectId } from "@/lib/project-context";
import HomeClient from "./HomeClient";
import AdminHomeWrapper from "./AdminHomeWrapper";
import type { GroupTask, TaskGroup, StaffOption, NameMapping } from "../tasks/TasksClient";

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
    .select("id, name, display_name, global_role, must_change_password, rpg_character")
    .eq("id", staffId)
    .maybeSingle();

  if (staff?.must_change_password) redirect("/change-password");

  const displayName = staff?.display_name ?? staff?.name ?? staffId;
  const isGlobalAdmin = staff?.global_role === "admin" || staff?.global_role === "executive";

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

  const isAdmin = isGlobalAdmin || currentMembership.role === "project_admin";

  const today = tokyoToday();
  const todayStart = `${today}T00:00:00+09:00`;
  const todayEnd = `${today}T23:59:59+09:00`;
  const sixDaysLaterDate = new Date(); sixDaysLaterDate.setDate(sixDaysLaterDate.getDate() + 6);
  const sixDaysLater = sixDaysLaterDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  const adminClient = createAdminClient();

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
    { data: weekShiftRows },
    { data: projectSettings },
    { data: yesterdayAbsence },
    { data: tomorrowShift },
    { data: breakRoomUseRow },
    rawTasksResult,
    rawGroupsResult,
    membersResult,
    knownGroupsResult,
    rawMappingsResult,
  ] = await Promise.all([
    supabase
      .from("punch_logs")
      .select("punch_type, recorded_at")
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
      .select("reported_at, eta_minutes")
      .eq("staff_id", staffId)
      .eq("project_id", currentProjectId!)
      .gte("reported_at", todayStart)
      .lte("reported_at", todayEnd)
      .order("reported_at")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("absence_reports")
      .select("status")
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
      .select("id, title, created_at")
      .eq("project_id", currentProjectId!)
      .order("created_at", { ascending: false }),
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
      .lte("shift_date", sixDaysLater)
      .not("shift_name", "in", '("公休","休","公休日","欠勤","有休","振替休日","特別休暇","代休")')
      .order("shift_date")
      .limit(6),
    // 7日分（今日含む・全種別）
    supabase
      .from("shifts")
      .select("shift_date, shift_name, shift_start, shift_end")
      .eq("staff_id", staffId)
      .eq("project_id", currentProjectId!)
      .gte("shift_date", today)
      .lte("shift_date", sixDaysLater)
      .order("shift_date"),
    adminClient
      .from("project_settings")
      .select("enable_departure_report")
      .eq("project_id", currentProjectId!)
      .maybeSingle(),
    // 前日欠勤チェック（軽快状況の表示判定用）
    supabase
      .from("absence_reports")
      .select("absence_date")
      .eq("staff_id", staffId)
      .eq("project_id", currentProjectId!)
      .eq("absence_date", yesterdayStr)
      .maybeSingle(),
    // 翌日シフトチェック（翌日出勤予定の自動表示用）
    supabase
      .from("shifts")
      .select("shift_date")
      .eq("staff_id", staffId)
      .eq("project_id", currentProjectId!)
      .eq("shift_date", tomorrowStr)
      .not("shift_name", "in", '("公休","休","公休日","欠勤","有休","振替休日","特別休暇","代休")')
      .maybeSingle(),
    // 休憩室の入室状態（本人・当日）
    adminClient
      .from("break_room_uses")
      .select("box_number, entered_at")
      .eq("project_id", currentProjectId!)
      .eq("staff_id", staffId)
      .eq("use_date", today)
      .maybeSingle(),
    // タスク関連（管理者のみ使用）
    isAdmin
      ? supabase.from("group_tasks")
          .select("id, title, description, assignee_staff_id, assignee_raw, due_text, due_date, status, group_id, created_at, completed_at, source_messages")
          .eq("project_id", currentProjectId!).in("status", ["pending", "done"])
          .order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] }),
    isAdmin
      ? supabase.from("task_extraction_groups")
          .select("id, group_id, group_label, enabled")
          .eq("project_id", currentProjectId!).order("created_at")
      : Promise.resolve({ data: [] }),
    isAdmin
      ? adminClient.from("project_members")
          .select("staff_id, staffs(name, display_name)")
          .eq("project_id", currentProjectId!).order("staff_id")
      : Promise.resolve({ data: [] }),
    isAdmin
      ? adminClient.from("line_groups")
          .select("group_id, joined_at").order("joined_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    isAdmin
      ? adminClient.from("line_name_mappings")
          .select("id, raw_name, staff_id")
          .eq("project_id", currentProjectId!).order("raw_name")
      : Promise.resolve({ data: [] }),
  ]);

  const readIds = new Set((readNotices ?? []).map(r => r.notice_id as string));
  const unreadCount = (allNotices ?? []).filter(n => !readIds.has(n.id as string)).length;

  // お知らせタイムライン（最新3件）
  const recentNotices = (allNotices ?? []).slice(0, 3).map(n => ({
    id:        n.id as string,
    title:     (n.title as string) ?? "",
    createdAt: new Date(n.created_at as string).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }),
  }));

  // 7日分スケジュール
  function addDays(base: string, days: number): string {
    const [y, m, d] = base.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }
  const weekShiftMap = new Map((weekShiftRows ?? []).map(s => [s.shift_date as string, s]));
  const weekSchedule = Array.from({ length: 7 }, (_, i) => {
    const dateStr = addDays(today, i);
    const s = weekShiftMap.get(dateStr);
    return {
      date:  dateStr,
      name:  (s?.shift_name  as string | null) ?? null,
      start: (s?.shift_start as string | null) ?? null,
      end:   (s?.shift_end   as string | null) ?? null,
    };
  });

  const clockInEntry = todayPunches?.find((p) => p.punch_type === "clock_in");
  const clockOutEntry = [...(todayPunches ?? [])]
    .reverse()
    .find((p) => p.punch_type === "clock_out");

  // ── 共通の home props ──
  const homeProps = {
    displayName,
    projectName: currentProject?.name ?? "",
    hasMultipleProjects: activeMemberships.length > 1,
    todayLabel: getTodayLabel(),
    shift: todayShift
      ? { name: todayShift.shift_name, start: todayShift.shift_start, end: todayShift.shift_end }
      : null,
    departureTime: todayDeparture?.reported_at ? fmtTime(todayDeparture.reported_at) : null,
    clockInTime:   clockInEntry?.recorded_at   ? fmtTime(clockInEntry.recorded_at)   : null,
    clockOutTime:  clockOutEntry?.recorded_at  ? fmtTime(clockOutEntry.recorded_at)  : null,
    hasAbsenceReport: !!todayAbsence,
    absenceStatus: todayAbsence?.status ?? null,
    hasLateReport: !!todayLate,
    lateStatus: todayLate?.status ?? null,
    enableDeparture: (projectSettings as { enable_departure_report?: boolean | null } | null)?.enable_departure_report ?? true,
    hasPrevAbsence: !!yesterdayAbsence,
    nextDayHasShift: !!tomorrowShift,
    noticeCount: unreadCount,
    recentNotices,
    weekSchedule,
    upcomingShifts: (upcomingShiftRows ?? []).map(s => ({
      date:  s.shift_date  as string,
      name:  s.shift_name  as string | null,
      start: s.shift_start as string | null,
      end:   s.shift_end   as string | null,
    })),
    breakRoomUse: breakRoomUseRow
      ? {
          boxNumber: (breakRoomUseRow as { box_number: number }).box_number,
          enteredAt: fmtTime((breakRoomUseRow as { entered_at: string }).entered_at),
        }
      : null,
    myStaffId: staffId,
    myRpgCharId: (staff as { rpg_character?: number | null } | null)?.rpg_character ?? null,
  };

  // ── 管理者・運用者はタスクタブ付きラッパーを返す ──
  if (isAdmin) {
    const rawTasks    = rawTasksResult.data ?? [];
    const rawGroups   = rawGroupsResult.data ?? [];
    const members     = membersResult.data ?? [];
    const knownGroups = knownGroupsResult.data ?? [];
    const rawMappings = rawMappingsResult.data ?? [];

    const staffNameMap = new Map<string, string>();
    for (const m of members) {
      const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
        { name: string | null; display_name: string | null } | null;
      staffNameMap.set(m.staff_id, s?.display_name ?? s?.name ?? m.staff_id);
    }
    const groupLabelMap = new Map<string, string | null>();
    for (const g of rawGroups) groupLabelMap.set(g.group_id, g.group_label ?? null);

    const tasks: GroupTask[] = rawTasks.map(t => ({
      id: t.id, title: t.title, description: t.description,
      assignee_staff_id: t.assignee_staff_id, assignee_raw: t.assignee_raw,
      due_text: t.due_text, due_date: t.due_date, status: t.status,
      group_id: t.group_id, group_label: groupLabelMap.get(t.group_id) ?? null,
      created_at: t.created_at, completed_at: t.completed_at,
      assignee_name: t.assignee_staff_id ? (staffNameMap.get(t.assignee_staff_id) ?? null) : null,
      source_messages: (t.source_messages as { sent_at: string; user_id: string; text: string }[] | null) ?? null,
    }));

    const taskGroups: TaskGroup[] = rawGroups.map(g => ({
      id: g.id, group_id: g.group_id, group_label: g.group_label, enabled: g.enabled,
    }));

    const staffOptions: StaffOption[] = members.map(m => {
      const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
        { name: string | null; display_name: string | null } | null;
      return { staffId: m.staff_id, name: s?.display_name ?? s?.name ?? m.staff_id };
    });

    const registeredGroupIds = new Set(rawGroups.map(g => g.group_id));
    const discoveredGroups   = (knownGroups ?? [])
      .filter(g => !registeredGroupIds.has(g.group_id))
      .map(g => ({ group_id: g.group_id }));

    const nameMappings: NameMapping[] = rawMappings.map(m => ({
      id: m.id, rawName: m.raw_name, staffId: m.staff_id,
      staffName: staffNameMap.get(m.staff_id) ?? m.staff_id,
    }));

    const pendingTaskCount = tasks.filter(t => t.status === "pending").length;

    return (
      <AdminHomeWrapper
        {...homeProps}
        tasks={tasks}
        taskGroups={taskGroups}
        staffOptions={staffOptions}
        projectId={currentProjectId!}
        discoveredGroups={discoveredGroups}
        myStaffId={staffId}
        nameMappings={nameMappings}
        pendingTaskCount={pendingTaskCount}
      />
    );
  }

  return <HomeClient {...homeProps} />;
}
