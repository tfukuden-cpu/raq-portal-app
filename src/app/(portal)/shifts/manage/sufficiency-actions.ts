"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSheet, extractSpreadsheetId, generateSufficiencySheet } from "@/lib/gsheets";

export async function upsertSlotRequirementAction(fd: FormData): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "未認証" };

  const projectId    = String(fd.get("projectId")    ?? "").trim();
  const section      = String(fd.get("section")      ?? "").trim();
  const patternName  = String(fd.get("patternName")  ?? "").trim();
  const shiftDate    = String(fd.get("shiftDate")    ?? "").trim();
  const requiredCount = Number(fd.get("requiredCount") ?? 0);

  if (!projectId || !section || !patternName || !shiftDate) {
    return { success: false, message: "パラメータ不足" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("shift_slot_requirements")
    .upsert(
      { project_id: projectId, section, pattern_name: patternName, shift_date: shiftDate, required_count: requiredCount },
      { onConflict: "project_id,section,pattern_name,shift_date" }
    );

  if (error) return { success: false, message: error.message };
  return { success: true };
}

/**
 * スプレッドシートの「必要」行を読み込んで shift_slot_requirements に一括保存
 * ※ 初回のみ想定。以降はアプリ上で直接編集。
 */
export async function importRequiredCountsFromSheetAction(fd: FormData): Promise<{ success: boolean; message?: string; count?: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "未認証" };

  const projectId = String(fd.get("projectId") ?? "").trim();
  const year      = Number(fd.get("year")  ?? 0);
  const month     = Number(fd.get("month") ?? 0);
  if (!projectId || !year || !month) return { success: false, message: "パラメータ不足" };

  const admin = createAdminClient();

  // スプシURL取得
  const { data: settings } = await admin
    .from("project_settings").select("sheet_url").eq("project_id", projectId).maybeSingle();
  if (!settings?.sheet_url) return { success: false, message: "スプレッドシートが設定されていません" };

  // セクション付きパターンを sort_order 順に取得
  const { data: patternRows } = await admin
    .from("shift_patterns")
    .select("name, section, target_role, required_count, sort_order")
    .eq("project_id", projectId)
    .order("sort_order");

  const patterns = (patternRows ?? []).filter(p => p.section); // セクションあるものだけ対象
  if (patterns.length === 0) return { success: false, message: "セクションが設定されたパターンがありません" };

  // 管理者パターン先・スタッフパターン後の順（gsheets.ts と同じ並び順）
  const adminPats = patterns.filter(p => (p as { target_role?: string }).target_role === "admin");
  const staffPats = patterns.filter(p => (p as { target_role?: string }).target_role !== "admin");
  const orderedPatterns = [...adminPats, ...staffPats];

  // シート読み取り
  const sheetName = `${year}年${month}月シフト表`;
  let rows: string[][];
  try {
    rows = await readSheet(extractSpreadsheetId(settings.sheet_url), sheetName);
  } catch (e) {
    return { success: false, message: `シート読み取りエラー: ${e instanceof Error ? e.message : String(e)}` };
  }

  // A列が "必要" の行を順番に抽出
  const requiredRows = rows.filter(row => (row[0] ?? "").trim() === "必要");

  if (requiredRows.length === 0) {
    return { success: false, message: `「必要」行が見つかりません（シート名: ${sheetName}）` };
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStr = String(month).padStart(2, "0");

  // パターンと必要行を順番に対応付け（足りない場合は打ち切り）
  const upsertData: { project_id: string; section: string; pattern_name: string; shift_date: string; required_count: number }[] = [];
  const matchCount = Math.min(orderedPatterns.length, requiredRows.length);

  for (let pi = 0; pi < matchCount; pi++) {
    const pattern    = orderedPatterns[pi];
    const reqRow     = requiredRows[pi];
    const section    = pattern.section!;

    for (let di = 0; di < daysInMonth; di++) {
      // 列D(index 3)から日別値が入っている
      const cellVal = (reqRow[di + 3] ?? "").trim();
      const count   = cellVal === "" ? 0 : Number(cellVal);
      if (isNaN(count)) continue;
      if (count === 0) continue; // 0は保存しない（デフォルト値に任せる）

      const shiftDate = `${year}-${monthStr}-${String(di + 1).padStart(2, "0")}`;
      upsertData.push({
        project_id:    projectId,
        section,
        pattern_name:  pattern.name,
        shift_date:    shiftDate,
        required_count: count,
      });
    }
  }

  if (upsertData.length === 0) {
    return { success: false, message: "読み込める必要数データがありませんでした" };
  }

  // 一括 upsert（既存は上書き）
  const { error } = await admin
    .from("shift_slot_requirements")
    .upsert(upsertData, { onConflict: "project_id,section,pattern_name,shift_date" });

  if (error) return { success: false, message: error.message };

  // 充足シートも更新
  try {
    const { data: memberRows } = await admin
      .from("project_members").select("staff_id, section").eq("project_id", projectId);
    const { data: shiftRows } = await admin
      .from("shifts").select("staff_id, shift_date, shift_name")
      .eq("project_id", projectId)
      .gte("shift_date", `${year}-${String(month).padStart(2,"0")}-01`)
      .lte("shift_date", `${year}-${String(month).padStart(2,"0")}-${String(new Date(year,month,0).getDate()).padStart(2,"0")}`);
    const memberList = (memberRows ?? []).map(m => ({ id: m.staff_id, section: m.section as string | null }));
    const shiftList  = (shiftRows  ?? []).map(s => ({ staffId: s.staff_id, shiftDate: s.shift_date as string, shiftName: s.shift_name as string }));
    const patternList = orderedPatterns.map(p => ({
      name: p.name,
      section: p.section,
      required_weekday: (p as { required_weekday?: number|null }).required_weekday ?? null,
      required_weekend: (p as { required_weekend?: number|null }).required_weekend ?? null,
      required_count: (p as { required_count?: number|null }).required_count ?? null,
    }));
    await generateSufficiencySheet(
      extractSpreadsheetId(settings.sheet_url), memberList, patternList, shiftList, year, month,
    );
  } catch { /* 充足シート更新失敗は無視 */ }

  return { success: true, count: upsertData.length, message: `${upsertData.length}件を読み込みました（${matchCount}パターン）` };
}
