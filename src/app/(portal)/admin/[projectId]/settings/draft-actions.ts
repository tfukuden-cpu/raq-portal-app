"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type SlotReqRow = {
  pattern_name: string;
  shift_date: string;
  required_count: number;
};

export type FetchSlotReqsResult = {
  success: boolean;
  message?: string;
  slotRequirements?: SlotReqRow[];
};

/** 指定月の shift_slot_requirements を取得 */
export async function fetchSlotRequirementsForMonthAction(
  projectId: string,
  year: number,
  month: number,
): Promise<FetchSlotReqsResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const pad = (n: number) => String(n).padStart(2, "0");
  const dateFrom = `${year}-${pad(month)}-01`;
  const lastDay  = new Date(year, month, 0).getDate();
  const dateTo   = `${year}-${pad(month)}-${pad(lastDay)}`;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shift_slot_requirements")
    .select("pattern_name, shift_date, required_count")
    .eq("project_id", projectId)
    .gte("shift_date", dateFrom)
    .lte("shift_date", dateTo);

  if (error) return { success: false, message: error.message };

  return {
    success: true,
    slotRequirements: (data ?? []).map(r => ({
      pattern_name:   r.pattern_name as string,
      shift_date:     r.shift_date as string,
      required_count: r.required_count as number,
    })),
  };
}

export type GenerateDraftResult = {
  success: boolean;
  message?: string;
  assignedCount?: number;
};

type PatternDef = {
  name: string;
  section: string | null;
  start_time: string | null;
  end_time: string | null;
  target_role: string;
};

/** YYYY-MM-DD の前日を返す */
function prevDate(dateStr: string): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** date が属する ISO 週キー (YYYY-Www) */
function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay() || 7; // 月=1, 日=7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * 仮組生成：slot_requirements の必要数に従いスタッフを自動割当て
 * - 希望休スタッフは当日除外
 * - 同日すでに別パターン確定済み/仮組済みスタッフは除外
 * - 月稼働日数・週稼働日数上限を超えない
 * - 連勤上限（max_consecutive_days、デフォルト5日）を超えない
 * - preferred_shift が一致するスタッフを優先配置
 * - 結果は shift_grid_drafts にドラフト保存
 */
