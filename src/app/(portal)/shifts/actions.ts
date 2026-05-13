/**
 * シフトのCRUDアクション
 * - 案件管理者のみが作成・編集・削除可能（RLSでも保護）
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";
import { readSheet, writeSheet, patchSheetCell, appendSheetRow, extractSpreadsheetId, isGSheetsConfigured } from "@/lib/gsheets";

export type ShiftResult = {
  success: boolean;
  message?: string;
};

function timeOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

// ── スプレッドシートの該当セルを更新（ベストエフォート） ──────
// 失敗しても例外を投げず無視する（本体処理を止めない）
async function syncShiftCellToSheet(
  projectId: string,
  staffId: string,
  shiftDate: string,  // "2026-05-09"
  newValue: string    // シフト名 or "" (削除)
): Promise<void> {
  if (!isGSheetsConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data: settings } = await admin
      .from("project_settings").select("sheet_url")
      .eq("project_id", projectId).maybeSingle();
    const url = settings?.sheet_url;
    if (!url) return;

    const spreadsheetId = extractSpreadsheetId(url);
    const [yearStr, monthStr, dayStr] = shiftDate.split("-");
    const year  = parseInt(yearStr);
    const month = parseInt(monthStr);
    const day   = parseInt(dayStr);
    const sheetTabName = `${year}年${month}月シフト表`;

    let rows: string[][];
    try { rows = await readSheet(spreadsheetId, sheetTabName); }
    catch { return; } // シートが存在しない場合は無視

    // ヘッダー行（日付セルがある行）を検出
    const headerRowIdx = rows.findIndex((r) =>
      r.some((cell) => /^\d{1,2}[\(\/]/.test(cell ?? ""))
    );
    if (headerRowIdx < 0) return;
    const headerRow = rows[headerRowIdx];

    // 日付列を特定
    let dateColIdx = -1;
    headerRow.forEach((cell, i) => {
      const m = (cell ?? "").match(/^(?:\d{1,2}\/)?(\d{1,2})\(/);
      if (m && parseInt(m[1]) === day) dateColIdx = i;
    });
    if (dateColIdx < 0) return;

    // 社員ID列を特定
    const staffIdColIdx = headerRow.findIndex((c) => (c ?? "").trim() === "社員ID");
    const idCol = staffIdColIdx >= 0 ? staffIdColIdx : 0;

    // スタッフ行を特定
    const dataRows = rows.slice(headerRowIdx + 1);
    const staffRowIdx = dataRows.findIndex((row) =>
      (row[idCol] ?? "").trim().toUpperCase() === staffId.toUpperCase()
    );
    if (staffRowIdx < 0) return;

    // セル位置（1始まり）を計算
    const sheetRowNum = headerRowIdx + staffRowIdx + 2; // +1(0→1) +1(header→data)
    const colLetter = (n: number): string => {
      let r = ""; let col = n + 1;
      while (col > 0) { col--; r = String.fromCharCode(65 + (col % 26)) + r; col = Math.floor(col / 26); }
      return r;
    };
    const cellRange = `${colLetter(dateColIdx)}${sheetRowNum}`;
    await patchSheetCell(spreadsheetId, sheetTabName, cellRange, newValue);
  } catch {
    // スプレッドシート更新に失敗しても本体処理は続行
  }
}

// ── シフト変更ログをスプレッドシートへ追記（ベストエフォート） ──
async function appendChangeLogToSheet(
  projectId: string,
  changedByName: string,  // 変更者表示名
  action: "create" | "update" | "delete",
  staffId: string,
  staffName: string,       // 対象スタッフ表示名
  shiftDate: string,       // "2026-05-09"
  before: Record<string, unknown> | null,
  after:  Record<string, unknown> | null,
): Promise<void> {
  if (!isGSheetsConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data: settings } = await admin
      .from("project_settings").select("sheet_url")
      .eq("project_id", projectId).maybeSingle();
    const url = settings?.sheet_url;
    if (!url) return;

    const spreadsheetId = extractSpreadsheetId(url);

    const actionLabel = action === "create" ? "追加" : action === "update" ? "変更" : "削除";
    const fmtShift = (d: Record<string, unknown> | null) => {
      if (!d) return "";
      return [d.shift_name, d.shift_start, d.shift_end].filter(Boolean).join(" ");
    };
    const now = new Date().toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });

    const row = [
      now,
      changedByName,
      actionLabel,
      staffId,
      staffName,
      shiftDate,
      fmtShift(before),
      fmtShift(after),
    ];

    await appendSheetRow(spreadsheetId, "シフト変更ログ", row);
  } catch {
    // スプレッドシート追記に失敗しても本体処理は続行
  }
}

// スタッフ表示名を取得（見つからなければIDをそのまま返す）
async function getStaffDisplayName(staffId: string): Promise<string> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
    return data?.display_name ?? data?.name ?? staffId;
  } catch {
    return staffId;
  }
}

export async function upsertShiftAction(
  formData: FormData
): Promise<ShiftResult> {
  const id = String(formData.get("id") ?? "").trim();
  const staffId = String(formData.get("staffId") ?? "").trim().toUpperCase();
  const shiftDate = String(formData.get("shiftDate") ?? "").trim();
  const shiftName = String(formData.get("shiftName") ?? "").trim() || null;
  const shiftStart = timeOrNull(formData.get("shiftStart"));
  const shiftEnd = timeOrNull(formData.get("shiftEnd"));
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!staffId || !shiftDate) {
    return { success: false, message: "社員IDと日付は必須です" };
  }

  const supabase = await createClient();
  // FormData に projectId があればそれを優先（ops モード対応）、なければ Cookie から
  const formProjectId = String(formData.get("projectId") ?? "").trim() || null;
  const projectId = formProjectId ?? await getCurrentProjectId();
  if (!projectId)
    return { success: false, message: "案件が選択されていません" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };
  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const payload = {
    project_id: projectId,
    staff_id: staffId,
    shift_date: shiftDate,
    shift_name: shiftName,
    shift_start: shiftStart,
    shift_end: shiftEnd,
    note,
    created_by: myStaffId,
  };

  // DB書き込みは adminClient（RLSバイパス）で行う
  // 認証チェックは上の supabase.auth.getUser() で完了済み
  const adminDb = createAdminClient();

  // スタッフ・変更者の表示名を取得（スプシログ用）
  const [staffName, changedByName] = await Promise.all([
    getStaffDisplayName(staffId),
    getStaffDisplayName(myStaffId),
  ]);

  if (id) {
    // 変更前のデータを取得
    const { data: before } = await adminDb
      .from("shifts").select("shift_name,shift_start,shift_end,note").eq("id", id).maybeSingle();
    const { error } = await adminDb.from("shifts").update(payload).eq("id", id);
    if (error) return { success: false, message: "更新失敗：" + error.message };
    // 変更ログ記録（DB）
    await adminDb.from("shift_change_logs").insert({
      project_id: projectId, shift_id: id,
      staff_id: staffId, shift_date: shiftDate,
      action: "update", before_data: before ?? null, after_data: payload,
      changed_by: myStaffId,
    });
    // 変更ログ追記（スプレッドシート）
    await appendChangeLogToSheet(projectId, changedByName, "update", staffId, staffName, shiftDate, before ?? null, payload);
  } else {
    const { data: upserted, error } = await adminDb.from("shifts").upsert(payload, {
      onConflict: "project_id,staff_id,shift_date",
    }).select("id").maybeSingle();
    if (error) return { success: false, message: "登録失敗：" + error.message };
    // 変更ログ記録（DB）
    await adminDb.from("shift_change_logs").insert({
      project_id: projectId, shift_id: upserted?.id ?? null,
      staff_id: staffId, shift_date: shiftDate,
      action: "create", before_data: null, after_data: payload,
      changed_by: myStaffId,
    });
    // 変更ログ追記（スプレッドシート）
    await appendChangeLogToSheet(projectId, changedByName, "create", staffId, staffName, shiftDate, null, payload);
  }

  // スプレッドシートの該当セルを更新（ベストエフォート）
  await syncShiftCellToSheet(projectId, staffId, shiftDate, shiftName ?? "");

  revalidatePath("/shifts");
  revalidatePath("/shifts/manage");
  return { success: true };
}

export async function deleteShiftAction(
  formData: FormData
): Promise<ShiftResult> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { success: false, message: "IDが必要です" };

  // 認証は通常クライアントで確認
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };
  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  // DB操作は adminClient（RLS をバイパスして before データを確実に取得）
  const admin = createAdminClient();

  // 削除前にデータ取得（project_id もここから取る）
  const { data: before } = await admin
    .from("shifts")
    .select("project_id,staff_id,shift_date,shift_name,shift_start,shift_end,note")
    .eq("id", id).maybeSingle();

  // project_id: FormData → before → Cookie の優先順で解決
  const formProjectId = String(formData.get("projectId") ?? "").trim() || null;
  const effectiveProjectId = formProjectId ?? before?.project_id ?? await getCurrentProjectId();

  // ── 変更ログを先に記録（削除後は shift_id の FK が切れるため） ──
  if (before && effectiveProjectId) {
    await admin.from("shift_change_logs").insert({
      project_id: effectiveProjectId, shift_id: id,
      staff_id: before.staff_id, shift_date: before.shift_date,
      action: "delete", before_data: before, after_data: null,
      changed_by: myStaffId,
    });
  }

  // ── シフトを削除 ──
  const { error } = await admin.from("shifts").delete().eq("id", id);
  if (error) return { success: false, message: "削除失敗：" + error.message };

  // ── スプレッドシートへ反映（ベストエフォート） ──
  if (before && effectiveProjectId) {
    const [staffName, changedByName] = await Promise.all([
      getStaffDisplayName(before.staff_id),
      getStaffDisplayName(myStaffId),
    ]);
    await Promise.all([
      syncShiftCellToSheet(effectiveProjectId, before.staff_id, before.shift_date, ""),
      appendChangeLogToSheet(effectiveProjectId, changedByName, "delete", before.staff_id, staffName, before.shift_date, before, null),
    ]);
  }

  revalidatePath("/shifts");
  revalidatePath("/shifts/manage");
  return { success: true };
}

/**
 * スタッフを入れ替える（スワップ or 譲渡）
 * - 相手にシフトがある → 両者のシフトを入れ替え
 * - 相手にシフトがない → 一方的に譲渡（現シフトを相手に移す）
 */
