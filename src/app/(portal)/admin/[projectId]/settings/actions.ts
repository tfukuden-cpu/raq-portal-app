"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { pushLine, pushLineTestButton, multicastLine } from "@/lib/line";
import { getAdminLineIds } from "@/lib/notify";
import { redirect } from "next/navigation";
import {
  createSpreadsheet,
  isGSheetsConfigured,
  syncMembersSheet,
  syncShiftPatternsSheet,
  syncHolidayRulesSheet,
  extractSpreadsheetId,
  generateShiftTableSheet,
  syncHolidaySheet,
} from "@/lib/gsheets";
import { getRuleConfig } from "../../holiday-rule-config";
import type { NotificationSettings } from "./notify-config";

function adminSupa() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function assertAdmin(projectId?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: s } = await supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  const isGlobalAdmin = s?.global_role === "executive" || s?.global_role === "admin";
  if (!isGlobalAdmin) {
    // project_admin は自分の担当案件のみ許可
    if (!projectId) redirect("/dashboard");
    const { data: membership } = await supabase
      .from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
    if (membership?.role !== "project_admin") redirect("/dashboard");
  }
  return { supabase, staffId };
}

export type SettingsResult = { success: boolean; message?: string };

/**
 * プロジェクトの現在のメンバー一覧をスプシの「メンバー」シートに同期する
 * メンバー追加・削除・ロール変更のたびに呼ぶ（スプシ未設定の場合は無視）
 */
