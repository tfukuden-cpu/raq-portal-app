/**
 * シフト管理画面（案件管理者・運用者用）
 * - 管理者: 自案件のシフトを日付タブで確認・編集
 * - 運用者: 全案件タブ切替 + 日付タブで確認・編集
 * - シフトパターンの充足数/不足数をリアルタイム表示
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import ShiftManageClient from "./ShiftManageClient";
import type { ChangeLog } from "./ShiftEditGrid";
import type { GridDraftEntry } from "../actions";
import SheetMenuButton from "./SheetMenuButton";
import PublishButton from "./PublishButton";
import HeaderHeightSetter from "./HeaderHeightSetter";
import { isGSheetsConfigured } from "@/lib/gsheets";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

function dateKey(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" })
    .format(d)
    .slice(0, 10);
}

export default async function ManageShiftsPage(props: {
  searchParams: Promise<{ year?: string; month?: string; project?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: myStaff } = await supabase
    .from("staffs").select("global_role").eq("id", myStaffId).maybeSingle();

  const isGlobalAdmin =
    myStaff?.global_role === "admin" || myStaff?.global_role === "executive";

  // ── プロジェクト選択 ──────────────────────────────────────
  // グローバル管理者は全案件を参照できる（viewMode に依存しない）
  let selectedProjectId: string | null;
  let allProjects: { id: string; name: string }[] = [];

  if (isGlobalAdmin) {
    const admin = createAdminClient();
    const { data: projects } = await admin
      .from("projects").select("id, name").eq("is_active", true).order("id");
    allProjects = projects ?? [];
    // URL params → cookie の現プロジェクト → 先頭案件 の優先順位
    const cookieProjectId = await getCurrentProjectId();
    selectedProjectId =
      searchParams.project ??
      (cookieProjectId && allProjects.some(p => p.id === cookieProjectId) ? cookieProjectId : null) ??
      allProjects[0]?.id ?? null;
  } else {
    selectedProjectId = await getCurrentProjectId();
    if (!selectedProjectId) redirect("/select-project");

    // 案件管理者チェック
    const { data: pm } = await supabase
      .from("project_members").select("role")
      .eq("staff_id", myStaffId).eq("project_id", selectedProjectId).maybeSingle();
    if (pm?.role !== "project_admin") redirect("/shifts");
  }

  if (!selectedProjectId) redirect("/select-project");

  // ── データ取得（全て adminClient で RLS をバイパス） ──────────
  const admin = createAdminClient();

  // 月の設定（データ取得前に確定）
  const now = new Date();
  const targetYear  = Number(searchParams.year  ?? now.getFullYear());
  const targetMonth = Number(searchParams.month ?? now.getMonth() + 1);
  const startDate = dateKey(new Date(targetYear, targetMonth - 1, 1));
  const endDate   = dateKey(new Date(targetYear, targetMonth,     0));

  // PostgREST のデフォルト上限（1000行）を回避するため、シフトは 1000行ずつ並列取得する
  const shiftSelect = () =>
    admin.from("shifts")
      .select("id, staff_id, shift_date, shift_name, shift_start, shift_end, note")
      .eq("project_id", selectedProjectId)
      .gte("shift_date", startDate)
      .lte("shift_date", endDate)
      .order("shift_date")
      .order("staff_id");

  const [
    { data: project },
    { data: members },
    { data: shiftPatternRows },
    { data: shiftRequestsRaw },
    { data: slotRequirementsRaw },
    { data: changeLogsRaw },
    { data: staffsForLogs },
    { data: draftRow },
    shiftBatch0,
    shiftBatch1,
    shiftBatch2,
    shiftBatch3,
    shiftBatch4,
  ] = await Promise.all([
    admin.from("projects").select("id, name").eq("id", selectedProjectId).maybeSingle(),
    admin.from("project_members")
      .select("staff_id, role, section, sections, staffs(id, name, display_name)")
      .eq("project_id", selectedProjectId),
    admin.from("shift_patterns")
      .select("name, required_count, required_weekday, required_weekend, section, start_time, end_time")
      .eq("project_id", selectedProjectId)
      .order("sort_order"),
    admin.from("shift_requests")
      .select("id, staff_id, request_date, opening_id, reason, status, created_at, shift_openings(shift_name, shift_start, shift_end)")
      .eq("project_id", selectedProjectId)
      .order("request_date", { ascending: false })
      .limit(100),
    admin.from("shift_slot_requirements")
      .select("section, pattern_name, shift_date, required_count")
      .eq("project_id", selectedProjectId)
      .gte("shift_date", startDate)
      .lte("shift_date", endDate),
    // 当月の変更ログ（最新300件）
    admin.from("shift_change_logs")
      .select("staff_id, shift_date, action, before_data, after_data, changed_by, created_at")
      .eq("project_id", selectedProjectId)
      .gte("shift_date", startDate)
      .lte("shift_date", endDate)
      .order("created_at", { ascending: false })
      .limit(300),
    // 変更者名解決用
    admin.from("staffs").select("id, display_name, name"),
    // 仮保存データ
    admin.from("shift_grid_drafts")
      .select("draft_data, saved_by, saved_at")
      .eq("project_id", selectedProjectId)
      .eq("target_month", `${targetYear}-${String(targetMonth).padStart(2, "0")}`)
      .maybeSingle(),
    shiftSelect().range(0,    999),
    shiftSelect().range(1000, 1999),
    shiftSelect().range(2000, 2999),
    shiftSelect().range(3000, 3999),
    shiftSelect().range(4000, 4999),
  ]);

  const shiftsRaw = [
    ...(shiftBatch0.data ?? []),
    ...(shiftBatch1.data ?? []),
    ...(shiftBatch2.data ?? []),
    ...(shiftBatch3.data ?? []),
    ...(shiftBatch4.data ?? []),
  ];

  const activeMembers = (members ?? [])
    .map((m) => {
      const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
        { id: string | null; name: string | null; display_name: string | null } | null;
      const sections = ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean);
      return {
        id:       s?.id ?? m.staff_id,
        name:     s?.display_name ?? s?.name ?? m.staff_id,
        role:     m.role ?? "staff",
        section:  m.section ?? null,
        sections: sections.length > 0 ? sections : (m.section ? [m.section] : []),
      };
    })
    .filter((m) => !!m.id) as { id: string; name: string; role: string; section: string | null; sections: string[] }[];

  const staffNameMap = new Map(activeMembers.map(m => [m.id, m.name]));

  const shiftRequests = (shiftRequestsRaw ?? []).map(r => {
    const opening = Array.isArray(r.shift_openings) ? r.shift_openings[0] : r.shift_openings;
    return {
      id:          r.id,
      staff_name:  staffNameMap.get(r.staff_id) ?? r.staff_id,
      request_date: r.request_date,
      shift_name:  (opening as { shift_name: string } | null)?.shift_name ?? null,
      shift_start: (opening as { shift_start: string } | null)?.shift_start ?? null,
      shift_end:   (opening as { shift_end: string } | null)?.shift_end ?? null,
      reason:      r.reason ?? null,
      status:      r.status,
    };
  });

  const shiftPatterns = (shiftPatternRows ?? []).map((p) => ({
    name:             p.name,
    required_count:   Math.max(0, p.required_count ?? 0),
    required_weekday: (p as { required_weekday?: number | null }).required_weekday ?? null,
    required_weekend: (p as { required_weekend?: number | null }).required_weekend ?? null,
    section:          (p as { section?: string | null }).section ?? null,
    start_time:       (p.start_time  ?? null) as string | null,
    end_time:         (p.end_time    ?? null) as string | null,
  }));

  const slotRequirements = (slotRequirementsRaw ?? []).map(r => ({
    section:        r.section as string,
    pattern_name:   r.pattern_name as string,
    shift_date:     r.shift_date as string,
    required_count: r.required_count as number,
  }));

  const shifts = shiftsRaw ?? [];

  // ── 変更ログ整形 ──────────────────────────────────────────────
  const staffNameMap2 = new Map(
    (staffsForLogs ?? []).map((s) => [s.id as string, (s.display_name ?? s.name ?? s.id) as string])
  );
  const changeLogs: ChangeLog[] = (changeLogsRaw ?? []).map((l) => {
    const before = l.before_data as { shift_name?: string | null } | null;
    const after  = l.after_data  as { shift_name?: string | null } | null;
    return {
      staff_id:          l.staff_id as string,
      shift_date:        l.shift_date as string,
      action:            l.action as string,
      before_shift_name: before?.shift_name ?? null,
      after_shift_name:  after?.shift_name  ?? null,
      changed_by_name:   staffNameMap2.get(l.changed_by as string) ?? (l.changed_by as string),
      changed_at:        l.created_at as string,
    };
  });

  // ── 仮保存データ ──────────────────────────────────────────────
  const initialDraft = draftRow
    ? (draftRow.draft_data as GridDraftEntry[])
    : null;
  const draftSavedBy = draftRow?.saved_by
    ? (staffNameMap2.get(draftRow.saved_by as string) ?? draftRow.saved_by as string)
    : null;
  const draftSavedAt = draftRow?.saved_at as string | null ?? null;

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const allDates = Array.from({ length: daysInMonth }, (_, i) =>
    dateKey(new Date(targetYear, targetMonth - 1, i + 1))
  );
  const todayStr   = dateKey(new Date());
  const defaultDate = allDates.includes(todayStr) ? todayStr : allDates[0] ?? "";

  // ── 月ナビURL ─────────────────────────────────────────────
  const prevMonth = (() => {
    const d = new Date(targetYear, targetMonth - 2, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  })();
  const nextMonth = (() => {
    const d = new Date(targetYear, targetMonth, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  })();

  const monthNavBase = isGlobalAdmin
    ? `/shifts/manage?project=${selectedProjectId}&year=`
    : `/shifts/manage?year=`;

  return (
    <main className="bg-white dark:bg-zinc-950 max-w-3xl mx-auto pb-24">

      {/* ── sticky ページヘッダー ── */}
      <HeaderHeightSetter className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800 px-4 pt-5 space-y-2">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              シフト管理
            </h1>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-0.5 font-semibold">{project?.name}</p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <PublishButton projectId={selectedProjectId} year={targetYear} month={targetMonth} />
              {isGSheetsConfigured() && (
                <SheetMenuButton projectId={selectedProjectId} year={targetYear} month={targetMonth} />
              )}
            </div>
            <div className="flex items-center gap-1">
              <a href={`${monthNavBase}${prevMonth.year}&month=${prevMonth.month}`}
                className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                <ChevronLeftIcon className="w-4 h-4 text-zinc-500" />
              </a>
              <span className="text-sm font-semibold tabular-nums w-20 text-center text-zinc-900 dark:text-zinc-100">
                {targetYear}/{String(targetMonth).padStart(2, "0")}
              </span>
              <a href={`${monthNavBase}${nextMonth.year}&month=${nextMonth.month}`}
                className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                <ChevronRightIcon className="w-4 h-4 text-zinc-500" />
              </a>
            </div>
          </div>
        </div>

        {/* 案件タブ（グローバル管理者） */}
        {isGlobalAdmin && allProjects.length > 1 && (
          <div className="flex overflow-x-auto -mx-4 px-4" style={{ scrollbarWidth: "none" }}>
            {allProjects.map((p) => (
              <a
                key={p.id}
                href={`/shifts/manage?project=${p.id}&year=${targetYear}&month=${targetMonth}`}
                className={[
                  "px-4 py-2 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors flex-shrink-0",
                  p.id === selectedProjectId
                    ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100"
                    : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
                ].join(" ")}
              >
                {p.name}
              </a>
            ))}
          </div>
        )}
      </HeaderHeightSetter>

      {/* ── コンテンツ ── */}
      <div className="pt-3">
        <ShiftManageClient
          projectId={selectedProjectId}
          allDates={allDates}
          defaultDate={defaultDate}
          shifts={shifts ?? []}
          activeMembers={activeMembers}
          shiftPatterns={shiftPatterns}
          shiftRequests={shiftRequests}
          slotRequirements={slotRequirements}
          targetYear={targetYear}
          targetMonth={targetMonth}
          changeLogs={changeLogs}
          initialDraft={initialDraft}
          draftSavedBy={draftSavedBy}
          draftSavedAt={draftSavedAt}
        />
      </div>
    </main>
  );
}