export async function swapShiftsAction(
  formData: FormData
): Promise<ShiftResult> {
  const shiftIdA  = String(formData.get("shiftIdA")  ?? "").trim(); // 元シフトID
  const staffIdB  = String(formData.get("staffIdB")  ?? "").trim().toUpperCase(); // 相手スタッフID
  const projectId = String(formData.get("projectId") ?? "").trim();

  if (!shiftIdA || !staffIdB || !projectId) {
    return { success: false, message: "パラメータが不足しています" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };
  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const admin = createAdminClient();

  // 元シフト（A）を取得
  const { data: shiftA } = await admin
    .from("shifts").select("*").eq("id", shiftIdA).maybeSingle();
  if (!shiftA) return { success: false, message: "シフトが見つかりません" };

  // 相手（B）の同日シフトを取得
  const { data: shiftB } = await admin
    .from("shifts").select("*")
    .eq("project_id", projectId)
    .eq("staff_id", staffIdB)
    .eq("shift_date", shiftA.shift_date)
    .maybeSingle();

  if (shiftB) {
    // ── 両者ともシフトあり → スワップ ──────────────────────
    // FK制約のため変更ログを先に記録
    await admin.from("shift_change_logs").insert([
      {
        project_id: projectId, shift_id: shiftA.id,
        staff_id: shiftA.staff_id, shift_date: shiftA.shift_date,
        action: "update",
        before_data: shiftA,
        after_data: { ...shiftA, staff_id: staffIdB },
        changed_by: myStaffId,
      },
      {
        project_id: projectId, shift_id: shiftB.id,
        staff_id: shiftB.staff_id, shift_date: shiftB.shift_date,
        action: "update",
        before_data: shiftB,
        after_data: { ...shiftB, staff_id: shiftA.staff_id },
        changed_by: myStaffId,
      },
    ]);

    // Bを一旦削除（一意制約の衝突を回避）
    await admin.from("shifts").delete().eq("id", shiftB.id);
    // AのスタッフIDをBに変更
    const { error: errA } = await admin.from("shifts")
      .update({ staff_id: staffIdB }).eq("id", shiftIdA);
    if (errA) return { success: false, message: "更新失敗：" + errA.message };
    // Bのデータ（元Aのスタッフ）を再登録
    await admin.from("shifts").insert({
      project_id: projectId,
      staff_id:   shiftA.staff_id,
      shift_date: shiftB.shift_date,
      shift_name: shiftB.shift_name,
      shift_start: shiftB.shift_start,
      shift_end:   shiftB.shift_end,
      note:        shiftB.note,
    });

    // スプレッドシートのセルを更新
    await Promise.all([
      syncShiftCellToSheet(projectId, staffIdB,         shiftA.shift_date, shiftA.shift_name ?? ""),
      syncShiftCellToSheet(projectId, shiftA.staff_id,  shiftB.shift_date, shiftB.shift_name ?? ""),
    ]);
  } else {
    // ── B にシフトなし → 譲渡（A の staff_id を B に変更） ──
    await admin.from("shift_change_logs").insert({
      project_id: projectId, shift_id: shiftIdA,
      staff_id: shiftA.staff_id, shift_date: shiftA.shift_date,
      action: "update",
      before_data: shiftA,
      after_data: { ...shiftA, staff_id: staffIdB },
      changed_by: myStaffId,
    });
    const { error } = await admin.from("shifts")
      .update({ staff_id: staffIdB }).eq("id", shiftIdA);
    if (error) return { success: false, message: "更新失敗：" + error.message };

    await Promise.all([
      syncShiftCellToSheet(projectId, staffIdB,        shiftA.shift_date, shiftA.shift_name ?? ""),
      syncShiftCellToSheet(projectId, shiftA.staff_id, shiftA.shift_date, ""),
    ]);
  }

  // スプレッドシート変更ログ追記（ベストエフォート）
  const [nameA, nameB, changedByName] = await Promise.all([
    getStaffDisplayName(shiftA.staff_id),
    getStaffDisplayName(staffIdB),
    getStaffDisplayName(myStaffId),
  ]);
  await appendChangeLogToSheet(
    projectId, changedByName, "update",
    shiftA.staff_id, `${nameA}⇄${nameB}`,
    shiftA.shift_date, shiftA, null,
  );

  revalidatePath("/shifts");
  revalidatePath("/shifts/manage");
  return { success: true };
}

export type CsvImportResult = {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
};

/**
 * CSVインポート
 * フォーマット（1行目ヘッダー）:
 * 社員ID,日付,シフト名,開始,終了,備考
 * S001,2026-05-01,日勤,09:00,18:00,
 */
export async function importShiftsCsvAction(
  formData: FormData
): Promise<CsvImportResult> {
  const file = formData.get("csv") as File | null;
  if (!file || file.size === 0) {
    return { success: false, imported: 0, skipped: 0, errors: ["ファイルが選択されていません"] };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, imported: 0, skipped: 0, errors: ["ログインしてください"] };

  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, imported: 0, skipped: 0, errors: ["案件が選択されていません"] };

  const text = await file.text();
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  const rows: {
    project_id: string;
    staff_id: string;
    shift_date: string;
    shift_name: string | null;
    shift_start: string | null;
    shift_end: string | null;
    note: string | null;
  }[] = [];

  const errors: string[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(",").map((c) => c.trim());
    const [staffId, shiftDate, shiftName, shiftStart, shiftEnd, note] = cols;

    if (!staffId || !shiftDate) {
      errors.push(`行${i + 1}: 社員IDまたは日付が空です`);
      skipped++;
      continue;
    }

    // 日付フォーマット検証
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) {
      errors.push(`行${i + 1}: 日付フォーマットが不正です（${shiftDate}）`);
      skipped++;
      continue;
    }

    rows.push({
      project_id: projectId,
      staff_id: staffId.toUpperCase(),
      shift_date: shiftDate,
      shift_name: shiftName || null,
      shift_start: shiftStart || null,
      shift_end: shiftEnd || null,
      note: note || null,
    });
  }

  if (rows.length === 0) {
    return { success: false, imported: 0, skipped, errors: [...errors, "有効なデータが0件でした"] };
  }

  // 500件ずつバッチ処理
  let imported = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error, count } = await supabase.from("shifts").upsert(batch, {
      onConflict: "project_id,staff_id,shift_date",
      count: "exact",
    });
    if (error) {
      errors.push(`バッチ${Math.floor(i / 500) + 1}でエラー：${error.message}`);
      skipped += batch.length;
    } else {
      imported += count ?? batch.length;
    }
  }

  revalidatePath("/shifts");
  revalidatePath("/shifts/manage");

  return {
    success: errors.length === 0 || imported > 0,
    imported,
    skipped,
    errors,
  };
}

