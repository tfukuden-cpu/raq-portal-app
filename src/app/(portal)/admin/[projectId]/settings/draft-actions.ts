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
  required_count:   number | null;
  required_weekday: number | null;
  required_weekend: number | null;
};

// ── ユーティリティ ──────────────────────────────────────────

/** YYYY-MM-DD の前日を返す */
function prevDate(dateStr: string): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** date が属する ISO 週キー (YYYY-Www) */
function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

/**
 * 前のシフトの終了から次のシフトの開始まで MIN_INTERVAL_HOURS 以上あるか判定
 * 例: 前日22:00終了 → 当日09:00開始 = 11時間 → OK
 *     前日23:00終了 → 当日09:00開始 = 10時間 → NG
 */
const MIN_INTERVAL_HOURS = 11;

function hasAdequateInterval(
  prevEndTime: string | null | undefined,
  nextStartTime: string | null | undefined,
): boolean {
  if (!prevEndTime || !nextStartTime) return true; // 時間未設定は制約なし
  const [pH, pM] = prevEndTime.split(":").map(Number);
  const [nH, nM] = nextStartTime.split(":").map(Number);
  const prevMin = pH * 60 + pM;
  const nextMin = nH * 60 + nM;
  // 前日終了〜当日開始の間隔（翌日なので 24*60 加算）
  const gap = 24 * 60 - prevMin + nextMin;
  return gap >= MIN_INTERVAL_HOURS * 60;
}

/**
 * 仮組生成：slot_requirements の必要数に従いスタッフを自動割当て
 *
 * フィルタリングルール:
 * - 希望休スタッフは当日除外
 * - 同日すでに割当済みスタッフは除外
 * - セクション・ロール一致
 * - 月/週 稼働日数上限を超えない
 * - 連勤上限を超えない（前月末連勤も引き継ぎ）
 * - 勤務間インターバル 11時間未満になるパターンは除外
 *
 * 優先度スコア（高い順に割当）:
 * - 優先パターン + 優先セクション 両方一致 → 2点
 * - どちらか一方 → 1点
 * - 一致なし → 0点（ランダム）
 */
