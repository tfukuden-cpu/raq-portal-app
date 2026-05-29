/**
 * Google Sheets 同期アクション（8シート分）
 * シート名は固定（スプレッドシート側もこの名前に合わせてください）
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";
import { readSheet, writeSheet, extractSpreadsheetId } from "@/lib/gsheets";
import { calcDailyRecord, calcMonthlySummary, fmtMin } from "@/lib/attendance";

export type SyncResult = {
  success: boolean;
  count?: number;
  message?: string;
};

// ── ヘルパー ─────────────────────────────────────────────

async function getContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("ログインしてください");
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) throw new Error("案件が選択されていません");
  return { supabase, staffId, projectId };
}

// projectId なしでユーザー情報だけ取得（FormData に projectId がある場合用）
async function getUserContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("ログインしてください");
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  return { supabase, staffId };
}

function monthRange(year: number, month: number) {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate   = new Date(year, month, 0).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  return { startDate, endDate };
}

// 社員情報マップを取得（表示名 + 所属会社）
async function getStaffInfo(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string) {
  const { data } = await supabase
    .from("project_members")
    .select("staff_id, staffs(name, display_name, company_name)")
    .eq("project_id", projectId);
  const nameMap    = new Map<string, string>();
  const companyMap = new Map<string, string>();
  (data ?? []).forEach((m) => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null; company_name: string | null } | null;
    nameMap.set(m.staff_id,    s?.display_name ?? s?.name ?? m.staff_id);
    companyMap.set(m.staff_id, s?.company_name ?? "");
  });
  return { nameMap, companyMap };
}

// 後方互換：表示名マップのみ返す
async function getStaffNames(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string) {
  return (await getStaffInfo(supabase, projectId)).nameMap;
}

function sheetId(url: string) {
  return extractSpreadsheetId(url);
}

/**
 * 「必要人数」行をスキャンして shift_patterns.required_count を更新するヘルパー。
 * テンプレート形式: 任意のセルに "短縮名:件数" のペアが含まれていれば解析する。
 * （例: "日:15 夜:5" → 日勤=15、夜勤=5）
 */
async function syncRequiredCountsFromSheetRows(
  rows: string[][],
  headerRowIdx: number,
  projectId: string,
): Promise<void> {
  // headerRowIdx より前の行から「必要人数」を含む行を探す
  const reqCountRow = rows.slice(0, headerRowIdx).find(r =>
    r.some(c => (c ?? "").includes("必要人数"))
  );
  if (!reqCountRow) return;

  const admin = createAdminClient();

  // shift_patterns の short_name → name マッピングを取得
  const { data: sPatterns } = await admin
    .from("shift_patterns")
    .select("name, short_name")
    .eq("project_id", projectId);
  if (!sPatterns || sPatterns.length === 0) return;

  const shortToName = new Map(sPatterns.map(p => [p.short_name, p.name]));

  // 全セルをスキャンして "SHORT:COUNT" ペアを収集（同パターンは最大値を使用）
  const countMap = new Map<string, number>();
  reqCountRow.forEach(cell => {
    const pairs = (cell ?? "").match(/([^\s:]+):(\d+)/g) ?? [];
    pairs.forEach(pair => {
      const colonIdx = pair.lastIndexOf(":");
      const shortName = pair.slice(0, colonIdx);
      const count = parseInt(pair.slice(colonIdx + 1), 10);
      const name = shortToName.get(shortName);
      if (name && !isNaN(count) && count > 0) {
        countMap.set(name, Math.max(countMap.get(name) ?? 0, count));
      }
    });
  });

  if (countMap.size === 0) return;

  // shift_patterns.required_count を更新
  for (const [name, count] of countMap.entries()) {
    await admin
      .from("shift_patterns")
      .update({ required_count: count })
      .eq("project_id", projectId)
      .eq("name", name);
  }
}

// ── 1. シフト読み込み（スプシ→アプリ）──────────────────

