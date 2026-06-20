/**
 * GET /api/admin/work-records/absentees
 * 欠勤者レポート（当月の欠勤者一覧＋各人の過去分の出勤率/出勤数/欠勤数）
 * query: projectId, month (YYYY-MM)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAccess(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const [{ data: membership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);
  return (
    membership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive"
  );
}

const OFF_SHIFT_NAMES = ["公休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤", "希望休"];

export type AbsenteeByDate = {
  date: string;
  items: { staffId: string; name: string; accountNumber: string | null; reason: string | null }[];
};

export type AbsenteeStaff = {
  staffId: string;
  name: string;
  accountNumber: string | null;
  section: string | null;
  monthAbsences: number;          // 当月の欠勤数
  histShiftDays: number;          // 過去分の出勤予定日数（公休等除く）
  histAttendedDays: number;       // 過去分の出勤数
  histAbsentDays: number;         // 過去分の欠勤数
  histRate: number | null;        // 過去分の出勤率（%）
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const projectId = searchParams.get("projectId") ?? "";
  const month     = searchParams.get("month") ?? ""; // YYYY-MM

  if (!projectId || !/^\d{4}-\d{2}$/.test(month))
    return new NextResponse("Bad Request", { status: 400 });
  if (!(await requireAccess(projectId)))
    return new NextResponse("Forbidden", { status: 403 });

  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const monthStart = `${month}-01`;
  const monthEnd   = `${month}-${String(lastDay).padStart(2, "0")}`;
  // 過去分は当月末までの直近13ヶ月（プロジェクト開始以降を概ねカバー）
  const histStart = `${y - 1}-${String(m).padStart(2, "0")}-01`;

  const admin = createAdminClient();

  // スタッフ情報
  const { data: members } = await admin
    .from("project_members")
    .select("staff_id, section, staffs(id, name, display_name, account_number)")
    .eq("project_id", projectId);

  const memberMap = new Map<string, { name: string; accountNumber: string | null; section: string | null }>();
  for (const mm of members ?? []) {
    const s = (Array.isArray(mm.staffs) ? mm.staffs[0] : mm.staffs) as {
      display_name?: string | null; name?: string | null; account_number?: string | null;
    } | null;
    memberMap.set(mm.staff_id, {
      name:          s?.display_name ?? s?.name ?? mm.staff_id,
      accountNumber: s?.account_number ?? null,
      section:       mm.section ?? null,
    });
  }

  const [{ data: histAbsences }, { data: histShifts }] = await Promise.all([
    admin.from("absence_reports")
      .select("staff_id, absence_date, reason")
      .eq("project_id", projectId)
      .gte("absence_date", histStart).lte("absence_date", monthEnd),
    admin.from("shifts")
      .select("staff_id, shift_date, shift_name")
      .eq("project_id", projectId)
      .gte("shift_date", histStart).lte("shift_date", monthEnd),
  ]);

  // 当月の欠勤（日毎）
  const byDateMap = new Map<string, AbsenteeByDate["items"]>();
  const monthAbsenceCount = new Map<string, number>();
  for (const a of histAbsences ?? []) {
    const date = a.absence_date as string;
    if (date < monthStart || date > monthEnd) continue;
    const info = memberMap.get(a.staff_id);
    if (!byDateMap.has(date)) byDateMap.set(date, []);
    byDateMap.get(date)!.push({
      staffId:       a.staff_id,
      name:          info?.name ?? a.staff_id,
      accountNumber: info?.accountNumber ?? null,
      reason:        (a.reason as string | null) ?? null,
    });
    monthAbsenceCount.set(a.staff_id, (monthAbsenceCount.get(a.staff_id) ?? 0) + 1);
  }

  const byDate: AbsenteeByDate[] = [...byDateMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "", "ja")),
    }));

  // 過去分の出勤率（当月欠勤者のみ）
  const absentStaffIds = [...monthAbsenceCount.keys()];
  const histAbsenceSet = new Set((histAbsences ?? []).map(a => `${a.staff_id}_${a.absence_date}`));

  const histStats = new Map<string, { shiftDays: number; absentDays: number }>();
  for (const sh of histShifts ?? []) {
    if (OFF_SHIFT_NAMES.includes((sh.shift_name ?? "") as string)) continue;
    if (!histStats.has(sh.staff_id)) histStats.set(sh.staff_id, { shiftDays: 0, absentDays: 0 });
    const st = histStats.get(sh.staff_id)!;
    st.shiftDays++;
    if (histAbsenceSet.has(`${sh.staff_id}_${sh.shift_date}`)) st.absentDays++;
  }

  const staff: AbsenteeStaff[] = absentStaffIds.map(id => {
    const info = memberMap.get(id);
    const hs = histStats.get(id) ?? { shiftDays: 0, absentDays: 0 };
    const attended = Math.max(0, hs.shiftDays - hs.absentDays);
    return {
      staffId:          id,
      name:             info?.name ?? id,
      accountNumber:    info?.accountNumber ?? null,
      section:          info?.section ?? null,
      monthAbsences:    monthAbsenceCount.get(id) ?? 0,
      histShiftDays:    hs.shiftDays,
      histAttendedDays: attended,
      histAbsentDays:   hs.absentDays,
      histRate:         hs.shiftDays > 0 ? Math.round((attended / hs.shiftDays) * 100) : null,
    };
  }).sort((a, b) =>
    b.monthAbsences - a.monthAbsences ||
    (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "", "ja")
  );

  return NextResponse.json({ month, byDate, staff });
}
