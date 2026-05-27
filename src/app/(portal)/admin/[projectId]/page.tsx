import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { isGSheetsConfigured } from "@/lib/gsheets";
import { archiveProjectAction } from "./settings/actions";
import { SettingsContainer } from "./settings/SettingsClient";
import { type SeatItem, type WallItem } from "./settings/SeatLayoutEditor";
import { ChevronLeftIcon } from "@/components/icons";
import { Suspense } from "react";

export default async function ProjectDetailPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await props.params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: myStaff } = await supabase
    .from("staffs").select("global_role")
    .eq("id", staffId).maybeSingle();

  const isExecutive = myStaff?.global_role === "executive";
  const isAdmin     = myStaff?.global_role === "admin";

  // project_admin（案件管理者）も自分の担当案件にアクセス可
  const { data: membership } = await supabase
    .from("project_members").select("role")
    .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
  const isProjectAdmin = membership?.role === "project_admin";

  if (!isExecutive && !isAdmin && !isProjectAdmin) redirect("/dashboard");

  // 過去30日の範囲
  const now30 = new Date();
  const d30   = new Date(now30.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10);
  const dateFrom30 = fmt(d30);
  const dateTo30   = fmt(now30);

  const admin30 = createAdminClient();

  const [
    { data: project },
    { data: members },
    { data: settings },
    { data: shiftPatterns },
    { data: recentShifts },
    { data: recentPunches },
    { data: seatsRaw },
    { data: wallsRaw },
    { data: trainingsRaw },
  ] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
    supabase.from("project_members")
      .select("staff_id, role, section, sections, work_days_type, work_days_count, preferred_shift, preferred_section, max_consecutive_days, start_date, end_date, staffs(name, display_name, company_name, line_user_id, account_number)")
      .eq("project_id", projectId),
    createAdminClient().from("project_settings").select("sheet_url, notification_settings, line_group_id, enable_departure_report").eq("project_id", projectId).maybeSingle(),
    createAdminClient().from("shift_patterns")
      .select("id, name, short_name, start_time, end_time, required_count, required_weekday, required_weekend, section, target_role")
      .eq("project_id", projectId).order("sort_order"),
    // 勤怠順守率計算用：過去30日のシフト
    admin30.from("shifts")
      .select("staff_id, shift_date, shift_name")
      .eq("project_id", projectId)
      .gte("shift_date", dateFrom30)
      .lte("shift_date", dateTo30),
    // 勤怠順守率計算用：過去30日の打刻（出勤のみ）
    admin30.from("punch_logs")
      .select("staff_id, punch_type, recorded_at")
      .eq("project_id", projectId)
      .eq("punch_type", "clock_in")
      .gte("recorded_at", dateFrom30 + "T00:00:00+09:00")
      .lte("recorded_at", dateTo30   + "T23:59:59+09:00"),
    // 座席レイアウト
    createAdminClient().from("seats")
      .select("id, label, x_pct, y_pct, section")
      .eq("project_id", projectId).eq("is_active", true),
    // 壁レイアウト
    createAdminClient().from("seat_walls")
      .select("id, x1_pct, y1_pct, x2_pct, y2_pct")
      .eq("project_id", projectId),
    // 研修日（全案件共通）
    createAdminClient().from("staff_trainings")
      .select("id, staff_id, training_date, training_name, start_time, end_time"),
  ]);

  if (!project) redirect("/admin");

  // 勤怠順守率: 過去30日の割当シフト日数 vs 実打刻日数
  const assignedDates = new Map<string, Set<string>>();
  for (const s of (recentShifts ?? [])) {
    const name = s.shift_name as string | null;
    if (!name || name === "公休" || name === "希望休") continue;
    if (!assignedDates.has(s.staff_id)) assignedDates.set(s.staff_id, new Set());
    assignedDates.get(s.staff_id)!.add(s.shift_date as string);
  }
  const attendedDates = new Map<string, Set<string>>();
  for (const p of (recentPunches ?? [])) {
    const jst = new Date(new Date(p.recorded_at as string).getTime() + 9 * 60 * 60 * 1000);
    const dateStr = jst.toISOString().slice(0, 10);
    if (!attendedDates.has(p.staff_id)) attendedDates.set(p.staff_id, new Set());
    attendedDates.get(p.staff_id)!.add(dateStr);
  }
  const complianceMap = new Map<string, number>();
  for (const [staffId, assigned] of assignedDates) {
    if (assigned.size === 0) continue;
    const attended = attendedDates.get(staffId);
    let hit = 0;
    for (const d of assigned) if (attended?.has(d)) hit++;
    complianceMap.set(staffId, Math.round(hit / assigned.size * 100));
  }

  const patternList = (shiftPatterns ?? []).map((p) => ({
    id:          p.id,
    name:        p.name,
    short_name:  (p as { short_name?: string }).short_name ?? "",
    start_time:  (p.start_time ?? "") as string,
    end_time:    (p.end_time   ?? "") as string,
    section:     (p as { section?: string | null }).section ?? "",
    target_role: (p as { target_role?: string }).target_role ?? "all",
  }));

  // 研修日をスタッフIDごとにまとめる
  const trainingMap = new Map<string, { id: string; training_date: string; training_name: string | null; start_time: string | null; end_time: string | null }[]>();
  for (const t of (trainingsRaw ?? [])) {
    if (!trainingMap.has(t.staff_id)) trainingMap.set(t.staff_id, []);
    trainingMap.get(t.staff_id)!.push({
      id:            t.id,
      training_date: t.training_date as string,
      training_name: (t as { training_name?: string | null }).training_name ?? null,
      start_time:    (t as { start_time?: string | null }).start_time ?? null,
      end_time:      (t as { end_time?: string | null }).end_time ?? null,
    });
  }

  const memberList = (members ?? []).map((m) => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null; company_name: string | null; line_user_id: string | null; account_number: string | null } | null;
    return {
      staffId:         m.staff_id,
      name:            s?.display_name ?? s?.name ?? m.staff_id,
      company_name:    s?.company_name ?? null,
      role:            m.role ?? "staff",
      lineLinked:      !!s?.line_user_id,
      line_user_id:    s?.line_user_id ?? null,
      section:         m.section ?? null,
      sections:        ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean),
      account_number:  s?.account_number ?? null,
      shift_note:      (m as { shift_note?: string | null }).shift_note ?? null,
      work_days_type:       (m as { work_days_type?: string | null }).work_days_type ?? null,
      work_days_count:      (m as { work_days_count?: number | null }).work_days_count ?? null,
      preferred_shift:      (m as { preferred_shift?: string | null }).preferred_shift ?? null,
      preferred_section:    (m as { preferred_section?: string | null }).preferred_section ?? null,
      max_consecutive_days: (m as { max_consecutive_days?: number | null }).max_consecutive_days ?? null,
      start_date:           (m as { start_date?: string | null }).start_date ?? null,
      end_date:             (m as { end_date?: string | null }).end_date ?? null,
      compliance:           complianceMap.get(m.staff_id) ?? null,
      trainingDates:        (trainingMap.get(m.staff_id) ?? [])
        .sort((a, b) => a.training_date.localeCompare(b.training_date)),
    };
  });

  const initialWalls: WallItem[] = (wallsRaw ?? []).map(w => ({
    id:     w.id,
    localId: w.id,
    x1Pct: w.x1_pct as number, y1Pct: w.y1_pct as number,
    x2Pct: w.x2_pct as number, y2Pct: w.y2_pct as number,
  }));

  const initialSeats: SeatItem[] = (seatsRaw ?? []).map(s => ({
    id:      s.id,
    localId: s.id,
    label:   s.label as string,
    xPct:    s.x_pct as number,
    yPct:    s.y_pct as number,
    section: (s.section as string | null) ?? "",
  }));

  async function archiveAction(fd: FormData) {
    "use server";
    fd.set("projectId", projectId);
    await archiveProjectAction(fd);
  }

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-4">
          <a href={isExecutive ? "/admin" : "/dashboard"}
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-600 transition-colors mb-1.5">
            <ChevronLeftIcon className="w-3.5 h-3.5" />
            {isExecutive ? "案件一覧" : "ホーム"}
          </a>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{project.name}</h1>
          <p className="text-sm font-semibold text-zinc-400 mt-0.5 font-mono">{projectId}</p>
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-20">

        <Suspense>
          <SettingsContainer
            projectId={projectId}
            projectName={project.name}
            currentUrl={settings?.sheet_url ?? null}
            isGSheetsConfigured={isGSheetsConfigured()}
            members={memberList}
            shiftPatterns={patternList}
            notificationSettings={
              (settings?.notification_settings as Record<string, boolean> | null) ?? {}
            }
            lineGroupId={settings?.line_group_id ?? null}
            enableDeparture={(settings as { enable_departure_report?: boolean | null } | null)?.enable_departure_report ?? true}
            archiveAction={archiveAction}
            canArchive={isExecutive || isAdmin}
            initialSeats={initialSeats}
            initialWalls={initialWalls}
          />
        </Suspense>
      </div>
    </main>
  );
}