export async function importShiftFromSheetAction(fd: FormData): Promise<SyncResult> {
  const url = String(fd.get("url") ?? "").trim();
  if (!url) return { success: false, message: "URLを入力してください" };

  try {
    const { supabase, staffId, projectId } = await getContext();
    const rows = await readSheet(sheetId(url), "シフト");
    const data = rows.slice(1).filter((r) => r[0] && r[2]);

    const records = data.map((r) => ({
      project_id: projectId,
      staff_id: (r[0] ?? "").toUpperCase(),
      shift_date: r[2] ?? "",
      shift_name: r[3] || null,
      shift_start: r[4] || null,
      shift_end:   r[5] || null,
      note:        r[6] || null,
    })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.shift_date));

    if (records.length === 0) return { success: false, message: "有効なデータがありません" };

    let count = 0;
    for (let i = 0; i < records.length; i += 500) {
      const { count: c, error } = await supabase.from("shifts").upsert(
        records.slice(i, i + 500),
        { onConflict: "project_id,staff_id,shift_date", count: "exact" }
      );
      if (error) return { success: false, message: "DB登録エラー：" + error.message };
      count += c ?? 0;
    }

    revalidatePath("/shifts");
    revalidatePath("/shifts/manage");
    return { success: true, count };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

// ── 2. シフト書き出し（アプリ→スプシ）──────────────────

export async function exportShiftToSheetAction(fd: FormData): Promise<SyncResult> {
  const url   = String(fd.get("url") ?? "").trim();
  const year  = Number(fd.get("year")  ?? new Date().getFullYear());
  const month = Number(fd.get("month") ?? new Date().getMonth() + 1);
  if (!url) return { success: false, message: "URLを入力してください" };

  try {
    const { supabase, projectId } = await getContext();
    const { startDate, endDate } = monthRange(year, month);
    const names = await getStaffNames(supabase, projectId);

    // ページネーション付きフェッチ（PostgREST 1000行上限対策）
    const allShiftData: { staff_id: string; shift_date: string; shift_name: string | null; shift_start: string | null; shift_end: string | null; note: string | null }[] = [];
    {
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data: page, error } = await supabase
          .from("shifts")
          .select("staff_id, shift_date, shift_name, shift_start, shift_end, note")
          .eq("project_id", projectId)
          .gte("shift_date", startDate).lte("shift_date", endDate)
          .order("shift_date").order("staff_id")
          .range(from, from + PAGE - 1);
        if (error) return { success: false, message: error.message };
        if (!page || page.length === 0) break;
        allShiftData.push(...page);
        if (page.length < PAGE) break;
        from += PAGE;
      }
    }
    const data = allShiftData;

    const header = ["社員ID", "氏名", "日付", "シフト名", "開始", "終了", "備考"];
    const rows = (data ?? []).map((s) => [
      s.staff_id,
      names.get(s.staff_id) ?? s.staff_id,
      s.shift_date,
      s.shift_name ?? "",
      s.shift_start?.slice(0, 5) ?? "",
      s.shift_end?.slice(0, 5)   ?? "",
      s.note ?? "",
    ]);

    await writeSheet(sheetId(url), "シフト", [header, ...rows]);
    return { success: true, count: rows.length };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

// ── 3. 希望休 書き出し（アプリ→スプシ）─────────────────

export async function exportHolidayToSheetAction(fd: FormData): Promise<SyncResult> {
  const url   = String(fd.get("url") ?? "").trim();
  const year  = Number(fd.get("year")  ?? new Date().getFullYear());
  const month = Number(fd.get("month") ?? new Date().getMonth() + 1);
  if (!url) return { success: false, message: "URLを入力してください" };

  try {
    const { supabase, projectId } = await getContext();
    const { startDate, endDate } = monthRange(year, month);
    const names = await getStaffNames(supabase, projectId);

    const { data, error } = await supabase
      .from("holiday_requests")
      .select("staff_id, request_date, status, note")
      .eq("project_id", projectId)
      .gte("request_date", startDate).lte("request_date", endDate)
      .order("request_date").order("staff_id");
    if (error) return { success: false, message: error.message };

    const statusLabel = (s: string | null) =>
      s === "approved" ? "承認済" : s === "rejected" ? "却下" : "審査中";

    const header = ["社員ID", "氏名", "希望日", "ステータス", "備考"];
    const rows = (data ?? []).map((r) => [
      r.staff_id,
      names.get(r.staff_id) ?? r.staff_id,
      r.request_date,
      statusLabel(r.status),
      r.note ?? "",
    ]);

    await writeSheet(sheetId(url), "希望休", [header, ...rows]);
    return { success: true, count: rows.length };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

// ── 4. 打刻ログ 書き出し（アプリ→スプシ）───────────────

const PUNCH_LABEL: Record<string, string> = {
  clock_in: "出勤", clock_out: "退勤",
  break_start: "休憩開始", break_end: "休憩終了",
};

export async function exportPunchLogToSheetAction(fd: FormData): Promise<SyncResult> {
  const url   = String(fd.get("url") ?? "").trim();
  const year  = Number(fd.get("year")  ?? new Date().getFullYear());
  const month = Number(fd.get("month") ?? new Date().getMonth() + 1);
  if (!url) return { success: false, message: "URLを入力してください" };

  try {
    const { supabase, projectId } = await getContext();
    const { startDate, endDate } = monthRange(year, month);
    const names = await getStaffNames(supabase, projectId);

    const { data, error } = await supabase
      .from("punch_logs")
      .select("staff_id, punch_type, recorded_at, note, approver_name")
      .eq("project_id", projectId)
      .gte("recorded_at", startDate + "T00:00:00+09:00")
      .lte("recorded_at", endDate   + "T23:59:59+09:00")
      .order("recorded_at");
    if (error) return { success: false, message: error.message };

    const toJST = (iso: string) =>
      new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit" });

    const header = ["社員ID", "氏名", "日時", "種別", "区分", "承認者"];
    const rows = (data ?? []).map((p) => [
      p.staff_id,
      names.get(p.staff_id) ?? p.staff_id,
      toJST(p.recorded_at),
      PUNCH_LABEL[p.punch_type] ?? p.punch_type,
      p.note ?? "",
      p.approver_name ?? "",
    ]);

    await writeSheet(sheetId(url), "打刻ログ", [header, ...rows]);
    return { success: true, count: rows.length };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

// ── 5. 勤怠明細（日別）書き出し（アプリ→スプシ）────────

export async function exportAttendanceDetailToSheetAction(fd: FormData): Promise<SyncResult> {
  const url   = String(fd.get("url") ?? "").trim();
  const year  = Number(fd.get("year")  ?? new Date().getFullYear());
  const month = Number(fd.get("month") ?? new Date().getMonth() + 1);
  if (!url) return { success: false, message: "URLを入力してください" };

  try {
    const { supabase, projectId } = await getContext();
    const { startDate, endDate } = monthRange(year, month);
    const { nameMap, companyMap } = await getStaffInfo(supabase, projectId);

    const { data: punches, error } = await supabase
      .from("punch_logs")
      .select("staff_id, punch_type, recorded_at")
      .eq("project_id", projectId)
      .gte("recorded_at", startDate + "T00:00:00+09:00")
      .lte("recorded_at", endDate   + "T23:59:59+09:00")
      .order("recorded_at");
    if (error) return { success: false, message: error.message };

    // スタッフ×日付でグループ化
    type PunchRow = { staff_id: string; punch_type: string; recorded_at: string };
    const byStaffDate = new Map<string, PunchRow[]>();
    (punches ?? []).forEach((p) => {
      const dateJST = new Date(p.recorded_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
      const key = `${p.staff_id}__${dateJST}`;
      if (!byStaffDate.has(key)) byStaffDate.set(key, []);
      byStaffDate.get(key)!.push(p);
    });

    const header = ["社員ID", "所属会社", "氏名", "日付", "出勤", "退勤", "休憩(分)", "実働", "残業", "深夜", "深夜残業"];
    const rows: string[][] = [];
    [...byStaffDate.entries()].sort().forEach(([key, pList]) => {
      const [staffId, date] = key.split("__");
      const rec = calcDailyRecord(date, pList);
      rows.push([
        staffId,
        companyMap.get(staffId) ?? "",
        nameMap.get(staffId) ?? staffId,
        date,
        rec.clockIn  ?? "",
        rec.clockOut ?? "",
        String(rec.breakMinutes),
        fmtMin(rec.actualMinutes),
        fmtMin(rec.overtimeMinutes),
        fmtMin(rec.nightMinutes),
        fmtMin(rec.nightOvertimeMinutes),
      ]);
    });

    await writeSheet(sheetId(url), "日別勤怠", [header, ...rows]);
    return { success: true, count: rows.length };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

// ── 6. 勤怠集計（月次）書き出し（アプリ→スプシ）────────

// "HH:MM" or "HH:MM:SS" → 分
const t2m = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
// 公休・希望休は勤務日としてカウントしない
const isRestShift = (name: string | null) => !name || name === "公休" || name === "希望休";

export async function exportAttendanceSummaryToSheetAction(fd: FormData): Promise<SyncResult> {
  const url   = String(fd.get("url") ?? "").trim();
  const year  = Number(fd.get("year")  ?? new Date().getFullYear());
  const month = Number(fd.get("month") ?? new Date().getMonth() + 1);
  if (!url) return { success: false, message: "URLを入力してください" };

  try {
    const { supabase, projectId } = await getContext();
    const { startDate, endDate } = monthRange(year, month);
    const { nameMap, companyMap } = await getStaffInfo(supabase, projectId);

    // 打刻ログ取得
    const { data: punches, error } = await supabase
      .from("punch_logs")
      .select("staff_id, punch_type, recorded_at")
      .eq("project_id", projectId)
      .gte("recorded_at", startDate + "T00:00:00+09:00")
      .lte("recorded_at", endDate   + "T23:59:59+09:00")
      .order("recorded_at");
    if (error) return { success: false, message: error.message };

    // シフト取得（遅刻・早退照合用・ページネーション対応）
    const shifts: { staff_id: string; shift_date: string; shift_name: string | null; shift_start: string | null; shift_end: string | null }[] = [];
    {
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data: page, error: shiftErr } = await supabase
          .from("shifts")
          .select("staff_id, shift_date, shift_name, shift_start, shift_end")
          .eq("project_id", projectId)
          .gte("shift_date", startDate)
          .lte("shift_date", endDate)
          .range(from, from + PAGE - 1);
        if (shiftErr) return { success: false, message: shiftErr.message };
        if (!page || page.length === 0) break;
        shifts.push(...page);
        if (page.length < PAGE) break;
        from += PAGE;
      }
    }

    // 欠勤報告取得（absence_reports テーブルから）
    const { data: absenceReports } = await supabase
      .from("absence_reports")
      .select("staff_id, absence_date")
      .eq("project_id", projectId)
      .gte("absence_date", startDate)
      .lte("absence_date", endDate);
    // スタッフ×日付セットで欠勤を管理
    const absenceSet = new Set(
      (absenceReports ?? []).map((a) => `${a.staff_id}__${a.absence_date}`)
    );

    // スタッフ×日付でグループ化
    type PunchRow = { staff_id: string; punch_type: string; recorded_at: string };
    const byStaffDate = new Map<string, PunchRow[]>();
    (punches ?? []).forEach((p) => {
      const dateJST = new Date(p.recorded_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
      const key = `${p.staff_id}__${dateJST}`;
      if (!byStaffDate.has(key)) byStaffDate.set(key, []);
      byStaffDate.get(key)!.push(p);
    });

    // スタッフごとに全日の記録をまとめ（実働時間など）
    const byStaff = new Map<string, ReturnType<typeof calcDailyRecord>[]>();
    [...byStaffDate.entries()].forEach(([key, pList]) => {
      const [staffId, date] = key.split("__");
      if (!byStaff.has(staffId)) byStaff.set(staffId, []);
      byStaff.get(staffId)!.push(calcDailyRecord(date, pList));
    });

    // ── 遵守率・欠勤・遅刻・早退を計算 ──────────────────
    type AttendMetrics = { scheduled: number; absent: number; late: number; earlyLeave: number; nonCompliant: number };
    const metricsMap = new Map<string, AttendMetrics>();

    // シフトごとに照合
    for (const shift of (shifts ?? [])) {
      if (isRestShift(shift.shift_name)) continue; // 休日シフトは除外

      const sid  = shift.staff_id;
      const date = shift.shift_date;
      if (!metricsMap.has(sid)) {
        metricsMap.set(sid, { scheduled: 0, absent: 0, late: 0, earlyLeave: 0, nonCompliant: 0 });
      }
      const m = metricsMap.get(sid)!;
      m.scheduled++;

      const dayPunches = byStaffDate.get(`${sid}__${date}`) ?? [];
      const clockIn  = dayPunches.find((p) => p.punch_type === "clock_in");
      const clockOut = [...dayPunches].reverse().find((p) => p.punch_type === "clock_out");

      let dayNonCompliant = false;

      // 欠勤報告ボタンから報告済みかどうかで欠勤を判定
      if (absenceSet.has(`${sid}__${date}`)) {
        m.absent++;
        dayNonCompliant = true;
      } else {
        // 遅刻チェック（シフト開始時刻あり・打刻あり）
        if (shift.shift_start && clockIn) {
          const scheduledMin = t2m(shift.shift_start);
          const actualDt     = new Date(clockIn.recorded_at);
          const actualMin    = actualDt.getHours() * 60 + actualDt.getMinutes();
          if (actualMin > scheduledMin) {
            m.late++;
            dayNonCompliant = true;
          }
        }
        // 早退チェック（シフト終了時刻あり・退勤打刻あり）
        if (shift.shift_end && clockOut) {
          const scheduledMin = t2m(shift.shift_end);
          const actualDt     = new Date(clockOut.recorded_at);
          const actualMin    = actualDt.getHours() * 60 + actualDt.getMinutes();
          if (actualMin < scheduledMin) {
            m.earlyLeave++;
            dayNonCompliant = true;
          }
        }
      }

      if (dayNonCompliant) m.nonCompliant++;
    }

    // ── 行生成 ──────────────────────────────────────────
    // 出力対象：打刻がある or シフトがあるスタッフ全員
    const allStaffIds = new Set([
      ...[...byStaff.keys()],
      ...[...metricsMap.keys()],
    ]);

    const header = [
      "社員ID", "所属会社", "氏名",
      "勤務予定日", "稼働日数", "実働時間", "残業時間", "深夜時間", "深夜残業時間",
      "欠勤", "遅刻", "早退", "遵守率",
    ];
    const rows: string[][] = [];

    [...allStaffIds].sort().forEach((staffId) => {
      const records = byStaff.get(staffId) ?? [];
      const summary = calcMonthlySummary(staffId, nameMap.get(staffId) ?? staffId, records);
      const m = metricsMap.get(staffId) ?? { scheduled: 0, absent: 0, late: 0, earlyLeave: 0, nonCompliant: 0 };
      const rate = m.scheduled === 0
        ? "—"
        : `${Math.round((m.scheduled - m.nonCompliant) / m.scheduled * 100)}%`;

      rows.push([
        summary.staffId,
        companyMap.get(staffId) ?? "",
        summary.staffName,
        String(m.scheduled),
        String(summary.workDays),
        fmtMin(summary.actualMinutes),
        fmtMin(summary.overtimeMinutes),
        fmtMin(summary.nightMinutes),
        fmtMin(summary.nightOvertimeMinutes),
        String(m.absent),
        String(m.late),
        String(m.earlyLeave),
        rate,
      ]);
    });

    await writeSheet(sheetId(url), "月次集計", [header, ...rows]);
    return { success: true, count: rows.length };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

// ── 7. シフト変更ログ 書き出し（アプリ→スプシ）──────────

export async function exportShiftChangeLogToSheetAction(fd: FormData): Promise<SyncResult> {
  const url   = String(fd.get("url") ?? "").trim();
  const year  = Number(fd.get("year")  ?? new Date().getFullYear());
  const month = Number(fd.get("month") ?? new Date().getMonth() + 1);
  if (!url) return { success: false, message: "URLを入力してください" };

  try {
    const { supabase, projectId } = await getContext();
    const { startDate, endDate } = monthRange(year, month);
    const names = await getStaffNames(supabase, projectId);

    const { data, error } = await supabase
      .from("shift_change_logs")
      .select("changed_at, changed_by, action, staff_id, shift_date, before_data, after_data")
      .eq("project_id", projectId)
      .gte("shift_date", startDate).lte("shift_date", endDate)
      .order("changed_at", { ascending: false });
    if (error) return { success: false, message: error.message };

    const actionLabel = (a: string) =>
      a === "create" ? "追加" : a === "update" ? "変更" : "削除";

    const fmtShift = (d: Record<string, unknown> | null) => {
      if (!d) return "";
      return [d.shift_name, d.shift_start, d.shift_end].filter(Boolean).join(" ");
    };

    const toJST = (iso: string) =>
      new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit" });

    const header = ["変更日時", "変更者", "操作", "対象社員ID", "対象氏名", "対象日", "変更前", "変更後"];
    const rows = (data ?? []).map((r) => [
      toJST(r.changed_at),
      names.get(r.changed_by) ?? r.changed_by,
      actionLabel(r.action),
      r.staff_id,
      names.get(r.staff_id) ?? r.staff_id,
      r.shift_date,
      fmtShift(r.before_data as Record<string, unknown> | null),
      fmtShift(r.after_data  as Record<string, unknown> | null),
    ]);

    await writeSheet(sheetId(url), "シフト変更ログ", [header, ...rows]);
    return { success: true, count: rows.length };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

// ── 8. メンバー 書き出し（アプリ→スプシ）────────────────

export async function exportMembersToSheetAction(fd: FormData): Promise<SyncResult> {
  const url = String(fd.get("url") ?? "").trim();
  if (!url) return { success: false, message: "URLを入力してください" };

  try {
    const { supabase, projectId } = await getContext();

    const { data, error } = await supabase
      .from("project_members")
      .select("staff_id, role, staffs(name, display_name)")
      .eq("project_id", projectId)
      .order("staff_id");
    if (error) return { success: false, message: error.message };

    const header = ["社員ID", "表示名", "本名", "役割", "基本勤務日数", "メモ"];
    const rows = (data ?? []).map((m) => {
      const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
        { name: string | null; display_name: string | null } | null;
      return [
        m.staff_id,
        s?.display_name ?? "",
        s?.name ?? "",
        m.role ?? "staff",
        "",  // 基本勤務日数（スプシ上で手入力）
        "",  // メモ
      ];
    });

    await writeSheet(sheetId(url), "メンバー", [header, ...rows]);
    return { success: true, count: rows.length };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

// ── 9. メンバー 読み込み（スプシ→アプリ）────────────────

export async function importMembersFromSheetAction(fd: FormData): Promise<SyncResult> {
  const url = String(fd.get("url") ?? "").trim();
  if (!url) return { success: false, message: "URLを入力してください" };

  try {
    const { supabase, projectId } = await getContext();
    const admin = createAdminClient();

    const rows = await readSheet(sheetId(url), "メンバー");
    // ヘッダー行スキップ＋社員IDらしい形式の行のみ取得（説明行・サンプル行を自動除外）
    // 有効な社員ID: 英字1〜6文字＋数字2〜4桁 例）S001, ABC001
    const data = rows.slice(1).filter((r) => /^[A-Za-z]{1,6}\d{2,4}$/.test(r[0]?.trim() ?? ""));

    if (data.length === 0) return { success: false, message: "有効なデータがありません" };

    let created = 0;
    let updated = 0;

    for (const r of data) {
      const staffId      = r[0].trim().toUpperCase();
      const displayName  = (r[1] ?? "").trim() || staffId;
      const name         = (r[2] ?? "").trim() || displayName;
      const role         = (r[3] ?? "staff").trim() || "staff";
      const email        = `${staffId.toLowerCase()}@raq.internal`;
      const password     = "1234";

      // staffs テーブルの存在確認
      const { data: existing } = await supabase
        .from("staffs")
        .select("id, display_name, name")
        .eq("id", staffId)
        .maybeSingle();

      if (!existing) {
        // 新規：Auth ユーザー作成 + staffs レコード挿入
        const { error: authErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { staff_id: staffId },
        });
        if (authErr && authErr.message !== "A user with this email address has already been registered") {
          return { success: false, message: `${staffId} のアカウント作成に失敗: ${authErr.message}` };
        }

        const { error: staffErr } = await supabase
          .from("staffs")
          .upsert({ id: staffId, display_name: displayName, name, must_change_password: true }, { onConflict: "id" });
        if (staffErr) return { success: false, message: `${staffId} のスタッフ登録に失敗: ${staffErr.message}` };

        created++;
      } else {
        // 既存：表示名・本名が変わっていれば更新
        const needsUpdate =
          (existing.display_name ?? "") !== displayName ||
          (existing.name ?? "") !== name;
        if (needsUpdate) {
          await supabase
            .from("staffs")
            .update({ display_name: displayName, name })
            .eq("id", staffId);
        }
        updated++;
      }

      // project_members をアップサート
      await supabase
        .from("project_members")
        .upsert({ project_id: projectId, staff_id: staffId, role }, { onConflict: "project_id,staff_id" });
    }

    revalidatePath("/admin");
    revalidatePath(`/admin/${projectId}`);
    revalidatePath(`/admin/${projectId}/settings`);
    return {
      success: true,
      count: data.length,
      message: `新規${created}名、更新${updated}名`,
    };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

// ── 10. シフト表テンプレート作成（アプリ→スプシ）────────────

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

export async function createShiftTemplateAction(fd: FormData): Promise<SyncResult> {
  const url   = String(fd.get("url")   ?? "").trim();
  const year  = Number(fd.get("year")  ?? new Date().getFullYear());
  const month = Number(fd.get("month") ?? new Date().getMonth() + 1);
  if (!url) return { success: false, message: "URLを入力してください" };

  try {
    const { supabase, projectId } = await getContext();
    const { startDate, endDate } = monthRange(year, month);

    // メンバー一覧（会社名も取得）
    const { data: members } = await supabase
      .from("project_members")
      .select("staff_id, staffs(name, display_name, company_name)")
      .eq("project_id", projectId)
      .order("staff_id");

    // 承認済み希望休
    const { data: holidays } = await supabase
      .from("holiday_requests")
      .select("staff_id, request_date")
      .eq("project_id", projectId)
      .eq("status", "approved")
      .gte("request_date", startDate)
      .lte("request_date", endDate);

    // シフトパターン
    const { data: patterns } = await supabase
      .from("shift_patterns")
      .select("name, short_name, start_time, end_time, required_count")
      .eq("project_id", projectId)
      .order("sort_order");

    const holidaySet = new Set(
      (holidays ?? []).map((h) => `${h.staff_id}__${h.request_date}`)
    );

    const daysInMonth = new Date(year, month, 0).getDate();
    const dates = Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(year, month - 1, i + 1);
      return {
        day: i + 1,
        wd:  WEEKDAY_JA[d.getDay()],
        iso: `${year}-${String(month).padStart(2,"0")}-${String(i+1).padStart(2,"0")}`,
      };
    });

    // 行1: タイトル
    const titleRow = [`${year}年${month}月 シフト表`];

    // 行2〜: シフトパターン凡例（パターンがあれば）
    const patternRows = (patterns ?? []).map((p) => {
      const timeStr = p.start_time && p.end_time
        ? `${p.start_time}〜${p.end_time}`
        : p.start_time ? `${p.start_time}〜` : "休み";
      const countStr = p.required_count ? `${p.required_count}人/日` : "";
      return [`${p.name}（${p.short_name}）`, timeStr, countStr];
    });

    // 必要人数行（日付ごとに同じ人数を表示）
    const patternsWithCount = (patterns ?? []).filter((p) => p.required_count);
    const requiredRow = patternsWithCount.length > 0
      ? [
          "必要人数", "",
          ...dates.map(() =>
            patternsWithCount.map((p) => `${p.short_name}:${p.required_count}`).join(" ")
          ),
        ]
      : null;

    // ヘッダー行（A=社員ID, B=会社名, C=氏名, D〜=日付）
    const headerRow = ["社員ID", "会社名", "氏名", ...dates.map((d) => `${d.day}(${d.wd})`)];

    // スタッフ行（空欄、希望休のみ "希"）
    const memberList = members ?? [];
    const staffRows = memberList.map((m) => {
      const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
        { name: string | null; display_name: string | null; company_name: string | null } | null;
      const companyName = s?.company_name ?? "";
      const displayName = s?.display_name ?? s?.name ?? m.staff_id;
      const cells = dates.map((d) =>
        holidaySet.has(`${m.staff_id}__${d.iso}`) ? "希" : ""
      );
      return [m.staff_id, companyName, displayName, ...cells];
    });

    // ── 不足人数計算行（スプレッドシート数式） ──────────────
    // ヘッダーより前の行数を計算してシート行番号を確定
    const rowsBefore = [
      titleRow,
      ...(patternRows.length > 0 ? patternRows : []),
      [], // 空行
      ...(requiredRow ? [requiredRow] : []),
    ];
    // ヘッダーはシート行 rowsBefore.length + 1（1始まり）
    const headerSheetRow  = rowsBefore.length + 1;
    const staffStartSheet = headerSheetRow + 1;
    const staffEndSheet   = staffStartSheet + memberList.length - 1;

    // 列番号（1始まり）→列アルファベット（A, B, ..., Z, AA, ...）
    const colLetter = (n: number): string => {
      let r = "";
      while (n > 0) { n--; r = String.fromCharCode(65 + (n % 26)) + r; n = Math.floor(n / 26); }
      return r;
    };
    // 日付列: A=社員ID(1), B=会社名(2), C=氏名(3), D=day1(4), E=day2(5), ...
    const dayCol = (dayIdx: number) => colLetter(4 + dayIdx);

    // 要員数があるパターンのみ集計行を追加
    const patternsForCalc = (patterns ?? []).filter((p) => p.required_count);

    const assignedRows = patternsForCalc.map((p) => [
      `配置数（${p.short_name}）`, "",
      ...dates.map((_, i) => {
        const col = dayCol(i);
        return `=COUNTIF(${col}${staffStartSheet}:${col}${staffEndSheet},"${p.short_name}")`;
      }),
    ]);

    const shortageRows = patternsForCalc.map((p) => [
      `不足数（${p.short_name}）`, "",
      ...dates.map((_, i) => {
        const col = dayCol(i);
        return `=MAX(0,${p.required_count}-COUNTIF(${col}${staffStartSheet}:${col}${staffEndSheet},"${p.short_name}"))`;
      }),
    ]);

    const rows: string[][] = [
      ...rowsBefore,
      headerRow,
      ...staffRows,
      ...(patternsForCalc.length > 0 ? [
        [], // 空行セパレータ
        ...assignedRows,
        ...shortageRows,
      ] : []),
    ];

    const sheetTabName = `${year}年${month}月シフト表`;
    await writeSheet(sheetId(url), sheetTabName, rows);
    return { success: true, count: memberList.length };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

// ── 11. シフト表 読み込み（スプシ→アプリ）────────────────

export async function importShiftTableAction(fd: FormData): Promise<SyncResult> {
  const url   = String(fd.get("url")   ?? "").trim();
  const year  = Number(fd.get("year")  ?? new Date().getFullYear());
  const month = Number(fd.get("month") ?? new Date().getMonth() + 1);
  if (!url) return { success: false, message: "URLを入力してください" };

  try {
    const { supabase, staffId, projectId } = await getContext();
    const sheetTabName = `${year}年${month}月シフト表`;
    // 列数制限なし（先頭ヘッダー列数がスプシフォーマットにより異なるため全列取得）
    const rows = await readSheet(sheetId(url), sheetTabName, "");

    if (rows.length < 2) return { success: false, message: "データがありません" };

    // 年月は引数から直接使用（シート名で確定済み）
    const y  = String(year);
    const mo = String(month).padStart(2, "0");

    // 日付セル（例: "1(月)" or "5/1(金)"）を含む行をヘッダー行として検出
    const headerRowIdx = rows.findIndex((r) =>
      r.some((cell) => /^\d{1,2}[\(\/]/.test(cell ?? ""))
    );
    if (headerRowIdx < 0) return { success: false, message: "ヘッダー行（日付列）が見つかりません。テンプレート作成を先に実行してください" };
    const headerRow = rows[headerRowIdx];

    // 列インデックス→ISO日付
    const colDateMap = new Map<number, string>();
    headerRow.forEach((cell, i) => {
      // "1(月)" 形式（createShiftTemplate）または "5/1(金)" 形式（generateShiftTable）に対応
      const m = (cell ?? "").match(/^(?:\d{1,2}\/)?(\d{1,2})\(/);
      if (m) colDateMap.set(i, `${y}-${mo}-${String(m[1]).padStart(2, "0")}`);
    });

    // 社員ID列を特定（"社員ID" ヘッダーを探す、なければ列0を使用）
    const staffIdColIdx = headerRow.findIndex((c) => (c ?? "").trim() === "社員ID");
    const idCol = staffIdColIdx >= 0 ? staffIdColIdx : 0;

    const records: { project_id: string; staff_id: string; shift_date: string; shift_name: string | null }[] = [];

    rows.slice(headerRowIdx + 1).forEach((row) => {
      const rowStaffId = (row[idCol] ?? "").trim().toUpperCase();
      // スタッフIDっぽくない行（ラベル行・空行・数式行）はスキップ
      if (!rowStaffId || !/^[A-Z]{1,3}\d{2,4}$/.test(rowStaffId)) return;
      colDateMap.forEach((date, colIdx) => {
        const cell = (row[colIdx] ?? "").trim();
        if (!cell || cell === "希" || cell === "公休") return; // 空・希望休はスキップ
        records.push({
          project_id: projectId,
          staff_id:   rowStaffId,
          shift_date: date,
          shift_name: cell,
        });
      });
    });

    if (records.length === 0) return { success: false, message: "インポートできるシフトデータがありません" };

    let count = 0;
    for (let i = 0; i < records.length; i += 500) {
      const { count: c, error } = await supabase.from("shifts").upsert(
        records.slice(i, i + 500),
        { onConflict: "project_id,staff_id,shift_date", count: "exact" }
      );
      if (error) return { success: false, message: error.message };
      count += c ?? 0;
    }

    // 「必要人数」行が含まれていれば shift_patterns.required_count を同期する
    await syncRequiredCountsFromSheetRows(rows, headerRowIdx, projectId).catch(() => {/* best-effort */});

    revalidatePath("/shifts");
    revalidatePath("/shifts/manage");
    return { success: true, count };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

// ── 11.5 シフト表 ワンタッチ読み込み（URLをDBから自動取得）────

export async function quickImportShiftTableAction(fd: FormData): Promise<SyncResult> {
  const year      = Number(fd.get("year")      ?? new Date().getFullYear());
  const month     = Number(fd.get("month")     ?? new Date().getMonth() + 1);
  const projectId = String(fd.get("projectId") ?? "").trim();

  try {
    const { supabase, staffId } = await getUserContext();
    const admin = createAdminClient();

    // FormData の projectId を優先、なければ Cookie の案件ID
    const resolvedProjectId = projectId || (await getCurrentProjectId()) || "";
    if (!resolvedProjectId) return { success: false, message: "案件が選択されていません" };

    // project_settings から sheet_url を取得（RLSをバイパス）
    const { data: settings } = await admin
      .from("project_settings")
      .select("sheet_url")
      .eq("project_id", resolvedProjectId)
      .maybeSingle();

    const url = settings?.sheet_url ?? "";
    if (!url) return { success: false, message: "スプレッドシートURLが設定されていません（案件設定で登録してください）" };

    const sheetTabName = `${year}年${month}月シフト表`;
    // 列数制限なし（先頭ヘッダー列数がスプシフォーマットにより異なるため全列取得）
    const rows = await readSheet(sheetId(url), sheetTabName, "");
    if (rows.length < 2) return { success: false, message: `「${sheetTabName}」シートにデータがありません` };

    // 年月は引数から直接使用（シート名で確定済み）
    const y  = String(year);
    const mo = String(month).padStart(2, "0");

    // 日付セル（例: "1(月)" or "5/1(金)"）を含む行をヘッダー行として検出
    const headerRowIdx = rows.findIndex((r) =>
      r.some((cell) => /^\d{1,2}[\(\/]/.test(cell ?? ""))
    );
    if (headerRowIdx < 0) return { success: false, message: "ヘッダー行（日付列）が見つかりません。テンプレート作成を先に実行してください" };
    const headerRow = rows[headerRowIdx];

    const colDateMap = new Map<number, string>();
    headerRow.forEach((cell, i) => {
      // "1(月)" 形式（createShiftTemplate）または "5/1(金)" 形式（generateShiftTable）に対応
      const m = (cell ?? "").match(/^(?:\d{1,2}\/)?(\d{1,2})\(/);
      if (m) colDateMap.set(i, `${y}-${mo}-${String(m[1]).padStart(2, "0")}`);
    });

    // 社員ID列を特定（"社員ID" ヘッダーを探す、なければ列0を使用）
    const staffIdColIdx = headerRow.findIndex((c) => (c ?? "").trim() === "社員ID");
    const idCol = staffIdColIdx >= 0 ? staffIdColIdx : 0;

    const records: { project_id: string; staff_id: string; shift_date: string; shift_name: string | null }[] = [];
    rows.slice(headerRowIdx + 1).forEach((row) => {
      const rowStaffId = (row[idCol] ?? "").trim().toUpperCase();
      // スタッフIDっぽくない行（ラベル行・空行・数式行）はスキップ
      if (!rowStaffId || !/^[A-Z]{1,3}\d{2,4}$/.test(rowStaffId)) return;
      colDateMap.forEach((date, colIdx) => {
        const cell = (row[colIdx] ?? "").trim();
        if (!cell || cell === "希") return;
        records.push({ project_id: resolvedProjectId, staff_id: rowStaffId, shift_date: date, shift_name: cell });
      });
    });

    if (records.length === 0) return { success: false, message: "インポートできるシフトデータがありません" };

    let count = 0;
    for (let i = 0; i < records.length; i += 500) {
      const { count: c, error } = await admin.from("shifts").upsert(
        records.slice(i, i + 500),
        { onConflict: "project_id,staff_id,shift_date", count: "exact" }
      );
      if (error) return { success: false, message: error.message };
      count += c ?? 0;
    }

    // 「必要人数」行が含まれていれば shift_patterns.required_count を同期する
    await syncRequiredCountsFromSheetRows(rows, headerRowIdx, resolvedProjectId).catch(() => {/* best-effort */});

    revalidatePath("/shifts");
    revalidatePath("/shifts/manage");
    return { success: true, count };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

// ── 12. 設定 読み込み（スプシ→アプリ）──────────────────

export async function importSettingsFromSheetAction(fd: FormData): Promise<SyncResult> {
  const url = String(fd.get("url") ?? "").trim();
  if (!url) return { success: false, message: "URLを入力してください" };

  try {
    const { supabase, projectId } = await getContext();
    const rows = await readSheet(sheetId(url), "設定");

    const map = new Map<string, string>();
    rows.slice(1).forEach((r) => {
      if (r[0] && r[1] !== undefined) map.set(r[0].trim(), r[1].trim());
    });

    const toB = (k: string, def: boolean) => {
      const v = map.get(k);
      if (!v) return def;
      return v === "ON" || v === "true" || v === "1";
    };
    const toN = (k: string, def: number) => {
      const v = map.get(k);
      return v ? (Number(v) || def) : def;
    };

    const settings = {
      project_id:               projectId,
      notify_absence_line:      toB("欠勤通知_LINE",    true),
      notify_late_line:         toB("遅刻通知_LINE",    true),
      notify_punch_line:        toB("打刻通知_LINE",    false),
      notify_notice_line:       toB("お知らせ通知_LINE", true),
      holiday_deadline_day:     toN("希望休_申請期限日",  20),
      holiday_max_days:         toN("希望休_上限日数",    3),
      updated_at:               new Date().toISOString(),
    };

    const { error } = await supabase
      .from("project_settings")
      .upsert(settings, { onConflict: "project_id" });
    if (error) return { success: false, message: error.message };

    revalidatePath("/shifts/manage");
    return { success: true, count: map.size };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}
