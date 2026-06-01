/**
 * 現場端末打刻ページ（認証不要・adminClient使用）
 * URL: /punch/[projectId]
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import TerminalPunchClient, {
  type TerminalMember,
  type TerminalSeat,
  type TerminalWall,
} from "./TerminalPunchClient";
import { getBreakSlotSettingsAction } from "@/app/(portal)/seating/break-actions";

function tokyoToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export default async function PunchPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const admin = createAdminClient();
  const today = tokyoToday();
  const todayStart    = `${today}T00:00:00+09:00`;
  const todayEnd      = `${today}T23:59:59+09:00`;
  const currentMonth  = today.slice(0, 7); // YYYY-MM

  // プロジェクト存在確認
  const { data: project } = await admin
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) notFound();

  // 並列取得
  const [
    { data: memberRows },
    { data: todayShifts },
    { data: punchLogs },
    { data: consentRows },
    { data: seatRows },
    { data: assignmentRows },
    { data: wallRows },
    { data: absenceRows },
    { data: breakAssignmentRows },
    { data: motaAssignmentRows },
  ] = await Promise.all([
    admin
      .from("project_members")
      .select("staff_id, section, staffs(id, name, display_name, account_number)")
      .eq("project_id", projectId),
    admin
      .from("shifts")
      .select("staff_id, shift_name, shift_start, shift_end")
      .eq("project_id", projectId)
      .eq("shift_date", today),
    admin
      .from("punch_logs")
      .select("staff_id, punch_type, recorded_at, note")
      .eq("project_id", projectId)
      .gte("recorded_at", todayStart)
      .lte("recorded_at", todayEnd)
      .order("recorded_at"),
    admin
      .from("consent_records")
      .select("staff_id")
      .eq("project_id", projectId)
      .eq("consent_month", currentMonth),
    admin
      .from("seats")
      .select("id, label, x_pct, y_pct, section, seat_type, shift_slot")
      .eq("project_id", projectId)
      .eq("is_active", true),
    admin
      .from("seat_assignments")
      .select("seat_id, staff_id")
      .eq("project_id", projectId)
      .eq("assignment_date", today),
    admin
      .from("seat_walls")
      .select("x1_pct, y1_pct, x2_pct, y2_pct")
      .eq("project_id", projectId),
    admin
      .from("absence_reports")
      .select("staff_id")
      .eq("project_id", projectId)
      .eq("absence_date", today),
    admin
      .from("break_slot_assignments")
      .select("staff_id, slot_number")
      .eq("project_id", projectId)
      .eq("assignment_date", today),
    admin
      .from("mota_slot_assignments")
      .select("assigned_account, slot, account_number")
      .eq("project_id", projectId)
      .eq("assignment_date", today),
  ]);

  // 当月同意済みスタッフセット
  const consentedIds = new Set((consentRows ?? []).map(c => c.staff_id));

  // 欠勤セット
  const absenceIds = new Set((absenceRows ?? []).map(a => a.staff_id));

  // 打刻マップ（clock_in/out + 最終 break 状態 + 休憩60分済みフラグ + タイマー用）
  const punchMap = new Map<string, {
    clockedIn: boolean;
    clockedOut: boolean;
    lastBreak: string | null;
    hadBreak60: boolean;
    breakStartedAt: string | null;
    breakNote: string | null;
  }>();
  for (const p of punchLogs ?? []) {
    if (!punchMap.has(p.staff_id)) {
      punchMap.set(p.staff_id, { clockedIn: false, clockedOut: false, lastBreak: null, hadBreak60: false, breakStartedAt: null, breakNote: null });
    }
    const e = punchMap.get(p.staff_id)!;
    const note = (p as { note?: string | null }).note ?? null;
    if (p.punch_type === "clock_in")  e.clockedIn  = true;
    if (p.punch_type === "clock_out") e.clockedOut = true;
    if (p.punch_type === "break_start") {
      e.lastBreak     = "break_start";
      e.breakStartedAt = p.recorded_at;
      e.breakNote      = note;
      if (note === "休憩（60分）") e.hadBreak60 = true;
    }
    if (p.punch_type === "break_end") {
      e.lastBreak      = "break_end";
      e.breakStartedAt = null;
      e.breakNote      = null;
    }
  }

  // シフトマップ（公休系除く）
  const OFF_SHIFTS = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤"];
  const shiftMap = new Map<string, {
    shiftName: string;
    shiftStart: string | null;
    shiftEnd: string | null;
  }>();
  for (const s of todayShifts ?? []) {
    if (!OFF_SHIFTS.includes(s.shift_name ?? "")) {
      shiftMap.set(s.staff_id, {
        shiftName:  s.shift_name ?? "",
        shiftStart: s.shift_start,
        shiftEnd:   s.shift_end,
      });
    }
  }

  // TerminalMember 配列（全プロジェクトメンバー）
  const members: TerminalMember[] = [];

  for (const m of memberRows ?? []) {
    const staffId = m.staff_id;
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as {
      display_name?: string | null;
      name?: string | null;
      account_number?: string | null;
    } | null;
    const name  = s?.display_name ?? s?.name ?? staffId;
    const shift = shiftMap.get(staffId);
    const punch = punchMap.get(staffId) ?? { clockedIn: false, clockedOut: false, lastBreak: null, hadBreak60: false, breakStartedAt: null, breakNote: null };

    members.push({
      staffId,
      name,
      shiftName:      shift?.shiftName  ?? null,
      shiftStart:     shift?.shiftStart ?? null,
      shiftEnd:       shift?.shiftEnd   ?? null,
      clockedIn:      punch.clockedIn,
      clockedOut:     punch.clockedOut,
      onBreak:        punch.lastBreak === "break_start",
      isAbsent:       absenceIds.has(staffId),
      section:        (m as { section?: string | null }).section ?? null,
      accountNumber:  (s?.account_number as string | null | undefined) ?? null,
      hasShiftToday:  !!shift,
      needsConsent:   !consentedIds.has(staffId),
      hadBreak60:     punch.hadBreak60,
      breakStartedAt: punch.breakStartedAt,
      breakNote:      punch.breakNote,
    });
  }

  // 未打刻が先、名前順
  members.sort((a, b) => {
    const rank = (m: TerminalMember) => m.clockedOut ? 2 : m.clockedIn ? 1 : 0;
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return a.name.localeCompare(b.name, "ja");
  });

  // 座席データ
  const assignMap = new Map((assignmentRows ?? []).map(a => [a.seat_id, a.staff_id]));

  const seats: TerminalSeat[] = (seatRows ?? []).map(s => {
    const seatType = ((s as { seat_type?: string }).seat_type ?? "normal") as TerminalSeat["seatType"];
    const staffId  = seatType === "disabled" ? null : (assignMap.get(s.id) ?? null);
    return {
      id:        s.id,
      label:     s.label,
      xPct:      s.x_pct,
      yPct:      s.y_pct,
      section:   s.section ?? null,
      seatType,
      shiftSlot: (s as { shift_slot?: string | null }).shift_slot ?? null,
      staffId:   staffId as string | null,
    };
  });

  const walls: TerminalWall[] = (wallRows ?? []).map(w => ({
    x1Pct: w.x1_pct as number,
    y1Pct: w.y1_pct as number,
    x2Pct: w.x2_pct as number,
    y2Pct: w.y2_pct as number,
  }));

  const breakAssignmentMap: Record<string, number> = {};
  for (const a of breakAssignmentRows ?? []) {
    breakAssignmentMap[a.staff_id as string] = a.slot_number as number;
  }

  // デフォルト値付きでスロット設定を取得
  const breakSlotSettings = await getBreakSlotSettingsAction(projectId);
  type BreakSlotInfo = { slotNumber: number; label: string; startTime: string; endTime: string };
  const breakSlots: BreakSlotInfo[] = breakSlotSettings.map(s => ({
    slotNumber: s.slot_number,
    label:      s.label,
    startTime:  s.start_time,
    endTime:    s.end_time,
  }));

  const motaAccountNumbers: string[] = (motaAssignmentRows ?? [])
    .map(r => r.assigned_account as string | null)
    .filter((v): v is string => Boolean(v));

  // assigned_account → { slot, positionAccount } のマップ（複数スロット対応）
  type MotaSlotInfo = { slot: string; positionAccount: string };
  const motaSlotInfoMap: Record<string, MotaSlotInfo[]> = {};
  for (const r of motaAssignmentRows ?? []) {
    const ac = r.assigned_account as string | null;
    if (!ac) continue;
    if (!motaSlotInfoMap[ac]) motaSlotInfoMap[ac] = [];
    motaSlotInfoMap[ac].push({
      slot:            r.slot as string,
      positionAccount: r.account_number as string,
    });
  }

  return (
    <TerminalPunchClient
      projectId={projectId}
      projectName={project.name}
      members={members}
      seats={seats}
      walls={walls}
      breakAssignmentMap={breakAssignmentMap}
      breakSlots={breakSlots}
      motaAccountNumbers={motaAccountNumbers}
      motaSlotInfoMap={motaSlotInfoMap}
    />
  );
}