// ────────────────────────────────────────────────────────────
//  Google Sheets 連携
// ────────────────────────────────────────────────────────────

export type SheetsSyncResult = {
  success: boolean;
  count: number;
  message?: string;
};

/**
 * スプレッドシートからシフトを読み込む
 * シート列: A=社員ID, B=氏名(無視), C=日付, D=シフト名, E=開始, F=終了, G=備考
 * 1行目はヘッダーとして読み飛ばす
 */
export async function importFromSheetAction(
  formData: FormData
): Promise<SheetsSyncResult> {
  if (!isGSheetsConfigured()) {
    return { success: false, count: 0, message: "Google Sheetsが設定されていません（GOOGLE_SERVICE_ACCOUNT_JSON）" };
  }

  const spreadsheetUrl = String(formData.get("spreadsheetUrl") ?? "").trim();
  const sheetName = String(formData.get("sheetName") ?? "シフト").trim();

  if (!spreadsheetUrl) return { success: false, count: 0, message: "スプレッドシートのURLを入力してください" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, count: 0, message: "ログインしてください" };

  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, count: 0, message: "案件が選択されていません" };

  let rows: string[][];
  try {
    const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
    rows = await readSheet(spreadsheetId, sheetName);
  } catch (e) {
    return { success: false, count: 0, message: String((e as Error).message) };
  }

  // ヘッダー行をスキップ
  const dataRows = rows.slice(1).filter((r) => r[0] && r[2]); // 社員ID・日付が必須

  if (dataRows.length === 0) {
    return { success: false, count: 0, message: "有効なデータが見つかりませんでした" };
  }

  const records = dataRows.map((r) => ({
    project_id: projectId,
    staff_id: (r[0] ?? "").toUpperCase(),
    shift_date: r[2] ?? "",
    shift_name: r[3] || null,
    shift_start: r[4] || null,
    shift_end: r[5] || null,
    note: r[6] || null,
  })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.shift_date));

  let count = 0;
  for (let i = 0; i < records.length; i += 500) {
    const { count: c, error } = await supabase.from("shifts").upsert(
      records.slice(i, i + 500),
      { onConflict: "project_id,staff_id,shift_date", count: "exact" }
    );
    if (error) return { success: false, count, message: "DB登録エラー：" + error.message };
    count += c ?? 0;
  }

  revalidatePath("/shifts");
  revalidatePath("/shifts/manage");
  return { success: true, count };
}