export async function generateShiftDraftAction(
  projectId: string,
  year: number,
  month: number,
  patterns: PatternDef[],
): Promise<GenerateDraftResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStr = `${year}-${pad(month)}`;
  const dateFrom = `${monthStr}-01`;
  const lastDay  = new Date(year, month, 0).getDate();
  const dateTo   = `${monthStr}-${pad(lastDay)}`;

  const admin = createAdminClient();

  // ── データ取得 ──────────────────────────────────────────────
  const [
    { data: memberRows },
    { data: slotReqRows },
    { data: holidayRows },
    { data: existingShiftRows },
  ] = await Promise.all([
    admin.from("project_members")
      .select("staff_id, role, section, sections, work_days_type, work_days_count, preferred_shift, preferred_section, max_consecutive_days")
      .eq("project_id", projectId),
    admin.from("shift_slot_requirements")
      .select("pattern_name, shift_date, required_count")
      .eq("project_id", projectId)
      .gte("shift_date", dateFrom)
      .lte("shift_date", dateTo),
    admin.from("holiday_requests")
      .select("staff_id, request_date")
      .eq("project_id", projectId)
      .gte("request_date", dateFrom)
      .lte("request_date", dateTo),
    admin.from("shifts")
      .select("staff_id, shift_date, shift_name")
      .eq("project_id", projectId)
      .gte("shift_date", dateFrom)
      .lte("shift_date", dateTo),
  ]);

  if (!memberRows || memberRows.length === 0) {
    return { success: false, message: "メンバーが登録されていません" };
  }
  if (!slotReqRows || slotReqRows.length === 0) {
    return { success: false, message: "必要人数が設定されていません。先に必要数を保存してください" };
  }

  // 希望休セット: "staffId__date"
  const holidaySet = new Set<string>(
    (holidayRows ?? []).map(h => `${h.staff_id}__${h.request_date}`)
  );

  // 既存シフトマップ: "staffId__date" → shiftName
  const existingMap = new Map<string, string>();
  for (const s of (existingShiftRows ?? [])) {
    if (s.shift_name) existingMap.set(`${s.staff_id}__${s.shift_date}`, s.shift_name as string);
  }

  // スロット必要数マップ: "patternName__date" → count
  const slotMap = new Map<string, number>();
  for (const r of slotReqRows) {
    slotMap.set(`${r.pattern_name}__${r.shift_date}`, r.required_count as number);
  }

  // 全日付リスト
  const allDates = Array.from({ length: lastDay }, (_, i) =>
    `${monthStr}-${pad(i + 1)}`
  );

  // ── 稼働カウンタ ────────────────────────────────────────────
  // 月内のドラフト割当日数: staffId → count
  const draftMonthCount = new Map<string, number>();
  // ドラフト割当日セット: staffId → Set<date>
  const draftDates = new Map<string, Set<string>>();

  // 既存シフトの月内割当日数（公休・希望休除く）
  const existingMonthCount = new Map<string, number>();
  // 既存シフトの割当日セット（連勤計算用）
  const existingDateSet = new Map<string, Set<string>>();
  for (const s of (existingShiftRows ?? [])) {
    const name = s.shift_name as string | null;
    if (!name || name === "公休" || name === "希望休") continue;
    existingMonthCount.set(s.staff_id, (existingMonthCount.get(s.staff_id) ?? 0) + 1);
    if (!existingDateSet.has(s.staff_id)) existingDateSet.set(s.staff_id, new Set());
    existingDateSet.get(s.staff_id)!.add(s.shift_date as string);
  }

  // ── 連勤日数を計算するヘルパー ──────────────────────────────
  function consecutiveDaysBefore(staffId: string, date: string): number {
    const dDraft    = draftDates.get(staffId) ?? new Set<string>();
    const dExisting = existingDateSet.get(staffId) ?? new Set<string>();
    let count = 0;
    let check = prevDate(date);
    while (dDraft.has(check) || dExisting.has(check)) {
      count++;
      check = prevDate(check);
    }
    return count;
  }

  // ── 仮組グリッド生成 ────────────────────────────────────────
  const draft = new Map<string, { shiftName: string; shiftStart: string | null; shiftEnd: string | null }>();

  for (const date of allDates) {
    const weekKey = isoWeekKey(date);

    // その日に既に割当済みのスタッフ（既存 or ドラフト）
    const assignedOnDate = new Set<string>();
    for (const [k] of existingMap) {
      if (k.endsWith(`__${date}`)) assignedOnDate.add(k.replace(`__${date}`, ""));
    }
    for (const [staffId, dates] of draftDates) {
      if (dates.has(date)) assignedOnDate.add(staffId);
    }

    for (const pattern of patterns) {
      const required = slotMap.get(`${pattern.name}__${date}`) ?? 0;
      if (required === 0) continue;

      const alreadyAssigned = (existingShiftRows ?? []).filter(
        s => s.shift_date === date && s.shift_name === pattern.name
      ).length;
      const needMore = required - alreadyAssigned;
      if (needMore <= 0) continue;

      // 候補スタッフをフィルタリング
      const candidates = (memberRows ?? []).filter(m => {
        // 希望休・当日割当済み
        if (holidaySet.has(`${m.staff_id}__${date}`)) return false;
        if (assignedOnDate.has(m.staff_id)) return false;
        if (existingMap.has(`${m.staff_id}__${date}`)) return false;

        // セクション一致チェック
        if (pattern.section) {
          const ms = ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean);
          const effectiveSections = ms.length > 0 ? ms : (m.section ? [m.section] : []);
          if (effectiveSections.length > 0 && !effectiveSections.includes(pattern.section)) return false;
        }

        // ロール一致チェック
        if (pattern.target_role === "admin" && m.role !== "project_admin") return false;
        if (pattern.target_role === "staff" && m.role !== "staff") return false;

        // 月稼働日数上限チェック
        const wdType  = (m as { work_days_type?: string | null }).work_days_type;
        const wdCount = (m as { work_days_count?: number | null }).work_days_count;
        if (wdType === "monthly" && wdCount != null) {
          const current = (draftMonthCount.get(m.staff_id) ?? 0) + (existingMonthCount.get(m.staff_id) ?? 0);
          if (current >= wdCount) return false;
        }

        // 週稼働日数上限チェック
        if (wdType === "weekly" && wdCount != null) {
          const draftWeekCount = [...(draftDates.get(m.staff_id) ?? new Set<string>())]
            .filter(d => isoWeekKey(d) === weekKey).length;
          const existWeekCount = [...(existingDateSet.get(m.staff_id) ?? new Set<string>())]
            .filter(d => isoWeekKey(d) === weekKey).length;
          if (draftWeekCount + existWeekCount >= wdCount) return false;
        }

        // 連勤上限チェック（未設定はデフォルト5日）
        const maxConsec = (m as { max_consecutive_days?: number | null }).max_consecutive_days ?? 5;
        if (consecutiveDaysBefore(m.staff_id, date) >= maxConsec) return false;

        return true;
      });

      // 優先度スコアでソート（高いほど先に割当）
      // 2: preferred_shift + preferred_section 両方一致
      // 1: どちらか一方一致
      // 0: 一致なし → シャッフル
      const scored = candidates.map(m => {
        const ps = (m as { preferred_shift?: string | null }).preferred_shift;
        const pSec = (m as { preferred_section?: string | null }).preferred_section;
        let score = 0;
        if (ps === pattern.name) score++;
        if (pattern.section && pSec === pattern.section) score++;
        return { m, score };
      });
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return Math.random() - 0.5; // 同スコアはランダム
      });
      const sorted = scored.map(s => s.m);
      const toAssign = sorted.slice(0, needMore);

      for (const m of toAssign) {
        draft.set(`${m.staff_id}__${date}`, {
          shiftName:  pattern.name,
          shiftStart: pattern.start_time,
          shiftEnd:   pattern.end_time,
        });
        assignedOnDate.add(m.staff_id);

        // カウンタ更新
        draftMonthCount.set(m.staff_id, (draftMonthCount.get(m.staff_id) ?? 0) + 1);
        if (!draftDates.has(m.staff_id)) draftDates.set(m.staff_id, new Set());
        draftDates.get(m.staff_id)!.add(date);
      }
    }
  }

  if (draft.size === 0) {
    return { success: false, message: "割当可能なスタッフがいませんでした" };
  }

  // draft を GridDraftEntry[] 形式に変換して保存
  const draftEntries = [...draft.entries()].map(([key, val]) => {
    const [staffId, date] = key.split("__");
    return { staffId, date, shiftName: val.shiftName, shiftStart: val.shiftStart, shiftEnd: val.shiftEnd };
  });

  const savedBy = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { error } = await admin.from("shift_grid_drafts").upsert({
    project_id:   projectId,
    target_month: monthStr,
    draft_data:   draftEntries,
    saved_by:     savedBy,
    saved_at:     new Date().toISOString(),
  }, { onConflict: "project_id,target_month" });

  if (error) return { success: false, message: error.message };

  return { success: true, assignedCount: draft.size };
}
