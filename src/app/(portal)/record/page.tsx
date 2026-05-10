/**
 * 勤怠実績（スタッフ用）
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import RecordClient from "./RecordClient";

function tokyoToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function parseTimeMin(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function isoToJSTMin(iso: string): number {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCHours() * 60 + jst.getUTCMinutes();
}

export default async function RecordPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  // 対象月
  const today = tokyoToday();
  const targetMonth = monthParam ?? today.slice(0, 7);
  const [y, m] = targetMonth.split("-").map(Number);
  const monthStart = `${targetMonth}-01`;
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthEnd = `${targetMonth}-${String(daysInMonth).padStart(2, "0")}`;

  const prevDate = new Date(y, m - 2, 1);
  const nextDate = new Date(y, m, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;

  const rangeStart = `${monthStart}T00:00:00+09:00`;
  const rangeEnd   = `${monthEnd}T23:59:59+09:00`;

  const [{ data: punches }, { data: shifts }, { data: corrections }] =
    await Promise.all([
      supabase
        .from("punch_logs")
        .select("id, punch_type, recorded_at")
        .eq("staff_id", staffId)
        .eq("project_id", projectId)
        .gte("recorded_at", rangeStart)
        .lte("recorded_at", rangeEnd)
        .order("recorded_at"),
      supabase
        .from("shifts")
        .select("shift_date, shift_name, shift_start, shift_end")
        .eq("staff_id", staffId)
        .eq("project_id", projectId)
        .gte("shift_date", monthStart)
        .lte("shift_date", monthEnd)
        .order("shift_date"),
      supabase
        .from("punch_corrections")
        .select("id, target_date, status")
        .eq("staff_id", staffId)
        .eq("project_id", projectId)
        .gte("target_date", monthStart)
        .lte("target_date", monthEnd),
    ]);

  // 日付ごとに集約
  type DayRecord = {
    date: string;
    dow: number;
    shiftName: string | null;
    shiftStart: string | null;
    shiftEnd: string | null;
    clockIn: string | null;
    clockOut: string | null;
    clockInIso: string | null;
    clockOutIso: string | null;
  };

  const shiftMap = new Map((shifts ?? []).map((s) => [s.shift_date, s]));

  const punchByDate = new Map<
    string,
    { clockIn: string | null; clockOut: string | null; clockInIso: string | null; clockOutIso: string | null }
  >();
  for (const p of punches ?? []) {
    const d = new Date(p.recorded_at).toLocaleDateString("sv-SE", {
      timeZone: "Asia/Tokyo",
    });
    if (!punchByDate.has(d)) {
      punchByDate.set(d, { clockIn: null, clockOut: null, clockInIso: null, clockOutIso: null });
    }
    const entry = punchByDate.get(d)!;
    if (p.punch_type === "clock_in" && !entry.clockIn) {
      entry.clockIn    = fmtTime(p.recorded_at);
      entry.clockInIso = p.recorded_at;
    }
    if (p.punch_type === "clock_out") {
      entry.clockOut    = fmtTime(p.recorded_at);
      entry.clockOutIso = p.recorded_at;
    }
  }

  const records: DayRecord[] = Array.from({ length: daysInMonth }, (_, i) => {
    const d  = i + 1;
    const ds = `${targetMonth}-${String(d).padStart(2, "0")}`;
    const dt = new Date(`${ds}T00:00:00+09:00`);
    const s  = shiftMap.get(ds);
    const p  = punchByDate.get(ds);
    return {
      date:       ds,
      dow:        dt.getDay(),
      shiftName:  s?.shift_name  ?? null,
      shiftStart: s?.shift_start ?? null,
      shiftEnd:   s?.shift_end   ?? null,
      clockIn:    p?.clockIn     ?? null,
      clockOut:   p?.clockOut    ?? null,
      clockInIso: p?.clockInIso  ?? null,
      clockOutIso: p?.clockOutIso ?? null,
    };
  });

  // 集計
  const workDays = records.filter(
    (r) => r.clockIn && r.shiftName !== "公休" && r.shiftName !== "休"
  ).length;
  const totalMinutes = records.reduce((acc, r) => {
    if (r.clockInIso && r.clockOutIso) {
      return (
        acc +
        Math.round(
          (new Date(r.clockOutIso).getTime() - new Date(r.clockInIso).getTime()) / 60000
        )
      );
    }
    return acc;
  }, 0);
  const totalH   = Math.floor(totalMinutes / 60);
  const totalM   = totalMinutes % 60;
  const totalStr = totalMinutes > 0
    ? totalM > 0 ? `${totalH}h${totalM}m` : `${totalH}h`
    : "-";

  const isFuture = targetMonth > today.slice(0, 7);

  // 勤怠順守率の計算（当月の過去日のみ）
  const GRACE = 5; // 遅刻・早退の猶予分
  let scheduledDays = 0, absentDays = 0, lateDays = 0, earlyDays = 0, compliantDays = 0;
  for (const r of records) {
    if (r.date > today) continue;
    if (!r.shiftName || r.shiftName === "公休" || r.shiftName === "休") continue;
    scheduledDays++;

    if (!r.clockInIso) {
      absentDays++;
      continue;
    }

    let isLate = false, isEarly = false;

    const shiftStartMin = parseTimeMin(r.shiftStart);
    if (shiftStartMin !== null) {
      if (isoToJSTMin(r.clockInIso) > shiftStartMin + GRACE) isLate = true;
    }

    if (r.clockOutIso) {
      const shiftEndMin = parseTimeMin(r.shiftEnd);
      if (shiftEndMin !== null) {
        if (isoToJSTMin(r.clockOutIso) < shiftEndMin - GRACE) isEarly = true;
      }
    }

    if (isLate)  lateDays++;
    if (isEarly) earlyDays++;
    if (!isLate && !isEarly) compliantDays++;
  }
  const complianceRate = scheduledDays > 0
    ? Math.round((compliantDays / scheduledDays) * 100)
    : null;

  return (
    <RecordClient
      records={records}
      corrections={corrections ?? []}
      projectName={project?.name ?? ""}
      year={y}
      month={m}
      prevMonth={prevMonth}
      nextMonth={nextMonth}
      workDays={workDays}
      totalStr={totalStr}
      today={today}
      isFuture={isFuture}
      scheduledDays={scheduledDays}
      absentDays={absentDays}
      lateDays={lateDays}
      earlyDays={earlyDays}
      complianceRate={complianceRate}
    />
  );
}
