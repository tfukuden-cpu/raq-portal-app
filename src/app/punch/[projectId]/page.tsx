/**
 * 現場端末打刻ページ（認証不要・adminClient使用）
 * URL: /punch/[projectId]
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import TerminalPunchClient, { type TerminalMember } from "./TerminalPunchClient";

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

  // 並列取得：メンバー・当日シフト・打刻ログ・当月同意済みスタッフ
  const [
    { data: memberRows },
    { data: todayShifts },
    { data: punchLogs },
    { data: consentRows },
  ] = await Promise.all([
    admin
      .from("project_members")
      .select("staff_id, staffs(id, name, display_name)")
      .eq("project_id", projectId),
    admin
      .from("shifts")
      .select("staff_id, shift_name, shift_start, shift_end")
      .eq("project_id", projectId)
      .eq("shift_date", today),
    admin
      .from("punch_logs")
      .select("staff_id, punch_type, recorded_at")
      .eq("project_id", projectId)
      .gte("recorded_at", todayStart)
      .lte("recorded_at", todayEnd)
      .order("recorded_at"),
    admin
      .from("consent_records")
      .select("staff_id")
      .eq("project_id", projectId)
      .eq("consent_month", currentMonth),
  ]);

  // 当月同意済みスタッフセット
  const consentedIds = new Set((consentRows ?? []).map(c => c.staff_id));

  // 打刻マップ
  const punchMap = new Map<string, { clockedIn: boolean; clockedOut: boolean }>();
  for (const p of punchLogs ?? []) {
    if (!punchMap.has(p.staff_id)) {
      punchMap.set(p.staff_id, { clockedIn: false, clockedOut: false });
    }
    const e = punchMap.get(p.staff_id)!;
    if (p.punch_type === "clock_in")  e.clockedIn  = true;
    if (p.punch_type === "clock_out") e.clockedOut = true;
  }

  // シフトマップ（公休系除く）
  const OFF_SHIFTS = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤"];
  const shiftMap = new Map<string, { shiftName: string; shiftStart: string | null; shiftEnd: string | null }>();
  for (const s of todayShifts ?? []) {
    if (!OFF_SHIFTS.includes(s.shift_name ?? "")) {
      shiftMap.set(s.staff_id, {
        shiftName:  s.shift_name ?? "",
        shiftStart: s.shift_start,
        shiftEnd:   s.shift_end,
      });
    }
  }

  // TerminalMember 配列を組み立て（当日シフトあり・公休除く）
  const members: TerminalMember[] = [];

  for (const m of memberRows ?? []) {
    const staffId = m.staff_id;
    const shift = shiftMap.get(staffId);
    if (!shift) continue;

    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as {
      display_name?: string | null;
      name?: string | null;
    } | null;
    const name = s?.display_name ?? s?.name ?? staffId;
    const punch = punchMap.get(staffId) ?? { clockedIn: false, clockedOut: false };

    members.push({
      staffId,
      name,
      shiftName:   shift.shiftName  || null,
      shiftStart:  shift.shiftStart || null,
      shiftEnd:    shift.shiftEnd   || null,
      clockedIn:   punch.clockedIn,
      clockedOut:  punch.clockedOut,
      needsConsent: !consentedIds.has(staffId),
    });
  }

  // 未打刻が先、名前順
  members.sort((a, b) => {
    const rank = (m: TerminalMember) => m.clockedOut ? 2 : m.clockedIn ? 1 : 0;
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return a.name.localeCompare(b.name, "ja");
  });

  return (
    <TerminalPunchClient
      projectId={projectId}
      projectName={project.name}
      members={members}
    />
  );
}