/**
 * DB上のシフトをスプレッドシートに書き戻す
 * 対象月のシフトを全件上書き
 */
export async function exportToSheetAction(
  formData: FormData
): Promise<SheetsSyncResult> {
  if (!isGSheetsConfigured()) {
    return { success: false, count: 0, message: "Google Sheetsが設定されていません（GOOGLE_SERVICE_ACCOUNT_JSON）" };
  }

  const spreadsheetUrl = String(formData.get("spreadsheetUrl") ?? "").trim();
  const sheetName = String(formData.get("sheetName") ?? "シフト").trim();
  const year = Number(formData.get("year") ?? new Date().getFullYear());
  const month = Number(formData.get("month") ?? new Date().getMonth() + 1);

  if (!spreadsheetUrl) return { success: false, count: 0, message: "スプレッドシートのURLを入力してください" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, count: 0, message: "ログインしてください" };

  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, count: 0, message: "案件が選択されていません" };

  // 月の範囲
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(year, month, 0).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  // DB からシフト取得（スタッフ名も一緒に）
  const { data: shifts, error } = await supabase
    .from("shifts")
    .select("staff_id, shift_date, shift_name, shift_start, shift_end, note, staffs(name, display_name)")
    .eq("project_id", projectId)
    .gte("shift_date", startDate)
    .lte("shift_date", endDate)
    .order("shift_date")
    .order("staff_id");

  if (error) return { success: false, count: 0, message: "DB取得エラー：" + error.message };

  // ヘッダー + データ行
  const header = ["社員ID", "氏名", "日付", "シフト名", "開始", "終了", "備考"];
  const dataRows = (shifts ?? []).map((s) => {
    const staffInfo = (Array.isArray(s.staffs) ? s.staffs[0] : s.staffs) as
      | { name: string | null; display_name: string | null }
      | null;
    const name = staffInfo?.display_name ?? staffInfo?.name ?? s.staff_id;
    return [
      s.staff_id,
      name,
      s.shift_date,
      s.shift_name ?? "",
      s.shift_start?.slice(0, 5) ?? "",
      s.shift_end?.slice(0, 5) ?? "",
      s.note ?? "",
    ];
  });

  try {
    const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
    await writeSheet(spreadsheetId, sheetName, [header, ...dataRows]);
  } catch (e) {
    return { success: false, count: 0, message: String((e as Error).message) };
  }

  return { success: true, count: dataRows.length };
}