async function syncProjectMembersToSheet(projectId: string): Promise<void> {
  if (!isGSheetsConfigured()) return;

  const supa = adminSupa();

  // スプシURLを取得
  const { data: settings } = await supa
    .from("project_settings")
    .select("sheet_url")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!settings?.sheet_url) return;

  // 最新のメンバー一覧を取得
  const { data: members } = await supa
    .from("project_members")
    .select("staff_id, role, section, staffs(name, display_name, company_name, account_number)")
    .eq("project_id", projectId)
    .order("staff_id");

  const memberList = (members ?? []).map((m) => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null; company_name: string | null; account_number: string | null } | null;
    return {
      id:            m.staff_id,
      displayName:   s?.display_name ?? s?.name ?? m.staff_id,
      companyName:   s?.company_name ?? null,
      role:          m.role ?? "staff",
      section:       (m.section ?? null) as string | null,
      accountNumber: (s?.account_number ?? null) as string | null,
    };
  });

  const spreadsheetId = extractSpreadsheetId(settings.sheet_url);

  // メンバーシートを同期
  await syncMembersSheet(spreadsheetId, memberList);

  // 当月・翌月のシフト表タブのメンバー行も更新（DBシフトを読み込んで再生成）
  const { data: patterns } = await supa
    .from("shift_patterns")
    .select("name, required_count, start_time, end_time, target_role, section")
    .eq("project_id", projectId)
    .order("sort_order");
  const patternList = (patterns ?? []).map((p) => ({
    name:          p.name,
    required_count: p.required_count ?? null,
    start_time:    (p.start_time  ?? null) as string | null,
    end_time:      (p.end_time    ?? null) as string | null,
    target_role:   (p as { target_role?: string }).target_role ?? "all",
    section:       (p as { section?: string | null }).section ?? null,
  }));
  if (patternList.length === 0) return;

  const { data: holidayData } = await supa
    .from("holiday_requests")
    .select("staff_id, request_date")
    .eq("project_id", projectId)
    .eq("status", "approved");

  const now = new Date();
  // 当月・翌月を対象
  const months = [
    { year: now.getFullYear(), month: now.getMonth() + 1 },
    { year: now.getFullYear(), month: now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2 },
  ];
  if (now.getMonth() + 2 > 12) months[1].year = now.getFullYear() + 1;

  for (const { year, month } of months) {
    const monthStr  = String(month).padStart(2, "0");
    const dateFrom  = `${year}-${monthStr}-01`;
    const dateTo    = `${year}-${monthStr}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;

    // 当該月のDBシフトをpresetShiftsとして渡す
    const { data: shifts } = await supa
      .from("shifts")
      .select("staff_id, shift_date, shift_name")
      .eq("project_id", projectId)
      .gte("shift_date", dateFrom)
      .lte("shift_date", dateTo);

    const presetShifts = new Map<string, Map<string, string>>();
    for (const s of (shifts ?? [])) {
      if (!s.shift_name) continue;
      if (!presetShifts.has(s.staff_id)) presetShifts.set(s.staff_id, new Map());
      presetShifts.get(s.staff_id)!.set(s.shift_date, s.shift_name);
    }

    const holidays = (holidayData ?? [])
      .filter(h => h.request_date >= dateFrom && h.request_date <= dateTo)
      .map(h => ({ staffId: h.staff_id, requestDate: h.request_date as string }));

    try {
      await generateShiftTableSheet(
        spreadsheetId, memberList, patternList, year, month,
        holidays, false, presetShifts,
      );
    } catch { /* 月別シートがなければスキップ */ }
  }
}

// ── 案件名変更 ──────────────────────────────────────────

export async function updateProjectNameAction(fd: FormData): Promise<SettingsResult> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const name      = String(fd.get("name")      ?? "").trim();
  if (!name) return { success: false, message: "案件名を入力してください" };

  await assertAdmin(projectId);
  const { error } = await adminSupa().from("projects").update({ name }).eq("id", projectId);
  if (error) return { success: false, message: error.message };

  revalidatePath(`/admin/${projectId}`);
  revalidatePath("/admin");
  return { success: true };
}

// ── スプシURL保存 ────────────────────────────────────────

export async function saveSheetUrlAction(fd: FormData): Promise<SettingsResult> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const sheetUrl  = String(fd.get("sheetUrl")  ?? "").trim();

  await assertAdmin(projectId);
  const { error } = await adminSupa()
    .from("project_settings")
    .upsert({ project_id: projectId, sheet_url: sheetUrl, updated_at: new Date().toISOString() },
             { onConflict: "project_id" });
  if (error) return { success: false, message: error.message };

  // URL設定時に既存メンバーをメンバーシートへ同期
  try { await syncProjectMembersToSheet(projectId); } catch { /* ignore */ }

  revalidatePath(`/admin/${projectId}`);
  return { success: true };
}

// ── スプシ自動作成 ───────────────────────────────────────

export async function createSpreadsheetAction(fd: FormData): Promise<SettingsResult & { url?: string }> {
  if (!isGSheetsConfigured()) {
    return { success: false, message: "GOOGLE_SERVICE_ACCOUNT_JSON が未設定です" };
  }

  const projectId   = String(fd.get("projectId")   ?? "").trim();
  const projectName = String(fd.get("projectName") ?? "").trim();

  await assertAdmin(projectId);

  let url: string;
  try {
    url = await createSpreadsheet(projectName);
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }

  const { error } = await adminSupa()
    .from("project_settings")
    .upsert({ project_id: projectId, sheet_url: url, updated_at: new Date().toISOString() },
             { onConflict: "project_id" });
  if (error) return { success: false, message: error.message };

  // スプシ作成時に既存メンバーをメンバーシートへ同期
  try { await syncProjectMembersToSheet(projectId); } catch { /* ignore */ }

  revalidatePath(`/admin/${projectId}`);
  return { success: true, url };
}

// ── メンバー追加 ─────────────────────────────────────────

export async function addMemberAction(fd: FormData): Promise<SettingsResult> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const staffId   = String(fd.get("staffId")   ?? "").trim().toUpperCase();
  const role      = String(fd.get("role")       ?? "staff");
  const startDate = String(fd.get("start_date") ?? "").trim() || null;

  if (!staffId) return { success: false, message: "社員を選択してください" };
  await assertAdmin(projectId);

  const { error } = await adminSupa().from("project_members").upsert(
    { project_id: projectId, staff_id: staffId, role, is_main: false, start_date: startDate },
    { onConflict: "project_id,staff_id" }
  );
  if (error) return { success: false, message: error.message };

  // スプシのメンバーシートを同期（エラーは無視して続行）
  try { await syncProjectMembersToSheet(projectId); } catch { /* ignore */ }

  revalidatePath(`/admin/${projectId}`);
  return { success: true };
}

// ── 新規スタッフ作成 ＋ 案件紐付け ──────────────────────────

const EMAIL_DOMAIN = "raq.internal";
const INITIAL_PASSWORD = "1234";

/** S001, S002, ... の形式で次の空き社員IDを自動採番する */
async function getNextStaffId(): Promise<string> {
  const { data } = await adminSupa().from("staffs").select("id");
  const nums = (data ?? [])
    .map(r => r.id.match(/^S(\d+)$/))
    .filter(Boolean)
    .map(m => parseInt(m![1], 10));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 2;
  return `S${String(next).padStart(3, "0")}`;
}

export async function createAndAddStaffAction(fd: FormData): Promise<SettingsResult> {
  const projectId   = String(fd.get("projectId")    ?? "").trim();
  const name        = String(fd.get("name")          ?? "").trim();
  const displayName = String(fd.get("display_name")  ?? "").trim() || name;
  const companyName = String(fd.get("company_name")  ?? "").trim() || null;
  const role        = String(fd.get("role")          ?? "staff");
  const section     = String(fd.get("section")       ?? "").trim() || null;
  const startDate   = String(fd.get("start_date")    ?? "").trim() || null;

  if (!name) return { success: false, message: "氏名は必須です" };

  await assertAdmin(projectId);

  // 同名スタッフが既に存在する場合はエラー
  const { data: existing } = await adminSupa()
    .from("staffs")
    .select("id, name")
    .or(`name.eq.${name},display_name.eq.${name}`)
    .maybeSingle();
  if (existing) return { success: false, message: `「${name}」は既に登録済みです（${existing.id}）` };

  // IDを自動採番
  const id = await getNextStaffId();
  const admin = adminSupa();
  const email = `${id.toLowerCase()}@${EMAIL_DOMAIN}`;

  // Auth ユーザー作成
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: INITIAL_PASSWORD,
    email_confirm: true,
    user_metadata: { staff_id: id, name },
  });

  if (authErr) {
    if (authErr.message?.includes("already")) return { success: false, message: `${id} は既に登録済みです` };
    return { success: false, message: authErr.message };
  }

  // staffs テーブルに登録
  const { error: staffErr } = await admin.from("staffs").upsert({
    id,
    auth_user_id: authData.user.id,
    name,
    display_name: displayName,
    company_name: companyName,
    global_role: "staff",
    must_change_password: true,
    is_active: true,
  }, { onConflict: "id" });
  if (staffErr) return { success: false, message: staffErr.message };

  // 案件メンバーとして紐付け
  const { error: memErr } = await admin.from("project_members").upsert(
    { project_id: projectId, staff_id: id, role, section, is_main: true, start_date: startDate },
    { onConflict: "project_id,staff_id" }
  );
  if (memErr) return { success: false, message: memErr.message };

  // スプシのメンバーシートを同期（エラーは無視して続行）
  try { await syncProjectMembersToSheet(projectId); } catch { /* ignore */ }

  revalidatePath(`/admin/${projectId}`);
  return { success: true, message: `${displayName}（${id}）を登録しました` };
}

export async function bulkCreateAndAddStaffsAction(fd: FormData): Promise<{
  success: boolean;
  message: string;
  results: { id: string; name: string; ok: boolean; message: string; noCompany?: boolean }[];
}> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const csvJson   = String(fd.get("csv")       ?? "");
  if (!csvJson) return { success: false, message: "データがありません", results: [] };

  type CsvEntry = { name: string; role: string; company_name?: string; section?: string };
  let entries: CsvEntry[];
  try {
    entries = JSON.parse(csvJson) as CsvEntry[];
  } catch {
    return { success: false, message: "データ形式が不正です", results: [] };
  }

  await assertAdmin(projectId);
  const admin = adminSupa();
  const results: { id: string; name: string; ok: boolean; message: string; noCompany?: boolean }[] = [];

  // 当該案件の既存メンバー名一覧を取得（重複スキップ用）
  const { data: existingMembers } = await admin
    .from("project_members")
    .select("staffs(name, display_name)")
    .eq("project_id", projectId);
  const existingNames = new Set(
    (existingMembers ?? []).flatMap((m) => {
      const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
        { name: string | null; display_name: string | null } | null;
      return [s?.name, s?.display_name].filter((n): n is string => !!n);
    })
  );

  for (const entry of entries) {
    const name = entry.name.trim();
    const role = entry.role || "staff";
    if (!name) { results.push({ id: "", name, ok: false, message: "氏名が空" }); continue; }

    // 当該案件に同名メンバーがいればスキップ
    if (existingNames.has(name)) {
      results.push({ id: "", name, ok: false, message: "既存メンバーのためスキップ" });
      continue;
    }

    try {
      // ID自動採番
      const id          = await getNextStaffId();
      const email       = `${id.toLowerCase()}@${EMAIL_DOMAIN}`;
      const companyName = entry.company_name?.trim() || null;

      const { data: authData, error: authErr } = await admin.auth.admin.createUser({
        email, password: INITIAL_PASSWORD, email_confirm: true,
        user_metadata: { staff_id: id, name },
      });
      if (authErr) { results.push({ id, name, ok: false, message: authErr.message }); continue; }

      await admin.from("staffs").upsert(
        { id, auth_user_id: authData.user.id, name, display_name: name, company_name: companyName, global_role: "staff", must_change_password: true, is_active: true },
        { onConflict: "id" }
      );
      const section = entry.section?.trim() || null;
      await admin.from("project_members").upsert(
        { project_id: projectId, staff_id: id, role, section, is_main: true },
        { onConflict: "project_id,staff_id" }
      );
      results.push({ id, name, ok: true, message: `${id} で登録`, noCompany: !companyName });
    } catch (e: unknown) {
      results.push({ id: "", name, ok: false, message: e instanceof Error ? e.message : "不明なエラー" });
    }
  }

  // スプシのメンバーシートを同期（エラーは無視して続行）
  try { await syncProjectMembersToSheet(projectId); } catch { /* ignore */ }

  revalidatePath(`/admin/${projectId}`);
  const okCount = results.filter(r => r.ok).length;
  return { success: true, message: `${okCount}/${results.length}件 登録完了`, results };
}

// ── シフト表生成 ─────────────────────────────────────────

export async function generateShiftTableAction(fd: FormData): Promise<SettingsResult> {
  const projectId  = String(fd.get("projectId")  ?? "").trim();
  const year       = Number(fd.get("year")  ?? 0);
  const month      = Number(fd.get("month") ?? 0);
  const draftAssign = fd.get("draftAssign") === "true";

  if (!year || !month) return { success: false, message: "年月を指定してください" };
  await assertAdmin(projectId);

  if (!isGSheetsConfigured()) return { success: false, message: "Google Sheetsが未設定です" };

  const supa = adminSupa();

  // スプシURLを取得
  const { data: settings } = await supa
    .from("project_settings").select("sheet_url")
    .eq("project_id", projectId).maybeSingle();
  if (!settings?.sheet_url) return { success: false, message: "スプレッドシートが設定されていません" };

  // メンバー一覧を取得（会社名も含む）
  const { data: members } = await supa
    .from("project_members")
    .select("staff_id, role, section, staffs(name, display_name, company_name)")
    .eq("project_id", projectId)
    .order("staff_id");

  const memberList = (members ?? []).map((m) => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null; company_name: string | null } | null;
    return {
      id:          m.staff_id,
      displayName: s?.display_name?.trim() || s?.name?.trim() || m.staff_id,
      companyName: s?.company_name?.trim() || null,
      role:        (m.role ?? "staff") as string,
      section:     (m.section ?? null) as string | null,
    };
  });

  if (memberList.length === 0) return { success: false, message: "メンバーが登録されていません" };

  // シフトパターン一覧を取得（時間帯も含む）
  const { data: patterns } = await supa
    .from("shift_patterns")
    .select("name, required_count, start_time, end_time, target_role, section")
    .eq("project_id", projectId)
    .order("sort_order");

  const patternList = (patterns ?? []).map((p) => ({
    name:           p.name,
    required_count: p.required_count ?? null,
    start_time:     (p.start_time   ?? null) as string | null,
    end_time:       (p.end_time     ?? null) as string | null,
    target_role:    (p as { target_role?: string }).target_role ?? "all",
    section:        (p as { section?: string | null }).section ?? null,
  }));
  if (patternList.length === 0) return { success: false, message: "シフトパターンが登録されていません" };

  // 対象月の希望休を取得（JOINなし・シンプルに）
  const monthStr = String(month).padStart(2, "0");
  const lastDay  = new Date(year, month, 0).getDate();
  const dateFrom = `${year}-${monthStr}-01`;
  const dateTo   = `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}`;
  const { data: holidayData } = await supa
    .from("holiday_requests")
    .select("staff_id, request_date, note")
    .eq("project_id", projectId)
    .gte("request_date", dateFrom)
    .lte("request_date", dateTo)
    .order("request_date");

  // 名前は取得済みの memberList から引く
  const staffNameMap = new Map(memberList.map((m) => [m.id, m.displayName]));
  const holidays = (holidayData ?? []).map((h) => ({
    staffId:     h.staff_id,
    staffName:   staffNameMap.get(h.staff_id) || h.staff_id,
    requestDate: h.request_date as string,
    note:        h.note as string | null,
  }));

  // 希望休シート同期 ＆ シフト表生成
  const spreadsheetId = extractSpreadsheetId(settings.sheet_url);
  try {
    await syncHolidaySheet(spreadsheetId, holidays);
    await generateShiftTableSheet(
      spreadsheetId, memberList, patternList, year, month,
      holidays.map(h => ({ staffId: h.staffId, requestDate: h.requestDate })),
      draftAssign,
    );
  } catch (e) {
    return { success: false, message: (e instanceof Error ? e.message : "シート生成中にエラーが発生しました") };
  }

  return {
    success: true,
    message: `${year}年${month}月のシフト表を生成しました（${memberList.length}名・${patternList.length}パターン・希望休${holidays.length}件${draftAssign ? "・仮組あり" : ""}）`,
  };
}

// ── 希望休ルール保存 ─────────────────────────────────────

export async function saveHolidayRulesAction(fd: FormData): Promise<SettingsResult> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const rulesJson = String(fd.get("rules")     ?? "[]");

  await assertAdmin(projectId);

  type RuleInput = { rule_type: string; value: string };
  let rules: RuleInput[];
  try {
    rules = JSON.parse(rulesJson) as RuleInput[];
  } catch {
    return { success: false, message: "ルールデータが不正です" };
  }

  // 既存ルールを全削除してから再挿入
  const { error: delErr } = await adminSupa()
    .from("holiday_rules")
    .delete()
    .eq("project_id", projectId);
  if (delErr) return { success: false, message: delErr.message };

  if (rules.length > 0) {
    const { error: insErr } = await adminSupa()
      .from("holiday_rules")
      .insert(
        rules
          .filter((r) => r.rule_type && r.value !== "")
          .map((r, i) => ({
            project_id: projectId,
            rule_type:  r.rule_type,
            value:      Number(r.value),
            sort_order: i,
          }))
      );
    if (insErr) return { success: false, message: insErr.message };
  }

  // スプシの希望休ルールシートを同期（エラーは無視して続行）
  if (isGSheetsConfigured()) {
    try {
      const { data: settings } = await adminSupa()
        .from("project_settings").select("sheet_url").eq("project_id", projectId).maybeSingle();
      if (settings?.sheet_url) {
        const ruleRows = rules
          .filter(r => r.rule_type && r.value !== "")
          .map(r => {
            const cfg = getRuleConfig(r.rule_type);
            return {
              rule_type: r.rule_type,
              label:     cfg?.label ?? r.rule_type,
              value:     Number(r.value),
              unit:      cfg?.unit ?? "日",
            };
          });
        await syncHolidayRulesSheet(extractSpreadsheetId(settings.sheet_url), ruleRows);
      }
    } catch { /* ignore */ }
  }

  revalidatePath(`/admin/${projectId}`);
  return { success: true, message: "保存しました" };
}

// ── シフトパターン保存（全件置き換え） ─────────────────────

export async function saveShiftPatternsAction(fd: FormData): Promise<SettingsResult> {
  const projectId    = String(fd.get("projectId")  ?? "").trim();
  const patternsJson = String(fd.get("patterns")   ?? "[]");

  await assertAdmin(projectId);

  type PatternInput = {
    name: string;
    short_name: string;
    start_time: string | null;
    end_time: string | null;
    required_count: number | null;
    required_weekday: number | null;
    required_weekend: number | null;
    section: string | null;
    target_role: string;
    sort_order: number;
  };

  let patterns: PatternInput[];
  try {
    patterns = JSON.parse(patternsJson) as PatternInput[];
  } catch {
    return { success: false, message: "パターンデータが不正です" };
  }

  // 削除されるセクション名を特定（保存前の既存パターンと比較）
  const admin = adminSupa();
  const { data: oldPatterns } = await admin
    .from("shift_patterns")
    .select("section")
    .eq("project_id", projectId);
  const oldSections = new Set((oldPatterns ?? []).map(p => p.section as string | null).filter(Boolean) as string[]);
  const newSections = new Set(patterns.map(p => p.section).filter(Boolean) as string[]);
  const removedSections = [...oldSections].filter(s => !newSections.has(s));

  // 既存を全削除してから再挿入
  const { error: delErr } = await admin
    .from("shift_patterns")
    .delete()
    .eq("project_id", projectId);
  if (delErr) return { success: false, message: delErr.message };

  if (patterns.length > 0) {
    const { error: insErr } = await admin
      .from("shift_patterns")
      .insert(patterns.map((p) => ({ ...p, project_id: projectId })));
    if (insErr) return { success: false, message: insErr.message };
  }

  // 削除されたセクションをメンバーの sections / section から除去
  if (removedSections.length > 0) {
    const { data: memberRows } = await admin
      .from("project_members")
      .select("staff_id, section, sections")
      .eq("project_id", projectId);

    for (const m of memberRows ?? []) {
      const curSections = (m.sections as string[] | null) ?? [];
      const updSections = curSections.filter(s => !removedSections.includes(s));
      const curSection  = m.section as string | null;
      const updSection  = curSection && removedSections.includes(curSection)
        ? (updSections[0] ?? null)
        : curSection;
      if (updSections.length !== curSections.length || updSection !== curSection) {
        await admin.from("project_members")
          .update({ sections: updSections, section: updSection })
          .eq("project_id", projectId)
          .eq("staff_id", m.staff_id);
      }
    }
  }

  // スプシのシフトパターンシートを同期（エラーは無視して続行）
  if (isGSheetsConfigured()) {
    try {
      const { data: settings } = await adminSupa()
        .from("project_settings").select("sheet_url").eq("project_id", projectId).maybeSingle();
      if (settings?.sheet_url) {
        await syncShiftPatternsSheet(extractSpreadsheetId(settings.sheet_url), patterns);
      }
    } catch { /* ignore */ }
  }

  revalidatePath(`/admin/${projectId}`);
  return { success: true, message: `${patterns.length}件を保存しました` };
}

// ── メンバー削除 ─────────────────────────────────────────

export async function removeMemberAction(fd: FormData): Promise<SettingsResult> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const staffId   = String(fd.get("staffId")   ?? "").trim().toUpperCase();

  await assertAdmin(projectId);
  const { error } = await adminSupa()
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("staff_id", staffId);
  if (error) return { success: false, message: error.message };

  // スプシのメンバーシートを同期（エラーは無視して続行）
  try { await syncProjectMembersToSheet(projectId); } catch { /* ignore */ }

  revalidatePath(`/admin/${projectId}`);
  return { success: true };
}

// ── 役割変更 ─────────────────────────────────────────────

export async function updateMemberRoleAction(fd: FormData): Promise<SettingsResult> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const staffId   = String(fd.get("staffId")   ?? "").trim().toUpperCase();
  const role      = String(fd.get("role")       ?? "staff");

  await assertAdmin(projectId);
  const { error } = await adminSupa()
    .from("project_members")
    .update({ role })
    .eq("project_id", projectId)
    .eq("staff_id", staffId);
  if (error) return { success: false, message: error.message };

  // スプシのメンバーシートを同期（エラーは無視して続行）
  try { await syncProjectMembersToSheet(projectId); } catch { /* ignore */ }

  revalidatePath(`/admin/${projectId}`);
  return { success: true };
}

/**
 * メンバー情報を更新（氏名・会社・セクション・ロール）してスプシに同期
 */
export async function updateMemberInfoAction(fd: FormData): Promise<SettingsResult> {
  const projectId     = String(fd.get("projectId")      ?? "").trim();
  const staffId       = String(fd.get("staffId")        ?? "").trim().toUpperCase();
  const name          = String(fd.get("name")           ?? "").trim();
  const companyName   = String(fd.get("company_name")   ?? "").trim() || null;
  const section       = String(fd.get("section")        ?? "").trim() || null;
  const role          = String(fd.get("role")           ?? "staff");
  const accountNumber = String(fd.get("account_number") ?? "").trim() || null;
  const workDaysTypeRaw = String(fd.get("work_days_type") ?? "").trim();
  const workDaysType  = (workDaysTypeRaw === "monthly" || workDaysTypeRaw === "weekly") ? workDaysTypeRaw : null;
  const workDaysCountRaw = String(fd.get("work_days_count") ?? "").trim();
  const workDaysCount = workDaysCountRaw && workDaysType ? (parseInt(workDaysCountRaw, 10) || null) : null;
  const sectionsRaw   = String(fd.get("sections") ?? "");
  const sections      = sectionsRaw ? sectionsRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
  const preferredShift   = String(fd.get("preferred_shift")   ?? "").trim() || null;
  const preferredSection = String(fd.get("preferred_section") ?? "").trim() || null;
  const maxConsecRaw     = String(fd.get("max_consecutive_days") ?? "").trim();
  const maxConsecDays    = maxConsecRaw ? (parseInt(maxConsecRaw, 10) || null) : null;
  const startDate        = String(fd.get("start_date") ?? "").trim() || null;
  const desiredWageRaw   = String(fd.get("desired_wage") ?? "").trim();
  const desiredWage      = desiredWageRaw ? (parseInt(desiredWageRaw, 10) || null) : null;
  const churnRisk        = fd.get("churn_risk") === "true";

  if (!name) return { success: false, message: "氏名を入力してください" };

  await assertAdmin(projectId);
  const admin = adminSupa();

  // churn_risk_since: ON のとき既存値があれば保持、新規に ON にするなら今日、OFF なら null
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const { data: curPm } = await admin.from("project_members")
    .select("churn_risk, churn_risk_since").eq("project_id", projectId).eq("staff_id", staffId).maybeSingle();
  const churnRiskSince: string | null = churnRisk
    ? (curPm?.churn_risk ? (curPm.churn_risk_since ?? today) : today)
    : null;

  // staffs テーブル更新（氏名・会社名・アカウント番号）
  const { error: staffErr } = await admin
    .from("staffs")
    .update({ name, display_name: name, company_name: companyName, account_number: accountNumber })
    .eq("id", staffId);
  if (staffErr) return { success: false, message: staffErr.message };

  // project_members テーブル更新（ロール・セクション・稼働日数・優先パターン・連勤上限・アサイン日）
  const primarySection = sections[0] ?? null;
  const { error: memberErr } = await admin
    .from("project_members")
    .update({
      role, section: primarySection, sections,
      work_days_type: workDaysType, work_days_count: workDaysCount,
      preferred_shift: preferredShift, preferred_section: preferredSection,
      max_consecutive_days: maxConsecDays,
      start_date: startDate,
      desired_wage: desiredWage,
      churn_risk: churnRisk,
      churn_risk_since: churnRiskSince,
    })
    .eq("project_id", projectId)
    .eq("staff_id", staffId);
  if (memberErr) return { success: false, message: memberErr.message };

  // スプシのメンバーシートを同期
  try { await syncProjectMembersToSheet(projectId); } catch { /* ignore */ }

  revalidatePath(`/admin/${projectId}`);
  return { success: true, message: "更新しました" };
}

// ── シフト設定のみ更新（シフト編集モードパネル用） ─────────────────

export async function updateShiftSettingsAction(
  projectId: string,
  staffId:   string,
  params: {
    sections:           string[];
    workDaysType:       string;
    workDaysCount:      number | null;
    preferredShift:     string | null;
    preferredSection:   string | null;
    maxConsecDays:      number | null;
    shiftNote:          string | null;
  },
): Promise<{ success: boolean; message?: string }> {
  await assertAdmin(projectId);

  const { error } = await adminSupa()
    .from("project_members")
    .update({
      section:              params.sections[0] ?? null,
      sections:             params.sections,
      work_days_type:       params.workDaysType || null,
      work_days_count:      params.workDaysCount,
      preferred_shift:      params.preferredShift || null,
      preferred_section:    params.preferredSection || null,
      max_consecutive_days: params.maxConsecDays,
      shift_note:           params.shiftNote || null,
    })
    .eq("project_id", projectId)
    .eq("staff_id",   staffId);

  if (error) return { success: false, message: error.message };

  revalidatePath(`/admin/${projectId}`);
  revalidatePath("/shifts/manage");
  revalidatePath("/members");
  return { success: true };
}

// ── 案件アーカイブ ───────────────────────────────────────

export async function archiveProjectAction(fd: FormData): Promise<void> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  await assertAdmin(projectId);
  await adminSupa().from("projects").update({ is_active: false }).eq("id", projectId);
  revalidatePath("/admin");
  redirect("/admin");
}

// ── LINE通知設定保存 ──────────────────────────────────────

// 型・デフォルト値は notify-config.ts に集約（"use server" 制約を避けるため）
export type { NotifyItemConfig, NotificationSettings } from "./notify-config";

export async function saveLineSettingsAction(fd: FormData): Promise<SettingsResult> {
  const projectId    = String(fd.get("projectId")  ?? "").trim();
  const settingsJson = String(fd.get("settings")   ?? "{}");

  await assertAdmin(projectId);

  let settings: NotificationSettings;
  try {
    settings = JSON.parse(settingsJson) as NotificationSettings;
  } catch {
    return { success: false, message: "設定データが不正です" };
  }

  const { error } = await adminSupa()
    .from("project_settings")
    .upsert(
      {
        project_id:            projectId,
        notification_settings: settings,
        updated_at:            new Date().toISOString(),
      },
      { onConflict: "project_id" }
    );
  if (error) return { success: false, message: error.message };

  revalidatePath(`/admin/${projectId}`);
  return { success: true, message: "保存しました" };
}

// ── LINEグループID保存 ───────────────────────────────────

// ── 出発報告ON/OFF保存 ──────────────────────────────────────

export async function saveDepartureSettingAction(fd: FormData): Promise<SettingsResult> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const enabled   = fd.get("enabled") === "true";
  if (!projectId) return { success: false, message: "パラメータ不足" };

  await assertAdmin(projectId);

  const { error } = await adminSupa()
    .from("project_settings")
    .upsert(
      { project_id: projectId, enable_departure_report: enabled, updated_at: new Date().toISOString() },
      { onConflict: "project_id" }
    );

  if (error) return { success: false, message: error.message };
  revalidatePath(`/admin/${projectId}`);
  return { success: true, message: enabled ? "出発報告をONにしました" : "出発報告をOFFにしました" };
}

// ── LINEグループID保存 ───────────────────────────────────
export async function saveLineGroupAction(fd: FormData): Promise<SettingsResult> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const groupId   = String(fd.get("groupId")   ?? "").trim();
  if (!projectId) return { success: false, message: "パラメータ不足" };

  await assertAdmin(projectId);

  const { error } = await adminSupa()
    .from("project_settings")
    .upsert(
      { project_id: projectId, line_group_id: groupId || null, updated_at: new Date().toISOString() },
      { onConflict: "project_id" }
    );

  if (error) return { success: false, message: error.message };
  revalidatePath(`/admin/${projectId}`);
  return { success: true, message: groupId ? "グループを設定しました" : "グループ連携を解除しました" };
}

// ── 新規案件作成 ─────────────────────────────────────────

export async function createProjectAction(fd: FormData): Promise<SettingsResult & { projectId?: string }> {
  const name        = String(fd.get("name")        ?? "").trim();
  const managerName = String(fd.get("managerName") ?? "").trim();
  if (!name) return { success: false, message: "案件名は必須です" };

  await assertAdmin();

  // 既存の P + 数字 形式のIDから最大番号を取得して採番
  const { data: existing } = await adminSupa().from("projects").select("id");
  const maxNum = (existing ?? []).reduce((max, p) => {
    const m = p.id.match(/^P(\d+)$/);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);
  const id = `P${String(maxNum + 1).padStart(3, "0")}`;

  const { error } = await adminSupa().from("projects").insert({ id, name, is_active: true });
  if (error) return { success: false, message: error.message };

  // 管理者アカウントを作成
  if (managerName) {
    try {
      // ID生成: A + 案件名頭文字(大文字) + 3桁連番
      const prefix = `A${name.charAt(0).toUpperCase()}`;
      const { data: existingAdmins } = await adminSupa()
        .from("staffs").select("id").like("id", `${prefix}%`).eq("global_role", "admin");
      const maxNum = (existingAdmins ?? []).reduce((max, s) => {
        const m = s.id.match(new RegExp(`^${prefix}(\\d+)$`));
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      const managerId = `${prefix}${String(maxNum + 1).padStart(3, "0")}`;
      const managerEmail = `${managerId.toLowerCase()}@raq.internal`;

      const { data: authData, error: authErr } = await adminSupa().auth.admin.createUser({
        email: managerEmail,
        password: INITIAL_PASSWORD,
        email_confirm: true,
      });
      if (!authErr && authData.user) {
        await adminSupa().from("staffs").insert({
          id: managerId,
          auth_user_id: authData.user.id,
          name: managerName,
          display_name: managerName,
          global_role: "admin",
          must_change_password: true,
          is_active: true,
        });
        await adminSupa().from("project_members").insert({
          staff_id: managerId,
          project_id: id,
          role: "project_admin",
          is_main: true,
        });
        // スプシURLが既に設定されていればメンバーシートを同期
        try { await syncProjectMembersToSheet(id); } catch { /* ignore */ }
      }
    } catch {
      // 管理者作成失敗は無視して続行（案件は作成済み）
    }
  }

  revalidatePath("/admin");
  return { success: true, projectId: id };
}

export async function departStaffAction(
  projectId: string,
  staffId: string,
  departDate: string,
): Promise<SettingsResult> {
  await assertAdmin(projectId);
  const admin = adminSupa();

  const { error: memberErr } = await admin
    .from("project_members")
    .update({ end_date: departDate })
    .eq("project_id", projectId)
    .eq("staff_id", staffId);

  if (memberErr) return { success: false, message: memberErr.message };

  const { error: shiftErr } = await admin
    .from("shifts")
    .delete()
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .gt("shift_date", departDate);

  if (shiftErr) return { success: false, message: shiftErr.message };

  revalidatePath(`/admin/${projectId}`);
  revalidatePath(`/shifts/manage`);
  return { success: true };
}

// ── LINE連携解除 ───────────────────────────────────────────

export async function unlinkLineAction(fd: FormData): Promise<SettingsResult> {
  const staffId   = String(fd.get("staffId")   ?? "").trim().toUpperCase();
  const projectId = String(fd.get("projectId") ?? "").trim();
  if (!staffId) return { success: false, message: "staffIdが必要です" };

  await assertAdmin(projectId);
  const { error } = await adminSupa()
    .from("staffs")
    .update({ line_user_id: null })
    .eq("id", staffId);

  if (error) return { success: false, message: error.message };
  revalidatePath(`/admin/[projectId]`, "page");
  return { success: true };
}

// ── LINEテスト通知 ─────────────────────────────────────────

export async function sendLineTestAction(
  fd: FormData,
): Promise<SettingsResult & { failedStaffIds?: string[] }> {
  const staffId   = String(fd.get("staffId")   ?? "").trim() || null;
  const projectId = String(fd.get("projectId") ?? "").trim();

  await assertAdmin(projectId);
  const admin = adminSupa();

  if (staffId) {
    // 個別送信
    const { data: staff } = await admin
      .from("staffs")
      .select("line_user_id, display_name, name")
      .eq("id", staffId)
      .maybeSingle();
    if (!staff?.line_user_id) return { success: false, message: "LINE未連携のスタッフです" };
    const name = staff.display_name ?? staff.name ?? staffId;
    const ok = await pushLineTestButton(staff.line_user_id, name, projectId);
    return ok
      ? { success: true,  message: `${name} に送信しました` }
      : { success: false, message: `${name} への送信に失敗しました（ブロックされている可能性）`, failedStaffIds: [staffId] };
  } else {
    // 全員一括送信
    const { data: members } = await admin
      .from("project_members")
      .select("staff_id, staffs(line_user_id, display_name, name)")
      .eq("project_id", projectId);

    const targets = (members ?? [])
      .map(m => {
        const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
          { line_user_id: string | null; display_name: string | null; name: string | null } | null;
        return {
          staffId: m.staff_id as string,
          lineId:  s?.line_user_id,
          name:    s?.display_name ?? s?.name ?? (m.staff_id as string),
        };
      })
      .filter((t): t is { staffId: string; lineId: string; name: string } => !!t.lineId);

    if (targets.length === 0) return { success: false, message: "LINE連携済みスタッフがいません" };

    const results = await Promise.all(
      targets.map(async t => ({
        staffId: t.staffId,
        ok: await pushLineTestButton(t.lineId, t.name, projectId),
      }))
    );
    const failedStaffIds = results.filter(r => !r.ok).map(r => r.staffId);
    const sentCount      = results.filter(r =>  r.ok).length;

    return {
      success: true,
      message: failedStaffIds.length > 0
        ? `${sentCount}名に送信（${failedStaffIds.length}名失敗）`
        : `${sentCount}名に送信しました`,
      failedStaffIds,
    };
  }
}

// ── LINE確認状況取得 ──────────────────────────────────────────

export async function fetchLineTestConfirmationsAction(
  projectId: string,
): Promise<{ staffId: string; confirmedAt: string }[]> {
  await assertAdmin(projectId);
  const { data } = await adminSupa()
    .from("line_test_confirmations")
    .select("staff_id, confirmed_at")
    .eq("project_id", projectId);
  return (data ?? []).map(r => ({ staffId: r.staff_id, confirmedAt: r.confirmed_at as string }));
}

// ── LINE確認記録クリア ────────────────────────────────────────

export async function clearLineTestConfirmationsAction(projectId: string): Promise<SettingsResult> {
  await assertAdmin(projectId);
  const { error } = await adminSupa()
    .from("line_test_confirmations")
    .delete()
    .eq("project_id", projectId);
  if (error) return { success: false, message: error.message };
  return { success: true };
}

// ── 通知テスト送信 ────────────────────────────────────────────

/**
 * 指定メッセージを管理者グループ（LINE グループ + 管理者個人）へテスト送信
 */
export async function testNotifyAction(
  projectId: string,
  message: string,
): Promise<SettingsResult> {
  await assertAdmin(projectId);

  // LINE グループ ID 取得
  const { data: ps } = await adminSupa()
    .from("project_settings")
    .select("line_group_id")
    .eq("project_id", projectId)
    .maybeSingle();
  const groupId = (ps?.line_group_id as string | null) ?? null;

  // 管理者個人の LINE ID
  const adminIds = await getAdminLineIds(projectId);

  if (!groupId && adminIds.length === 0) {
    return { success: false, message: "管理者グループ・管理者のLINEがどちらも未設定です" };
  }

  const prefix   = "【テスト通知】\n";
  const fullText = prefix + message;

  const sends: Promise<void>[] = [];
  if (groupId)          sends.push(pushLine(groupId, fullText));
  if (adminIds.length)  sends.push(multicastLine(adminIds, fullText));

  await Promise.allSettled(sends);
  return { success: true, message: "テスト送信しました" };
}

/**
 * 自分自身（現在ログイン中の管理者）に直接 push テスト送信
 * 結果に診断情報を含めて返す
 */
export async function testLinePushToSelfAction(
  projectId: string,
): Promise<{ success: boolean; message: string; detail?: string }> {
  await assertAdmin(projectId);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "未認証" };
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  // 自分の line_user_id を取得
  const { data: staff } = await adminSupa()
    .from("staffs")
    .select("display_name, name, line_user_id")
    .eq("id", staffId)
    .maybeSingle();

  if (!staff?.line_user_id) {
    return {
      success: false,
      message: "あなたの LINE が未連携です",
      detail: "マイページ → LINE連携 から連携してください",
    };
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return {
      success: false,
      message: "LINE_CHANNEL_ACCESS_TOKEN が未設定",
      detail: "Vercel の環境変数に LINE_CHANNEL_ACCESS_TOKEN を追加してください",
    };
  }

  const name = staff.display_name ?? staff.name ?? staffId;
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: staff.line_user_id,
      messages: [{ type: "text", text: `【疎通テスト】\n${name}さん、LINE通知が正常に届いています ✓` }],
    }),
  });

  if (res.ok) {
    return { success: true, message: `${name}さんに送信しました。LINEを確認してください。` };
  }

  const body = await res.text().catch(() => "");
  let detail = `LINE API: ${res.status} ${res.statusText}`;
  if (res.status === 401) detail = "トークンが無効です。LINE Developersでトークンを再発行してください";
  if (res.status === 400 && body.includes("not in the channelId")) {
    detail = "チャンネルが違います。LINEログインとMessaging APIが別プロバイダーになっていないか確認してください";
  }
  console.error(`[LINE] testLinePushToSelfAction: ${res.status} — ${body}`);
  return { success: false, message: `送信失敗 (${res.status})`, detail };
}
