"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
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

async function assertAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: s } = await supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  if (s?.global_role !== "executive" && s?.global_role !== "admin") redirect("/dashboard");
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
    .select("staff_id, role, staffs(name, display_name, company_name)")
    .eq("project_id", projectId)
    .order("staff_id");

  const memberList = (members ?? []).map((m) => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null; company_name: string | null } | null;
    return {
      id:          m.staff_id,
      displayName: s?.display_name ?? s?.name ?? m.staff_id,
      companyName: s?.company_name ?? null,
      role:        m.role ?? "staff",
    };
  });

  const spreadsheetId = extractSpreadsheetId(settings.sheet_url);
  await syncMembersSheet(spreadsheetId, memberList);
}

// ── 案件名変更 ──────────────────────────────────────────

export async function updateProjectNameAction(fd: FormData): Promise<SettingsResult> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const name      = String(fd.get("name")      ?? "").trim();
  if (!name) return { success: false, message: "案件名を入力してください" };

  await assertAdmin();
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

  await assertAdmin();
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

  await assertAdmin();

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

  if (!staffId) return { success: false, message: "社員を選択してください" };
  await assertAdmin();

  const { error } = await adminSupa().from("project_members").upsert(
    { project_id: projectId, staff_id: staffId, role, is_main: false },
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
const INITIAL_PASSWORD = "raq-init-2026";

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

  if (!name) return { success: false, message: "氏名は必須です" };

  await assertAdmin();

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
    { project_id: projectId, staff_id: id, role, is_main: true },
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

  type CsvEntry = { name: string; role: string; company_name?: string };
  let entries: CsvEntry[];
  try {
    entries = JSON.parse(csvJson) as CsvEntry[];
  } catch {
    return { success: false, message: "データ形式が不正です", results: [] };
  }

  await assertAdmin();
  const admin = adminSupa();
  const results: { id: string; name: string; ok: boolean; message: string; noCompany?: boolean }[] = [];

  for (const entry of entries) {
    const name = entry.name.trim();
    const role = entry.role || "staff";
    if (!name) { results.push({ id: "", name, ok: false, message: "氏名が空" }); continue; }

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
      await admin.from("project_members").upsert(
        { project_id: projectId, staff_id: id, role, is_main: true },
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
  await assertAdmin();

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
    .select("staff_id, role, staffs(name, display_name, company_name)")
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
    };
  });

  if (memberList.length === 0) return { success: false, message: "メンバーが登録されていません" };

  // シフトパターン一覧を取得（時間帯も含む）
  const { data: patterns } = await supa
    .from("shift_patterns")
    .select("name, required_count, start_time, end_time, target_role")
    .eq("project_id", projectId)
    .order("sort_order");

  const patternList = (patterns ?? []).map((p) => ({
    name:           p.name,
    required_count: p.required_count ?? null,
    start_time:     (p.start_time   ?? null) as string | null,
    end_time:       (p.end_time     ?? null) as string | null,
    target_role:    (p as { target_role?: string }).target_role ?? "all",
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
  await syncHolidaySheet(spreadsheetId, holidays);
  await generateShiftTableSheet(
    spreadsheetId, memberList, patternList, year, month,
    holidays.map(h => ({ staffId: h.staffId, requestDate: h.requestDate })),
    draftAssign,
  );

  return {
    success: true,
    message: `${year}年${month}月のシフト表を生成しました（${memberList.length}名・${patternList.length}パターン・希望休${holidays.length}件${draftAssign ? "・仮組あり" : ""}）`,
  };
}

// ── 希望休ルール保存 ─────────────────────────────────────

export async function saveHolidayRulesAction(fd: FormData): Promise<SettingsResult> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const rulesJson = String(fd.get("rules")     ?? "[]");

  await assertAdmin();

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

  await assertAdmin();

  type PatternInput = {
    name: string;
    short_name: string;
    start_time: string | null;
    end_time: string | null;
    required_count: number | null;
    target_role: string;
    sort_order: number;
  };

  let patterns: PatternInput[];
  try {
    patterns = JSON.parse(patternsJson) as PatternInput[];
  } catch {
    return { success: false, message: "パターンデータが不正です" };
  }

  // 既存を全削除してから再挿入
  const { error: delErr } = await adminSupa()
    .from("shift_patterns")
    .delete()
    .eq("project_id", projectId);
  if (delErr) return { success: false, message: delErr.message };

  if (patterns.length > 0) {
    const { error: insErr } = await adminSupa()
      .from("shift_patterns")
      .insert(patterns.map((p) => ({ ...p, project_id: projectId })));
    if (insErr) return { success: false, message: insErr.message };
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

  await assertAdmin();
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

  await assertAdmin();
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

// ── 案件アーカイブ ───────────────────────────────────────

export async function archiveProjectAction(fd: FormData): Promise<void> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  await assertAdmin();
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

  await assertAdmin();

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

// ── LINEグループ紐付け ────────────────────────────────────

export async function linkLineGroupAction(fd: FormData): Promise<SettingsResult> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const groupId   = String(fd.get("groupId")   ?? "").trim();
  if (!projectId || !groupId) return { success: false, message: "パラメータ不足" };

  await assertAdmin();

  const { error } = await adminSupa()
    .from("line_groups")
    .update({ project_id: projectId })
    .eq("group_id", groupId);

  if (error) return { success: false, message: error.message };
  revalidatePath(`/admin/${projectId}`);
  return { success: true, message: "グループを紐付けました" };
}

export async function unlinkLineGroupAction(fd: FormData): Promise<SettingsResult> {
  const projectId = String(fd.get("projectId") ?? "").trim();
  const groupId   = String(fd.get("groupId")   ?? "").trim();
  if (!projectId || !groupId) return { success: false, message: "パラメータ不足" };

  await assertAdmin();

  const { error } = await adminSupa()
    .from("line_groups")
    .update({ project_id: null })
    .eq("group_id", groupId)
    .eq("project_id", projectId);

  if (error) return { success: false, message: error.message };
  revalidatePath(`/admin/${projectId}`);
  return { success: true, message: "グループの紐付けを解除しました" };
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
        password: "raq-init-2026",
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
