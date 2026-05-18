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

/**
 * 仮組生成：slot_requirements の必要数に従いスタッフを自動割当て
 * - 希望休スタッフは当日除外
 * - 同日すでに別パターン確定済みスタッフは除外
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
      .select("staff_id, role, section, sections")
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

  // 既存シフトマップ: "staffId__date" → shiftName (公休・有休含む)
  const existingMap = new Map<string, string>();
  for (const s of (existingShiftRows ?? [])) {
    if (s.shift_name) existingMap.set(`${s.staff_id}__${s.shift_date}`, s.shift_name as string);
  }

  // パターンマップ
  const patternMap = new Map<string, PatternDef>(patterns.map(p => [p.name, p]));

  // スロット必要数マップ: "patternName__date" → count
  const slotMap = new Map<string, number>();
  for (const r of slotReqRows) {
    slotMap.set(`${r.pattern_name}__${r.shift_date}`, r.required_count as number);
  }

  // 全日付リスト
  const allDates = Array.from({ length: lastDay }, (_, i) =>
    `${monthStr}-${pad(i + 1)}`
  );

  // ── 仮組グリッド生成 ────────────────────────────────────────
  // draft: "staffId__date" → { shiftName, shiftStart, shiftEnd }
  const draft = new Map<string, { shiftName: string; shiftStart: string | null; shiftEnd: string | null }>();

  // パターンをソート順に処理（section別スタッフ割当のため）
  for (const date of allDates) {
    // その日に既に割当済みのスタッフ（draft or 既存）
    const assignedOnDate = new Set<string>();
    for (const [k] of existingMap) {
      if (k.endsWith(`__${date}`)) {
        const staffId = k.replace(`__${date}`, "");
        assignedOnDate.add(staffId);
      }
    }

    for (const pattern of patterns) {
      const required = slotMap.get(`${pattern.name}__${date}`) ?? 0;
      if (required === 0) continue;

      // このパターン×日付に既存シフト済みスタッフ数
      const alreadyAssigned = (existingShiftRows ?? []).filter(
        s => s.shift_date === date && s.shift_name === pattern.name
      ).length;
      const needMore = required - alreadyAssigned;
      if (needMore <= 0) continue;

      // 候補スタッフ: セクション一致・役割一致・当日未割当・希望休なし
      const candidates = (memberRows ?? []).filter(m => {
        if (holidaySet.has(`${m.staff_id}__${date}`)) return false;
        if (assignedOnDate.has(m.staff_id)) return false;
        if (existingMap.has(`${m.staff_id}__${date}`)) return false;
        if (pattern.section) {
          const ms = ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean);
          const effectiveSections = ms.length > 0 ? ms : (m.section ? [m.section] : []);
          if (effectiveSections.length > 0 && !effectiveSections.includes(pattern.section)) return false;
        }
        if (pattern.target_role === "admin" && m.role !== "project_admin") return false;
        if (pattern.target_role === "staff" && m.role !== "staff") return false;
        return true;
      });

      // シャッフルして必要数だけ割当
      const shuffled = [...candidates].sort(() => Math.random() - 0.5);
      const toAssign = shuffled.slice(0, needMore);

      for (const m of toAssign) {
        draft.set(`${m.staff_id}__${date}`, {
          shiftName:  pattern.name,
          shiftStart: pattern.start_time,
          shiftEnd:   pattern.end_time,
        });
        assignedOnDate.add(m.staff_id);
      }
    }
  }

  if (draft.size === 0) {
    return { success: false, message: "割当可能なスタッフがいませんでした" };
  }

  // draft を GridDraftEntry[] 形式に変換
  const draftEntries = [...draft.entries()].map(([key, val]) => {
    const [staffId, date] = key.split("__");
    return { staffId, date, shiftName: val.shiftName, shiftStart: val.shiftStart, shiftEnd: val.shiftEnd };
  });

  // shift_grid_drafts に保存
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { error } = await admin.from("shift_grid_drafts").upsert({
    project_id:   projectId,
    target_month: monthStr,
    draft_data:   draftEntries,
    saved_by:     staffId,
    saved_at:     new Date().toISOString(),
  }, { onConflict: "project_id,target_month" });

  if (error) return { success: false, message: error.message };

  return { success: true, assignedCount: draft.size };
}
