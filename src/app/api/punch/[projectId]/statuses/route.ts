/**
 * 打刻端末用ステータスポーリング API
 * GET /api/punch/[projectId]/statuses
 * 認証不要・adminClient使用
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

function tokyoToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const admin = createAdminClient();
  const today      = tokyoToday();
  const todayStart = `${today}T00:00:00+09:00`;
  const todayEnd   = `${today}T23:59:59+09:00`;

  const [{ data: punchLogs }, { data: absenceRows }] = await Promise.all([
    admin
      .from("punch_logs")
      .select("staff_id, punch_type, note")
      .eq("project_id", projectId)
      .gte("recorded_at", todayStart)
      .lte("recorded_at", todayEnd)
      .order("recorded_at"),
    admin
      .from("absence_reports")
      .select("staff_id")
      .eq("project_id", projectId)
      .eq("absence_date", today),
  ]);

  const absenceIds = new Set((absenceRows ?? []).map(a => a.staff_id));

  // staffId ごとに集計
  const map = new Map<string, {
    clockedIn: boolean;
    clockedOut: boolean;
    lastBreak: string | null;
    hadBreak60: boolean;
  }>();

  for (const p of punchLogs ?? []) {
    if (!map.has(p.staff_id)) {
      map.set(p.staff_id, { clockedIn: false, clockedOut: false, lastBreak: null, hadBreak60: false });
    }
    const e = map.get(p.staff_id)!;
    if (p.punch_type === "clock_in")  e.clockedIn  = true;
    if (p.punch_type === "clock_out") e.clockedOut = true;
    if (p.punch_type === "break_start" || p.punch_type === "break_end") {
      e.lastBreak = p.punch_type;
    }
    if (p.punch_type === "break_start" && (p as { note?: string | null }).note === "休憩（60分）") {
      e.hadBreak60 = true;
    }
  }

  const result = [...map.entries()].map(([staffId, v]) => ({
    staffId,
    clockedIn:  v.clockedIn,
    clockedOut: v.clockedOut,
    onBreak:    v.lastBreak === "break_start",
    isAbsent:   absenceIds.has(staffId),
    hadBreak60: v.hadBreak60,
  }));

  // absence_reportのみあるスタッフも追加
  for (const staffId of absenceIds) {
    if (!map.has(staffId)) {
      result.push({ staffId, clockedIn: false, clockedOut: false, onBreak: false, isAbsent: true, hadBreak60: false });
    }
  }

  return NextResponse.json(result);
}
