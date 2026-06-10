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

  const [{ data: punchLogs }, { data: absenceRows }, { data: breakRoomSetting }, { data: breakRoomUses }] = await Promise.all([
    admin
      .from("punch_logs")
      .select("staff_id, punch_type, note, recorded_at")
      .eq("project_id", projectId)
      .gte("recorded_at", todayStart)
      .lte("recorded_at", todayEnd)
      .order("recorded_at"),
    admin
      .from("absence_reports")
      .select("staff_id")
      .eq("project_id", projectId)
      .eq("absence_date", today),
    admin
      .from("break_room_settings")
      .select("capacity")
      .eq("project_id", projectId)
      .maybeSingle(),
    admin
      .from("break_room_uses")
      .select("box_number, staff_id, entered_at")
      .eq("project_id", projectId)
      .eq("use_date", today)
      .order("box_number"),
  ]);

  const absenceIds = new Set((absenceRows ?? []).map(a => a.staff_id));

  // staffId ごとに集計
  const map = new Map<string, {
    clockedIn: boolean;
    clockedOut: boolean;
    lastBreak: string | null;
    hadBreak60: boolean;
    breakStartedAt: string | null;
    breakNote: string | null;
  }>();

  for (const p of punchLogs ?? []) {
    if (!map.has(p.staff_id)) {
      map.set(p.staff_id, { clockedIn: false, clockedOut: false, lastBreak: null, hadBreak60: false, breakStartedAt: null, breakNote: null });
    }
    const e = map.get(p.staff_id)!;
    const note = (p as { note?: string | null }).note ?? null;
    // 管理者補正(note=admin_manual)は実打刻として扱わない＝本人が出勤打刻できる
    if (p.punch_type === "clock_in"  && note !== "admin_manual") e.clockedIn  = true;
    if (p.punch_type === "clock_out") e.clockedOut = true;
    if (p.punch_type === "break_start") {
      e.lastBreak      = "break_start";
      e.breakStartedAt = (p as { recorded_at?: string }).recorded_at ?? null;
      e.breakNote      = note;
      if (note === "休憩（60分）") e.hadBreak60 = true;
    }
    if (p.punch_type === "break_end") {
      e.lastBreak      = "break_end";
      e.breakStartedAt = null;
      e.breakNote      = null;
    }
  }

  const result = [...map.entries()].map(([staffId, v]) => ({
    staffId,
    clockedIn:      v.clockedIn,
    clockedOut:     v.clockedOut,
    onBreak:        v.lastBreak === "break_start",
    isAbsent:       absenceIds.has(staffId),
    hadBreak60:     v.hadBreak60,
    breakStartedAt: v.breakStartedAt,
    breakNote:      v.breakNote,
  }));

  // absence_reportのみあるスタッフも追加
  for (const staffId of absenceIds) {
    if (!map.has(staffId)) {
      result.push({ staffId, clockedIn: false, clockedOut: false, onBreak: false, isAbsent: true, hadBreak60: false, breakStartedAt: null, breakNote: null });
    }
  }

  const breakRoom = {
    capacity: (breakRoomSetting as { capacity?: number } | null)?.capacity ?? 6,
    uses: (breakRoomUses ?? []).map(u => ({
      boxNumber: u.box_number as number,
      staffId:   u.staff_id as string,
      enteredAt: u.entered_at as string,
    })),
  };

  return NextResponse.json({ statuses: result, breakRoom });
}