export async function generateShiftDraftAction(
  projectId: string,
  year: number,
  month: number,
  patterns: PatternDef[],
  targetSection?: string,   // 指定時: そのセクションのみ再仮組み・他セクションのドラフトは保持
): Promise<GenerateDraftResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStr = `${year}-${pad(month)}`;
  const dateFrom = `${monthStr}-01`;
  const lastDay  = new Date(year, month, 0).getDate();
  const dateTo   = `${monthStr}-${pad(lastDay)}`;

  // 前月末7日間（連勤引き継ぎ用）
  const prevMonthLastDay = new Date(year, month - 1, 0);
  const prevMonthDateTo  = prevMonthLastDay.toISOString().slice(0, 10);
  const prevMonthStart   = new Date(prevMonthLastDay);
  prevMonthStart.setUTCDate(prevMonthStart.getUTCDate() - 6);
  const prevMonthDateFrom = prevMonthStart.toISOString().slice(0, 10);

  const admin = createAdminClient();

  // ── データ取得 ──────────────────────────────────────────────
  const [
    { data: memberRows },
    { data: slotReqRows },
    { data: holidayRows },
    { data: existingShiftRows },
    { data: prevMonthShiftRows },
  ] = await Promise.all([
    admin.from("project_members")
      .select("staff_id, role, section, sections, work_days_type, work_days_count, preferred_shift, preferred_section, max_consecutive_days, end_date")
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
    // 前月末7日間（連勤引き継ぎ・インターバル計算用）
    admin.from("shifts")
      .select("staff_id, shift_date, shift_name")
      .eq("project_id", projectId)
      .gte("shift_date", prevMonthDateFrom)
      .lte("shift_date", prevMonthDateTo),
  ]);

  if (!memberRows || memberRows.length === 0) {
    return { success: false, message: "メンバーが登録されていません" };
  }

  // 離脱済みメンバーを除外
  let activeMemberRows = memberRows.filter(m => {
    const endDate = (m as { end_date?: string | null }).end_date ?? null;
    return !endDate || endDate >= dateFrom;
  });

  // セクション絞り込み: targetSection 指定時はそのセクション所属スタッフのみ対象
  // セクション未設定スタッフは除外（全セクション対応扱いにしない）
  if (targetSection) {
    activeMemberRows = activeMemberRows.filter(m => {
      const sections = ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean);
      const single   = (m as { section?: string | null }).section ?? null;
      const effective = sections.length > 0 ? sections : (single ? [single] : []);
      return effective.includes(targetSection);
    });
    // パターンもそのセクションのみに絞る
    patterns = patterns.filter(p => p.section === targetSection);

    if (patterns.length === 0) {
      return {
        success: false,
        message: `「${targetSection}」セクションに対応するシフトパターンが見つかりません。`
          + `シフトパターン設定でパターンのセクションを「${targetSection}」に設定してください。`,
      };
    }
  }

  // slotReqRows が null はDBエラー。空（length=0）はパターン自体の required_count で代替するため許容
  if (!slotReqRows) {
    return { success: false, message: "必要人数の取得に失敗しました" };
  }

  // パターンマップ（インターバル計算で参照）
  const patternMap = new Map<string, PatternDef>(patterns.map(p => [p.name, p]));

  // 希望休セット: "staffId__date"
  const holidaySet = new Set<string>(
    (holidayRows ?? []).map(h => `${h.staff_id}__${h.request_date}`)
  );

  // セクション再仮組み時: 対象セクションの確定済みシフトは「置き換え対象」なので除外判定しない
  // （すでに確定済みでも再仮組みで上書きできるようにする）
  const regenPatternNames = targetSection
    ? new Set(patterns.map(p => p.name))
    : null;

  // 既存シフトマップ: "staffId__date" → shiftName
  // targetSection 指定時: 再仮組み対象パターンのシフトはスキップ（上書き対象のため）
  const existingMap = new Map<string, string>();
  for (const s of (existingShiftRows ?? [])) {
    if (s.shift_name) {
      if (regenPatternNames?.has(s.shift_name as string)) continue;
      existingMap.set(`${s.staff_id}__${s.shift_date}`, s.shift_name as string);
    }
  }

  // スロット必要数マップ
  const slotMap = new Map<string, number>();
  for (const r of slotReqRows) {
    slotMap.set(`${r.pattern_name}__${r.shift_date}`, r.required_count as number);
  }

  // 全日付リスト
  const allDates = Array.from({ length: lastDay }, (_, i) =>
    `${monthStr}-${pad(i + 1)}`
  );

  // ── 稼働カウンタ ────────────────────────────────────────────
  const draftMonthCount = new Map<string, number>();   // staffId → 月内draft割当日数
  const draftDates      = new Map<string, Set<string>>(); // staffId → 割当日セット
  // ドラフトの日別パターン名: staffId → date → patternName（インターバル計算用）
  const draftPatternByDate = new Map<string, Map<string, string>>();

  // 既存シフト（当月）の月内割当日数・日セット
  const existingMonthCount = new Map<string, number>();
  const existingDateSet    = new Map<string, Set<string>>();

  // 既存シフト（当月 + 前月末）の日別パターン名（インターバル・連勤計算用）
  const existingPatternByDate = new Map<string, Map<string, string>>();

  const allExistingRows = [
    ...(existingShiftRows ?? []),
    ...(prevMonthShiftRows ?? []),
  ];
  for (const s of allExistingRows) {
    const name = s.shift_name as string | null;
    if (!name || name === "公休" || name === "希望休") continue;
    // 再仮組み対象パターンは稼働カウント・日付セットから除外（上書き対象のため）
    if (regenPatternNames?.has(name)) continue;
    if (!existingDateSet.has(s.staff_id)) existingDateSet.set(s.staff_id, new Set());
    existingDateSet.get(s.staff_id)!.add(s.shift_date as string);
    // 当月分のみカウント（月稼働日数上限チェック用）
    if ((s.shift_date as string) >= dateFrom) {
      existingMonthCount.set(s.staff_id, (existingMonthCount.get(s.staff_id) ?? 0) + 1);
    }
    if (!existingPatternByDate.has(s.staff_id)) existingPatternByDate.set(s.staff_id, new Map());
    existingPatternByDate.get(s.staff_id)!.set(s.shift_date as string, name);
  }

  // ── ヘルパー関数 ────────────────────────────────────────────

  /** 指定日の前日に割り当たっているパターン定義を返す */
  function getPrevDayPattern(staffId: string, date: string): PatternDef | null {
    const prev = prevDate(date);
    const draftName  = draftPatternByDate.get(staffId)?.get(prev);
    const existName  = existingPatternByDate.get(staffId)?.get(prev);
    const name = draftName ?? existName;
    return name ? (patternMap.get(name) ?? null) : null;
  }

  /** 指定日以前の連続出勤日数を返す（前月末も参照） */
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

  // スタッフが0人なら早期エラー
  if (activeMemberRows.length === 0) {
    const sec = targetSection ? `「${targetSection}」セクション` : "";
    return { success: false, message: `${sec}の対象スタッフが0人です。メンバー管理でセクションを確認してください。` };
  }

  // ── 必要数が未設定（0）のパターン向け: スタッフ人数から自動計算 ──
  // スタッフ平均稼働目標日数（デフォルト21日）
  const avgTargetDays = activeMemberRows.reduce((sum, m) => {
    const wdCount = (m as { work_days_count?: number | null }).work_days_count ?? 21;
    return sum + Math.min(wdCount, allDates.length);
  }, 0) / activeMemberRows.length;

  // パターン数（同じセクション内で分担）
  const patternCount = Math.max(1, patterns.length);

  // 1パターン・1日あたりの自動配置人数
  // = (スタッフ数 × 平均稼働日数) / 月日数 / パターン数
  const autoRequiredPerDay = Math.max(1, Math.round(
    activeMemberRows.length * avgTargetDays / allDates.length / patternCount
  ));

  for (const date of allDates) {
    const weekKey = isoWeekKey(date);

    const assignedOnDate = new Set<string>();
    for (const [k] of existingMap) {
      if (k.endsWith(`__${date}`)) assignedOnDate.add(k.replace(`__${date}`, ""));
    }
    for (const [staffId, dates] of draftDates) {
      if (dates.has(date)) assignedOnDate.add(staffId);
    }

    for (const pattern of patterns) {
      const slotRequired = slotMap.get(`${pattern.name}__${date}`);
      let required: number;
      if (slotRequired !== undefined) {
        // スロット設定が明示的にある場合はそれを使用
        required = slotRequired;
      } else {
        // パターン自体の必要人数設定を確認
        const dow = new Date(date + "T00:00:00Z").getUTCDay();
        const isWeekend = dow === 0 || dow === 6;
        const patternRequired = isWeekend
          ? (pattern.required_weekend ?? pattern.required_count ?? 0)
          : (pattern.required_weekday ?? pattern.required_count ?? 0);
        // 0（未設定）の場合はスタッフ人数ベースの自動計算値を使用
        required = patternRequired > 0 ? patternRequired : autoRequiredPerDay;
      }
      if (required === 0) continue;

      // 再仮組み対象パターンは「ゼロから再生成」するので既存確定数は無視
      const alreadyAssigned = regenPatternNames?.has(pattern.name) ? 0 : (existingShiftRows ?? []).filter(
        s => s.shift_date === date && s.shift_name === pattern.name
      ).length;
      const needMore = required - alreadyAssigned;
      if (needMore <= 0) continue;

      const candidates = activeMemberRows.filter(m => {
        // 離脱日チェック（end_date より後の日付には配置しない）
        const endDate = (m as { end_date?: string | null }).end_date ?? null;
        if (endDate && date > endDate) return false;

        // 希望休・同日割当済み
        if (holidaySet.has(`${m.staff_id}__${date}`)) return false;
        if (assignedOnDate.has(m.staff_id)) return false;
        if (existingMap.has(`${m.staff_id}__${date}`)) return false;

        // セクション一致
        if (pattern.section) {
          const ms = ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean);
          const effectiveSections = ms.length > 0 ? ms : (m.section ? [m.section] : []);
          if (effectiveSections.length > 0 && !effectiveSections.includes(pattern.section)) return false;
        }

        // ロール一致
        if (pattern.target_role === "admin" && m.role !== "project_admin") return false;
        if (pattern.target_role === "staff" && m.role !== "staff") return false;

        // 月稼働日数上限（未設定時は月21日をデフォルトとして適用）
        const wdType  = (m as { work_days_type?: string | null }).work_days_type  || "monthly";
        const wdCount = (m as { work_days_count?: number | null }).work_days_count ?? 21;
        if (wdType === "monthly") {
          const current = (draftMonthCount.get(m.staff_id) ?? 0) + (existingMonthCount.get(m.staff_id) ?? 0);
          if (current >= wdCount) return false;
        }

        // 週稼働日数上限
        if (wdType === "weekly") {
          const draftWeekCount = [...(draftDates.get(m.staff_id) ?? new Set<string>())]
            .filter(d => isoWeekKey(d) === weekKey).length;
          const existWeekCount = [...(existingDateSet.get(m.staff_id) ?? new Set<string>())]
            .filter(d => isoWeekKey(d) === weekKey && d >= dateFrom).length;
          if (draftWeekCount + existWeekCount >= wdCount) return false;
        }

        // 連勤上限（前月末引き継ぎ込み）
        const maxConsec = (m as { max_consecutive_days?: number | null }).max_consecutive_days ?? 5;
        if (consecutiveDaysBefore(m.staff_id, date) >= maxConsec) return false;

        // 勤務間インターバル（前日終了〜当日開始が11時間未満なら除外）
        const prevPattern = getPrevDayPattern(m.staff_id, date);
        if (!hasAdequateInterval(prevPattern?.end_time, pattern.start_time)) return false;

        return true;
      });

      // 優先度スコアでソート
      const scored = candidates.map(m => {
        const ps   = (m as { preferred_shift?: string | null }).preferred_shift;
        const pSec = (m as { preferred_section?: string | null }).preferred_section;
        let score = 0;
        if (ps === pattern.name) score++;
        if (pattern.section && pSec === pattern.section) score++;
        return { m, score };
      });
      scored.sort((a, b) => b.score !== a.score ? b.score - a.score : Math.random() - 0.5);

      const toAssign = scored.slice(0, needMore).map(s => s.m);

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
        if (!draftPatternByDate.has(m.staff_id)) draftPatternByDate.set(m.staff_id, new Map());
        draftPatternByDate.get(m.staff_id)!.set(date, pattern.name);
      }
    }
  }

  if (draft.size === 0) {
    const sec = targetSection ?? "";
    const staffCount = activeMemberRows.length;
    return {
      success: false,
      message: staffCount === 0
        ? `対象スタッフが0人です。メンバー管理でセクションを「${sec}」に設定してください。`
        : `配置できるスタッフが見つかりませんでした（対象${staffCount}人）。`
          + `稼働日数上限・希望休・連勤制限を確認してください。`,
    };
  }

  // GridDraftEntry 形式 { k, n, s, e, d } で保存（ShiftEditGrid と同じフォーマット）
  const newEntries = [...draft.entries()].map(([key, val]) => ({
    k: key,
    n: val.shiftName,
    s: val.shiftStart,
    e: val.shiftEnd,
    d: false,
  }));

  // セクション指定時: 他セクションのドラフトエントリを保持してマージ
  let draftEntries = newEntries;
  if (targetSection) {
    // 対象セクションのパターン名セット
    const targetPatternNames = new Set(patterns.map(p => p.name));

    // 既存ドラフトを取得
    const { data: existingDraft } = await admin
      .from("shift_grid_drafts")
      .select("draft_data")
      .eq("project_id", projectId)
      .eq("target_month", monthStr)
      .maybeSingle();

    type DraftEntry = { k: string; n: string; s: string | null; e: string | null; d: boolean };
    const existing = (existingDraft?.draft_data as DraftEntry[] | null) ?? [];

    // 他セクションのエントリ（対象セクションのパターンではないもの）は保持
    const preserved = existing.filter(e => !targetPatternNames.has(e.n));

    // 保持エントリ + 新規エントリをマージ（同キーは新規優先）
    const newKeys = new Set(newEntries.map(e => e.k));
    draftEntries = [
      ...preserved.filter(e => !newKeys.has(e.k)),
      ...newEntries,
    ];
  }

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
