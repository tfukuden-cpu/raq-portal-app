/**
 * GET /api/admin/work-records/export
 * 稼働実績をExcel(.xlsx)で返す
 * query: projectId, staffIds (comma), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), mode (company|individual)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import ExcelJS from "exceljs";

// ─── 権限チェック ─────────────────────────────────────────────
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

// ─── 時刻ユーティリティ ───────────────────────────────────────
function toJSTTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/** "HH:MM" または "HH:MM:SS" → その日のJST Dateオブジェクト */
function shiftTimeToDate(dateStr: string, timeStr: string | null): Date | null {
  if (!timeStr) return null;
  return new Date(`${dateStr}T${timeStr.slice(0, 5)}:00+09:00`);
}

/** 分 → "H:MM" */
function fmtMin(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}:${String(min).padStart(2, "0")}`;
}

/**
 * 拘束時間(出勤〜退勤の総分)から休憩時間(分)を算出（労基準拠）
 * 6時間未満=0分 ／ 6〜8時間=45分 ／ 8時間超=60分
 */
function autoBreakMinutes(grossMin: number): number {
  if (grossMin > 480) return 60;   // 8時間超
  if (grossMin >= 360) return 45;  // 6〜8時間
  return 0;                        // 6時間未満
}

// ─── 型定義 ───────────────────────────────────────────────────
type DailyRecord = {
  date: string;
  shiftName: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number | null;
  workMinutes: number | null;
  overtimeMinutes: number | null;
  isLate: boolean;
  isEarlyLeave: boolean;
  isAbsent: boolean;
  absenceReason: string | null;
  lateReason: string | null;
};

type PersonData = {
  staffId: string;
  name: string;
  accountNumber: string | null;
  company: string | null;
  section: string | null;
  // 集計
  workDays: number;
  workMinutes: number;
  breakMinutes: number;
  normalMinutes: number;
  overtimeMinutes: number;
  lateCount: number;
  earlyLeaveCount: number;
  absentCount: number;
  totalShiftDays: number;
  complianceRate: number | null;
  records: DailyRecord[];
};

// ─── スタイル定数 ─────────────────────────────────────────────
const COMPANY_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
const PERSON_FILL:  ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E4F7" } };
const HEADER_FILL:  ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4F8" } };
const TOTAL_FILL:   ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };

function applyBorder(row: ExcelJS.Row) {
  row.eachCell(cell => {
    cell.border = {
      top:    { style: "thin", color: { argb: "FFD1D5DB" } },
      bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
      left:   { style: "thin", color: { argb: "FFD1D5DB" } },
      right:  { style: "thin", color: { argb: "FFD1D5DB" } },
    };
  });
}

// ─── シート：個人日別データ ───────────────────────────────────
function addPersonSheet(wb: ExcelJS.Workbook, person: PersonData, sheetName: string) {
  const ws = wb.addWorksheet(sheetName);
  ws.views = [{ state: "frozen", ySplit: 3 }];

  // 列幅
  ws.columns = [
    { width: 12 },  // 日付
    { width: 14 },  // シフト名
    { width: 8  },  // 出勤予定
    { width: 8  },  // 退勤予定
    { width: 8  },  // 出勤打刻
    { width: 8  },  // 退勤打刻
    { width: 8  },  // 休憩時間
    { width: 10 },  // 稼働時間
    { width: 10 },  // 　内通常時間
    { width: 10 },  // 　内残業時間
    { width: 6  },  // 遅刻
    { width: 6  },  // 早退
    { width: 6  },  // 欠勤
    { width: 20 },  // 備考
  ];

  // Row1: 個人情報
  const label = [person.accountNumber, person.name, person.company, person.section].filter(Boolean).join("　");
  const infoRow = ws.addRow([label]);
  infoRow.font = { bold: true, size: 12 };
  ws.mergeCells(`A1:N1`);
  infoRow.getCell(1).fill = TOTAL_FILL;
  applyBorder(infoRow);

  // Row2: ヘッダー
  const hdr = ws.addRow(["日付","シフト名","出勤予定","退勤予定","出勤打刻","退勤打刻","休憩時間","稼働時間","　内通常時間","　内残業時間","遅刻","早退","欠勤","備考"]);
  hdr.font = { bold: true };
  hdr.fill = HEADER_FILL;
  hdr.alignment = { horizontal: "center" };
  applyBorder(hdr);

  // Row3: 合計行（ヘッダーと列を揃える）
  const totalRow = ws.addRow([
    `合計 (稼働${person.workDays}日)`,
    "", "", "", "", "",
    fmtMin(person.breakMinutes),
    fmtMin(person.workMinutes),
    fmtMin(person.normalMinutes),
    fmtMin(person.overtimeMinutes),
    `${person.lateCount}回`,
    `${person.earlyLeaveCount}回`,
    `${person.absentCount}日`,
    "",
  ]);
  totalRow.font = { bold: true };
  totalRow.fill = TOTAL_FILL;
  applyBorder(totalRow);

  // 日別データ
  for (const r of person.records) {
    const note = [r.absenceReason, r.lateReason].filter(Boolean).join(" / ");
    const normalMin = r.workMinutes != null && r.overtimeMinutes != null
      ? r.workMinutes - r.overtimeMinutes
      : r.workMinutes;
    const dataRow = ws.addRow([
      r.date,
      r.shiftName,
      r.shiftStart ?? "",
      r.shiftEnd   ?? "",
      r.clockIn  ? toJSTTime(r.clockIn)  : "",
      r.clockOut ? toJSTTime(r.clockOut) : "",
      r.breakMinutes    != null ? fmtMin(r.breakMinutes)    : "",
      r.workMinutes     != null ? fmtMin(r.workMinutes)     : "",
      normalMin         != null ? fmtMin(normalMin)          : "",
      r.overtimeMinutes != null ? fmtMin(r.overtimeMinutes) : "",
      r.isLate      ? "●" : "",
      r.isEarlyLeave? "●" : "",
      r.isAbsent    ? "●" : "",
      note,
    ]);
    if (r.isAbsent)    dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0F0" } };
    else if (r.isLate) dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9F0" } };
    dataRow.getCell(11).alignment = { horizontal: "center" };
    dataRow.getCell(12).alignment = { horizontal: "center" };
    dataRow.getCell(13).alignment = { horizontal: "center" };
    applyBorder(dataRow);
  }
}

// ─── シート：サマリー（会社別） ───────────────────────────────
function addSummarySheet(wb: ExcelJS.Workbook, companies: Map<string, PersonData[]>, startDate: string, endDate: string) {
  const ws = wb.addWorksheet("サマリー");
  ws.views = [{ state: "frozen", ySplit: 2 }];
  ws.columns = [
    { width: 20 },  // 会社名 / 氏名
    { width: 14 },  // アカウント番号
    { width: 12 },  // セクション
    { width: 10 },  // 稼働日数
    { width: 10 },  // 稼働時間
    { width: 10 },  // 休憩時間
    { width: 10 },  // 　内通常時間
    { width: 10 },  // 　内残業時間
    { width: 8  },  // 遅刻数
    { width: 8  },  // 早退数
    { width: 8  },  // 欠勤数
    { width: 10 },  // 順守率
  ];

  // タイトル
  const titleRow = ws.addRow([`稼働実績サマリー　${startDate} 〜 ${endDate}`]);
  ws.mergeCells("A1:L1");
  titleRow.font = { bold: true, size: 13 };
  titleRow.getCell(1).fill = TOTAL_FILL;
  applyBorder(titleRow);

  // ヘッダー
  const hdr = ws.addRow(["会社 / 氏名","アカウント番号","セクション","稼働日数","稼働時間","休憩時間","　内通常時間","　内残業時間","遅刻数","早退数","欠勤数","順守率"]);
  hdr.font = { bold: true };
  hdr.fill = HEADER_FILL;
  hdr.alignment = { horizontal: "center" };
  applyBorder(hdr);

  for (const [company, persons] of companies) {
    // 会社合計行
    const totWorkDays  = persons.reduce((s, p) => s + p.workDays, 0);
    const totWorkMin   = persons.reduce((s, p) => s + p.workMinutes, 0);
    const totBreakMin  = persons.reduce((s, p) => s + p.breakMinutes, 0);
    const totNormalMin = persons.reduce((s, p) => s + p.normalMinutes, 0);
    const totOtMin     = persons.reduce((s, p) => s + p.overtimeMinutes, 0);
    const totLate      = persons.reduce((s, p) => s + p.lateCount, 0);
    const totEarly     = persons.reduce((s, p) => s + p.earlyLeaveCount, 0);
    const totAbsent    = persons.reduce((s, p) => s + p.absentCount, 0);

    const totShiftDays = persons.reduce((s, p) => s + p.totalShiftDays, 0);
    const totProblem   = persons.reduce((s, p) => s + p.lateCount + p.earlyLeaveCount + p.absentCount, 0);
    const totRate      = totShiftDays > 0 ? Math.round((totShiftDays - totProblem) / totShiftDays * 100) : null;

    const compRow = ws.addRow([
      `【${company}】合計 (${persons.length}名)`,
      "", "",
      `${totWorkDays}日`,
      fmtMin(totWorkMin),
      fmtMin(totBreakMin),
      fmtMin(totNormalMin),
      fmtMin(totOtMin),
      `${totLate}回`,
      `${totEarly}回`,
      `${totAbsent}日`,
      totRate != null ? `${totRate}%` : "",
    ]);
    compRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    compRow.fill = COMPANY_FILL;
    applyBorder(compRow);

    // 個人小計行
    for (const p of persons) {
      const pRow = ws.addRow([
        p.name,
        p.accountNumber ?? "",
        p.section       ?? "",
        `${p.workDays}日`,
        fmtMin(p.workMinutes),
        fmtMin(p.breakMinutes),
        fmtMin(p.normalMinutes),
        fmtMin(p.overtimeMinutes),
        `${p.lateCount}回`,
        `${p.earlyLeaveCount}回`,
        `${p.absentCount}日`,
        p.complianceRate != null ? `${p.complianceRate}%` : "",
      ]);
      pRow.fill = PERSON_FILL;
      applyBorder(pRow);
    }
  }
}

// ─── メインハンドラー ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const projectId   = searchParams.get("projectId")  ?? "";
  const startDate   = searchParams.get("startDate")  ?? "";
  const endDate     = searchParams.get("endDate")    ?? "";
  const staffIdsRaw = searchParams.get("staffIds")   ?? "";
  const mode        = searchParams.get("mode")       ?? "individual"; // "company" | "individual"

  if (!projectId || !startDate || !endDate) {
    return new NextResponse("Bad Request", { status: 400 });
  }
  if (!(await requireAccess(projectId))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const staffIds = staffIdsRaw ? staffIdsRaw.split(",").filter(Boolean) : [];
  const admin = createAdminClient();
  const startISO = `${startDate}T00:00:00+09:00`;
  const endISO   = `${endDate}T23:59:59+09:00`;

  // スタッフ情報
  let memberQ = admin
    .from("project_members")
    .select("staff_id, section, staffs(id, name, display_name, account_number, company_name)")
    .eq("project_id", projectId);
  if (staffIds.length > 0) memberQ = memberQ.in("staff_id", staffIds);
  const { data: members } = await memberQ;

  type StaffInfo = { name: string; accountNumber: string | null; company: string | null; section: string | null };
  const memberMap = new Map<string, StaffInfo>();
  for (const m of members ?? []) {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as {
      display_name?: string | null; name?: string | null;
      account_number?: string | null; company_name?: string | null;
    } | null;
    memberMap.set(m.staff_id, {
      name:          s?.display_name ?? s?.name ?? m.staff_id,
      accountNumber: s?.account_number ?? null,
      company:       s?.company_name  ?? null,
      section:       m.section        ?? null,
    });
  }

  const targetIds = staffIds.length > 0 ? staffIds : [...memberMap.keys()];

  // データ並列取得
  const OFF_SHIFT_NAMES = ["公休","希望休","有休","休暇","振替休日","特別休暇","代休","欠勤","公募"];

  // shifts：ページネーション付きフェッチ（PostgREST 1000行上限対策）
  const shifts: { staff_id: string; shift_date: string; shift_name: string; shift_start: string | null; shift_end: string | null }[] = [];
  {
    const PAGE = 1000;
    let from = 0;
    while (true) {
      let q = admin.from("shifts")
        .select("staff_id, shift_date, shift_name, shift_start, shift_end")
        .eq("project_id", projectId)
        .gte("shift_date", startDate).lte("shift_date", endDate)
        .order("shift_date").order("staff_id")
        .range(from, from + PAGE - 1);
      if (targetIds.length > 0) q = q.in("staff_id", targetIds);
      const { data, error } = await q;
      if (error || !data || data.length === 0) break;
      shifts.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  // punches：ページネーション付きフェッチ
  const punches: { staff_id: string; punch_type: string; recorded_at: string }[] = [];
  {
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await admin.from("punch_logs")
        .select("staff_id, punch_type, recorded_at")
        .eq("project_id", projectId)
        .gte("recorded_at", startISO).lte("recorded_at", endISO)
        .order("recorded_at")
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      punches.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  const [
    { data: absences },
    { data: lates },
    { data: shiftPatterns },
    { data: breakOverrides },
  ] = await Promise.all([
    admin.from("absence_reports")
      .select("staff_id, absence_date, reason")
      .eq("project_id", projectId)
      .gte("absence_date", startDate).lte("absence_date", endDate),
    admin.from("late_reports")
      .select("staff_id, late_date, reason")
      .eq("project_id", projectId)
      .gte("late_date", startDate).lte("late_date", endDate),
    admin.from("shift_patterns")
      .select("name, start_time, end_time")
      .eq("project_id", projectId),
    admin.from("staff_break_overrides")
      .select("staff_id, override_date, regular_minutes")
      .eq("project_id", projectId)
      .gte("override_date", startDate).lte("override_date", endDate),
  ]);

  // シフトパターンから時刻を補完するマップ (shift_name → {start, end})
  const patternTimeMap = new Map<string, { start: string; end: string }>(
    (shiftPatterns ?? [])
      .filter(p => p.start_time && p.end_time)
      .map(p => [p.name as string, { start: p.start_time as string, end: p.end_time as string }])
  );

  // 打刻マップ
  const punchMap = new Map<string, { clockIn: string | null; clockOut: string | null }>();
  for (const p of punches ?? []) {
    const key = `${p.staff_id}_${p.recorded_at.slice(0, 10)}`;
    if (!punchMap.has(key)) punchMap.set(key, { clockIn: null, clockOut: null });
    const e = punchMap.get(key)!;
    if (p.punch_type === "clock_in"  && !e.clockIn) e.clockIn  = p.recorded_at;
    if (p.punch_type === "clock_out")                e.clockOut = p.recorded_at;
  }
  const absenceMap = new Map((absences ?? []).map(a => [`${a.staff_id}_${a.absence_date}`, a.reason ?? ""]));
  const lateMap    = new Map((lates    ?? []).map(l => [`${l.staff_id}_${l.late_date}`, l.reason ?? ""]));
  const breakOverrideMap = new Map(
    (breakOverrides ?? []).map(b => [`${b.staff_id}_${b.override_date}`, b.regular_minutes as number])
  );

  // PersonData構築
  const personMap = new Map<string, PersonData>();

  for (const shift of shifts ?? []) {
    if (OFF_SHIFT_NAMES.includes(shift.shift_name ?? "")) continue;
    const m = memberMap.get(shift.staff_id);
    if (!m) continue;

    if (!personMap.has(shift.staff_id)) {
      personMap.set(shift.staff_id, {
        staffId: shift.staff_id, name: m.name,
        accountNumber: m.accountNumber, company: m.company, section: m.section,
        workDays: 0, workMinutes: 0, breakMinutes: 0, normalMinutes: 0, overtimeMinutes: 0,
        lateCount: 0, earlyLeaveCount: 0, absentCount: 0,
        totalShiftDays: 0, complianceRate: null,
        records: [],
      });
    }
    const person = personMap.get(shift.staff_id)!;
    const key = `${shift.staff_id}_${shift.shift_date}`;
    const punch   = punchMap.get(key);
    const isAbsent = absenceMap.has(key);
    const isLate   = lateMap.has(key);

    // shift_start/shift_end が未設定の場合はshift_patternsから補完
    const pattern = patternTimeMap.get(shift.shift_name ?? "");
    const resolvedStart = shift.shift_start ?? pattern?.start ?? null;
    const resolvedEnd   = shift.shift_end   ?? pattern?.end   ?? null;

    // 稼働時間・残業時間・早退・休憩
    let workMinutes:     number | null = null;
    let overtimeMinutes: number | null = null;
    let breakMinutes = 0;
    let isEarlyLeave = false;

    if (punch?.clockIn && punch?.clockOut) {
      const inMs  = new Date(punch.clockIn).getTime();
      const outMs = new Date(punch.clockOut).getTime();
      const grossMin = Math.max(0, Math.round((outMs - inMs) / 60000));
      // 休憩：個別オーバーライドがあれば優先、無ければ拘束時間から算出（6h未満=0/6〜8h=45/8h超=60）
      breakMinutes = breakOverrideMap.get(key) ?? autoBreakMinutes(grossMin);
      workMinutes = Math.max(0, grossMin - breakMinutes);

      if (resolvedEnd) {
        const endDt = shiftTimeToDate(shift.shift_date, resolvedEnd);
        if (endDt) {
          const endMs = endDt.getTime();
          overtimeMinutes = Math.max(0, Math.round((outMs - endMs) / 60000));
          isEarlyLeave = outMs < endMs - 10 * 60000;
        }
      }
    }

    const rec: DailyRecord = {
      date:       shift.shift_date,
      shiftName:  shift.shift_name  ?? "",
      shiftStart: resolvedStart,
      shiftEnd:   resolvedEnd,
      clockIn:    punch?.clockIn    ?? null,
      clockOut:   punch?.clockOut   ?? null,
      breakMinutes: (punch?.clockIn && punch?.clockOut) ? breakMinutes : null,
      workMinutes, overtimeMinutes,
      isLate, isEarlyLeave, isAbsent,
      absenceReason: isAbsent ? (absenceMap.get(key) ?? null) : null,
      lateReason:    isLate   ? (lateMap.get(key)    ?? null) : null,
    };

    person.records.push(rec);
    person.totalShiftDays++;
    if (!isAbsent && punch?.clockIn) person.workDays++;
    if (workMinutes     != null) {
      const ot     = overtimeMinutes ?? 0;
      person.workMinutes     += workMinutes;
      person.breakMinutes    += breakMinutes;
      person.normalMinutes   += Math.max(0, workMinutes - ot);
      person.overtimeMinutes += ot;
    }
    if (isLate)       person.lateCount++;
    if (isEarlyLeave) person.earlyLeaveCount++;
    if (isAbsent)     person.absentCount++;
  }

  // 順守率計算
  for (const p of personMap.values()) {
    const problemDays = p.lateCount + p.earlyLeaveCount + p.absentCount;
    p.complianceRate = p.totalShiftDays > 0
      ? Math.round((p.totalShiftDays - problemDays) / p.totalShiftDays * 100)
      : null;
  }

  // Excel生成
  const wb = new ExcelJS.Workbook();
  wb.creator = "RaqWorks";
  wb.created = new Date();

  const persons = [...personMap.values()].sort((a, b) => a.staffId.localeCompare(b.staffId));

  if (mode === "company") {
    // 会社ごとにグループ化
    const companyMap = new Map<string, PersonData[]>();
    for (const p of persons) {
      const c = p.company ?? "未設定";
      if (!companyMap.has(c)) companyMap.set(c, []);
      companyMap.get(c)!.push(p);
    }

    // Sheet 1: サマリー
    addSummarySheet(wb, companyMap, startDate, endDate);

    // Sheet 2+: 個人シート
    for (const p of persons) {
      const sheetName = [p.accountNumber, p.name].filter(Boolean).join(" ").slice(0, 31);
      addPersonSheet(wb, p, sheetName || p.staffId);
    }
  } else {
    // 個人別: 1シートずつ
    for (const p of persons) {
      const sheetName = [p.accountNumber, p.name].filter(Boolean).join(" ").slice(0, 31);
      addPersonSheet(wb, p, sheetName || p.staffId);
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `稼働実績_${startDate}_${endDate}.xlsx`;

  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
