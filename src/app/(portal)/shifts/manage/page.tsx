/**
 * シフト管理画面（案件管理者・運用者用）
 * タブ: シフト（確認・編集） / シフト設定（パターン・仮組） / 希望休設定（申請・ルール）
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import ShiftManageClient from "./ShiftManageClient";
import ShiftSettingsTab from "./ShiftSettingsTab";
import ShiftHolidayTab from "./ShiftHolidayTab";
import type { ChangeLog } from "./ShiftEditGrid";
import type { GridDraftEntry } from "../actions";
import PublishButton from "./PublishButton";
import HeaderHeightSetter from "./HeaderHeightSetter";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

type Tab = "shift" | "settings" | "holiday";

function dateKey(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" })
    .format(d)
    .slice(0, 10);
}

export default async function ManageShiftsPage(props: {
  searchParams: Promise<{ year?: string; month?: string; project?: string; tab?: string }>;
}) {
  const searchParams = await props.searchParams;
  const tab = ((searchParams.tab ?? "shift") as Tab);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: myStaff } = await supabase
    .from("staffs").select("global_role").eq("id", myStaffId).maybeSingle();

  const isGlobalAdmin =
    myStaff?.global_role === "admin" || myStaff?.global_role === "executive";

  // ── プロジェクト選択 ──────────────────────────────────────
  let selectedProjectId: string | null;
  let allProjects: { id: string; name: string }[] = [];

  if (isGlobalAdmin) {
    const adminClient = createAdminClient();
    const { data: projects } = await adminClient
      .from("projects").select("id, name").eq("is_active", true).order("id");
    allProjects = projects ?? [];
    const cookieProjectId = await getCurrentProjectId();
    selectedProjectId =
      searchParams.project ??
      (cookieProjectId && allProjects.some(p => p.id === cookieProjectId) ? cookieProjectId : null) ??
      allProjects[0]?.id ?? null;
  } else {
    selectedProjectId = await getCurrentProjectId();
    if (!selectedProjectId) redirect("/select-project");

    const { data: pm } = await supabase
      .from("project_members").select("role")
      .eq("staff_id", myStaffId).eq("project_id", selectedProjectId).maybeSingle();
    if (pm?.role !== "project_admin") redirect("/shifts");
  }

  if (!selectedProjectId) redirect("/select-project");

  const admin = createAdminClient();

  // 月の設定（タブ問わず URL パラメータを保持するために常に計算）
  const now = new Date();
  const targetYear  = Number(searchParams.year  ?? now.getFullYear());
  const targetMonth = Number(searchParams.month ?? now.getMonth() + 1);

  // ── URL ビルダー ──────────────────────────────────────────
  const projectParam = isGlobalAdmin ? `project=${selectedProjectId}&` : "";
  const monthParam   = `year=${targetYear}&month=${targetMonth}`;

  function tabUrl(t: Tab) {
    if (t === "shift") return `/shifts/manage?${projectParam}tab=shift&${monthParam}`;
    return `/shifts/manage?${projectParam}tab=${t}`;
  }
  function projectTabUrl(pid: string) {
    return `/shifts/manage?project=${pid}&tab=${tab}${tab === "shift" ? `&${monthParam}` : ""}`;
  }

  // ── 案件名取得（共通） ────────────────────────────────────
  const { data: project } = await admin
    .from("projects").select("id, name").eq("id", selectedProjectId).maybeSingle();

  // ── タブ別コンテンツ取得 ──────────────────────────────────

  // ── シフト設定タブ ──
  if (tab === "settings") {
    const { data: shiftPatternFull } = await admin
      .from("shift_patterns")
      .select("id, name, short_name, start_time, end_time, section, target_role, required_count, required_weekday, required_weekend")
      .eq("project_id", selectedProjectId)
      .order("sort_order");

    const patternList = (shiftPatternFull ?? []).map(p => ({
      id:               (p as { id?: string }).id ?? undefined,
      name:             p.name,
      short_name:       (p as { short_name?: string }).short_name ?? "",
      start_time:       (p.start_time ?? "") as string,
      end_time:         (p.end_time   ?? "") as string,
      section:          (p as { section?: string | null }).section ?? "",
      target_role:      (p as { target_role?: string }).target_role ?? "all",
      required_count:   (p as { required_count?: number | null }).required_count   ?? null,
      required_weekday: (p as { required_weekday?: number | null }).required_weekday ?? null,
      required_weekend: (p as { required_weekend?: number | null }).required_weekend ?? null,
    }));

    return (
      <main className="bg-white dark:bg-zinc-950 max-w-5xl mx-auto pb-24">
        <HeaderHeightSetter className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800 px-4 pt-5 space-y-2">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">シフト管理</h1>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-0.5 font-semibold">{project?.name}</p>
            </div>
          </div>
          <TabBar tab={tab} tabUrl={tabUrl} />
        </HeaderHeightSetter>
        <div className="px-4 pt-6 pb-8">
          <ShiftSettingsTab projectId={selectedProjectId} initialPatterns={patternList} />
        </div>
      </main>
    );
  }

  // ── 希望休設定タブ ──
  if (tab === "holiday") {
    const { data: holidayRulesRaw } = await admin
      .from("holiday_rules")
      .select("rule_type, value")
      .eq("project_id", selectedProjectId)
      .order("sort_order");

    const holidayRules = (holidayRulesRaw ?? []).map(r => ({
      rule_type: r.rule_type as string,
      value:     String(r.value),
    }));

    return (
      <main className="bg-white dark:bg-zinc-950 max-w-5xl mx-auto pb-24">
        <HeaderHeightSetter className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800 px-4 pt-5 space-y-2">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">シフト管理</h1>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-0.5 font-semibold">{project?.name}</p>
            </div>
          </div>
          <TabBar tab={tab} tabUrl={tabUrl} />
        </HeaderHeightSetter>
        <div className="px-4 pt-6 pb-8">
          <ShiftHolidayTab projectId={selectedProjectId} initialRules={holidayRules} />
        </div>
      </main>
    );
  }

  // ── シフトタブ（デフォルト） ──────────────────────────────
  const startDate = dateKey(new Date(targetYear, targetMonth - 1, 1));
  const endDate   = dateKey(new Date(targetYear, targetMonth,     0));

  const shiftSelect = () =>
    admin.from("shifts")
      .select("id, staff_id, shift_date, shift_name, shift_start, shift_end, note")
      .eq("project_id", selectedProjectId)
      .gte("shift_date", startDate)
      .lte("shift_date", endDate)
      .order("shift_date")
      .order("staff_id");

  const [
    { data: members },
    { data: shiftPatternRows },
    { data: shiftRequestsRaw },
    { data: slotRequirementsRaw },
    { data: changeLogsRaw },
    { data: staffsForLogs },
    { data: absenceRows },
    { data: draftRow },
    { data: offRequestsRaw },
    { data: monthStatusRow },
    { data: trainingsRaw },
    shiftBatch0,
    shiftBatch1,
    shiftBatch2,
    shiftBatch3,
    shiftBatch4,
  ] = await Promise.all([
    admin.from("project_members")
      .select("staff_id, role, section, sections, end_date, work_days_type, work_days_count, preferred_shift, preferred_section, max_consecutive_days, shift_note, staffs(id, name, display_name)")
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
    admin.from("shift_change_logs")
      .select("staff_id, shift_date, action, before_data, after_data, changed_by, changed_at")
      .eq("project_id", selectedProjectId)
      .gte("shift_date", startDate)
      .lte("shift_date", endDate)
      .order("changed_at", { ascending: false })
      .limit(300),
    admin.from("staffs").select("id, display_name, name"),
    admin.from("absence_reports")
      .select("staff_id, absence_date")
      .eq("project_id", selectedProjectId)
      .gte("absence_date", startDate)
      .lte("absence_date", endDate),
    admin.from("shift_grid_drafts")
      .select("draft_data, saved_by, saved_at, locked_sections")
      .eq("project_id", selectedProjectId)
      .eq("target_month", `${targetYear}-${String(targetMonth).padStart(2, "0")}`)
      .maybeSingle(),
    admin.from("shift_off_requests")
      .select("staff_id, request_date, priority, source")
      .eq("project_id", selectedProjectId)
      .gte("request_date", startDate)
      .lte("request_date", endDate),
    admin.from("shift_month_status")
      .select("published_at")
      .eq("project_id", selectedProjectId)
      .eq("year_month", `${targetYear}-${String(targetMonth).padStart(2, "0")}`)
      .maybeSingle(),
    admin.from("staff_trainings")
      .select("id, staff_id, training_date")
      .eq("training_type", "onboarding"),
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

  const absenceSet = new Set(
    (absenceRows ?? []).map(a => `${a.staff_id}__${a.absence_date}`)
  );

  // 研修日をスタッフIDごとにまとめる
  const trainingMap = new Map<string, { id: string; training_date: string }[]>();
  for (const t of (trainingsRaw ?? [])) {
    if (!trainingMap.has(t.staff_id)) trainingMap.set(t.staff_id, []);
    trainingMap.get(t.staff_id)!.push({ id: t.id, training_date: t.training_date as string });
  }

  const activeMembers = (members ?? [])
    .map((m) => {
      const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
        { id: string | null; name: string | null; display_name: string | null } | null;
      const sections = ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean);
      const endDate = (m as { end_date?: string | null }).end_date ?? null;
      const staffId = s?.id ?? m.staff_id;
      return {
        id:                   staffId,
        name:                 s?.display_name ?? s?.name ?? m.staff_id,
        role:                 m.role ?? "staff",
        section:              m.section ?? null,
        sections:             sections.length > 0 ? sections : (m.section ? [m.section] : []),
        endDate,
        work_days_type:       (m as { work_days_type?: string | null }).work_days_type ?? null,
        work_days_count:      (m as { work_days_count?: number | null }).work_days_count ?? null,
        preferred_shift:      (m as { preferred_shift?: string | null }).preferred_shift ?? null,
        preferred_section:    (m as { preferred_section?: string | null }).preferred_section ?? null,
        max_consecutive_days: (m as { max_consecutive_days?: number | null }).max_consecutive_days ?? null,
        shift_note:           (m as { shift_note?: string | null }).shift_note ?? null,
        trainingDates:        (trainingMap.get(staffId) ?? [])
          .sort((a, b) => a.training_date.localeCompare(b.training_date)),
      };
    })
    .filter((m) => !!m.id)
    .filter((m) => !m.endDate || m.endDate >= startDate) as {
      id: string; name: string; role: string; section: string | null; sections: string[]; endDate: string | null;
      work_days_type: string | null; work_days_count: number | null;
      preferred_shift: string | null; preferred_section: string | null;
      max_consecutive_days: number | null; shift_note: string | null;
    }[];

  const staffNameMap = new Map(activeMembers.map(m => [m.id, m.name]));

  const shiftRequests = (shiftRequestsRaw ?? []).map(r => {
    const opening = Array.isArray(r.shift_openings) ? r.shift_openings[0] : r.shift_openings;
    return {
      id:           r.id,
      staff_name:   staffNameMap.get(r.staff_id) ?? r.staff_id,
      request_date: r.request_date,
      shift_name:   (opening as { shift_name: string } | null)?.shift_name ?? null,
      shift_start:  (opening as { shift_start: string } | null)?.shift_start ?? null,
      shift_end:    (opening as { shift_end: string } | null)?.shift_end ?? null,
      reason:       r.reason ?? null,
      status:       r.status,
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
      changed_at:        l.changed_at as string,
    };
  });

  const isPublished = !!monthStatusRow;
  const initialDraft = draftRow ? (draftRow.draft_data as GridDraftEntry[]) : null;
  const draftSavedBy = draftRow?.saved_by
    ? (staffNameMap2.get(draftRow.saved_by as string) ?? draftRow.saved_by as string)
    : null;
  const draftSavedAt = draftRow?.saved_at as string | null ?? null;
  const lockedSections = (draftRow?.locked_sections as string[] | null) ?? [];

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const allDates = Array.from({ length: daysInMonth }, (_, i) =>
    dateKey(new Date(targetYear, targetMonth - 1, i + 1))
  );
  const todayStr    = dateKey(new Date());
  const defaultDate = allDates.includes(todayStr) ? todayStr : allDates[0] ?? "";

  const prevMonth = (() => {
    const d = new Date(targetYear, targetMonth - 2, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  })();
  const nextMonth = (() => {
    const d = new Date(targetYear, targetMonth, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  })();

  const monthNavBase = isGlobalAdmin
    ? `/shifts/manage?project=${selectedProjectId}&tab=shift&year=`
    : `/shifts/manage?tab=shift&year=`;

  return (
    <main className="bg-white dark:bg-zinc-950">

      <HeaderHeightSetter id="shift-manage-header" className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 pt-5 space-y-2">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                シフト管理
              </h1>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-0.5 font-semibold">{project?.name}</p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <PublishButton projectId={selectedProjectId} year={targetYear} month={targetMonth} isPublished={isPublished} />
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

          <TabBar tab={tab} tabUrl={tabUrl} />
        </div>
      </HeaderHeightSetter>

      <ShiftManageClient
          projectId={selectedProjectId}
          allDates={allDates}
          defaultDate={defaultDate}
          shifts={shiftsRaw ?? []}
          activeMembers={activeMembers}
          shiftPatterns={shiftPatterns}
          shiftRequests={shiftRequests}
          slotRequirements={slotRequirements}
          targetYear={targetYear}
          targetMonth={targetMonth}
          changeLogs={changeLogs}
          absenceSet={absenceSet}
          initialDraft={initialDraft}
          draftSavedBy={draftSavedBy}
          draftSavedAt={draftSavedAt}
          isPublished={isPublished}
          lockedSections={lockedSections}
          offRequests={(offRequestsRaw ?? []).map(r => ({
            staff_id:     r.staff_id as string,
            request_date: r.request_date as string,
            priority:     r.priority as string,
            source:       (r as { source?: string }).source ?? "user",
          }))}
      />
    </main>
  );
}

// ── ヘルパーコンポーネント ──────────────────────────────────────

function TabBar({
  tab,
  tabUrl,
}: {
  tab: Tab;
  tabUrl: (t: Tab) => string;
}) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "shift",    label: "シフト" },
    { id: "settings", label: "シフト設定" },
    { id: "holiday",  label: "希望休設定" },
  ];
  return (
    <div className="flex overflow-x-auto -mx-4 px-4 border-b border-zinc-100 dark:border-zinc-800 -mb-2" style={{ scrollbarWidth: "none" }}>
      {tabs.map(t => (
        <a
          key={t.id}
          href={tabUrl(t.id)}
          className={[
            "px-4 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors flex-shrink-0",
            t.id === tab
              ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
              : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
          ].join(" ")}
        >
          {t.label}
        </a>
      ))}
    </div>
  );
}


