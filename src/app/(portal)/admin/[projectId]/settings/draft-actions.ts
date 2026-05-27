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

// GridDraftEntry（ShiftEditGrid と同じフォーマット）
type GridDraftEntry = { k: string; n: string | null; s: string | null; e: string | null; d: boolean };

export type GenerateDraftResult = {
  success: boolean;
  message?: string;
  assignedCount?: number;
  draftEntries?: GridDraftEntry[];
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
  targetSection?: string,     // 指定時: そのセクションのみ再仮組み・他セクションのドラフトは保持
  noSave?: boolean,           // true のとき DB 書き込みをスキップ（グリッド編集内再仮組み用）
  skipSections?: string[],    // 全体再仮組み時にスキップ（仮確定済み）するセクション
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
    { data: trainingRows },
  ] = await Promise.all([
    admin.from("project_members")
      .select("staff_id, role, section, sections, work_days_type, work_days_count, preferred_shift, preferred_section, max_consecutive_days, start_date, end_date")
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
    // 導入研修日（当月分）：研修日はシフト仮組みから除外
    admin.from("staff_trainings")
      .select("staff_id, training_date")
      .eq("training_type", "onboarding")
      .gte("training_date", dateFrom)
      .lte("training_date", dateTo),
  ]);

  if (!memberRows || memberRows.length === 0) {
    return { success: false, message: "メンバーが登録されていません" };
  }

  // 離脱済みメンバーを除外
  let activeMemberRows = memberRows.filter(m => {
    const endDate = (m as { end_date?: string | null }).end_date ?? null;
    return !endDate || endDate >= dateFrom;
  });

  // 全パターン定義を保存（仮確定セクション判定で後から参照するため）
  const allPatternDefs = [...patterns];

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

  // ── 他セクションのドラフト割当を事前取得（セクション再仮組み時） ──────
  // 目的1: 再仮組み時に他セクションで割当済みの人を奪わないようにする
  // 目的2: 月稼働日数上限の計算に他セクション分を含める
  type DraftEntry = { k: string; n: string; s: string | null; e: string | null; d: boolean };
  let storedDraftEntries: DraftEntry[] = [];          // 後の merge 処理でも再利用
  let otherSectionDates: Map<string, Set<string>> | null = null;  // staffId → 割当日Set
  let otherSectionMonthCount: Map<string, number>   | null = null; // staffId → 当月割当数

  if (targetSection) {
    const { data: currentDraft } = await admin
      .from("shift_grid_drafts")
      .select("draft_data, locked_sections")
      .eq("project_id", projectId)
      .eq("target_month", monthStr)
      .maybeSingle();

    storedDraftEntries = (currentDraft?.draft_data as DraftEntry[] | null) ?? [];
    const lockedSectionsFromDB = (currentDraft?.locked_sections as string[] | null) ?? [];

    const targetPNames = new Set(patterns.map(p => p.name));
    const otherEntries = storedDraftEntries.filter(e => !targetPNames.has(e.n));

    otherSectionDates      = new Map();
    otherSectionMonthCount = new Map();

    for (const e of otherEntries) {
      const sepIdx = e.k.lastIndexOf("__");
      const staffId = e.k.slice(0, sepIdx);
      const date    = e.k.slice(sepIdx + 2);
      if (!otherSectionDates.has(staffId)) otherSectionDates.set(staffId, new Set());
      otherSectionDates.get(staffId)!.add(date);
      // 当月分のみカウント（月稼働日数上限チェック用）
      if (date >= dateFrom && date <= dateTo) {
        otherSectionMonthCount.set(staffId, (otherSectionMonthCount.get(staffId) ?? 0) + 1);
      }
    }

    // ── 仮確定セクションのスタッフを候補から完全除外 ──────────────
    // 仮確定セクションにいる人は「人を奪う」ことになるため、再仮組み対象外にする
    if (lockedSectionsFromDB.length > 0) {
      // 仮確定セクションのパターン名セット（全パターン定義から逆引き）
      const lockedPatternNames = new Set(
        allPatternDefs
          .filter(p => p.section && lockedSectionsFromDB.includes(p.section))
          .map(p => p.name)
      );

      // 仮確定セクションのドラフトエントリに登場するスタッフIDを収集
      const lockedStaffIds = new Set<string>();
      for (const e of storedDraftEntries) {
        if (lockedPatternNames.has(e.n)) {
          const si = e.k.lastIndexOf("__");
          lockedStaffIds.add(e.k.slice(0, si));
        }
      }

      // そのスタッフを候補から除外（同日保護だけでなく月全体で使わない）
      if (lockedStaffIds.size > 0) {
        activeMemberRows = activeMemberRows.filter(m => !lockedStaffIds.has(m.staff_id));
      }
    }
  }

  // ── 全体再仮組み時のロック済みセクション保護 ──────────────────────
  // skipSections に指定されたセクションは再仮組みせず既存ドラフトを保持する
  let skipPatternNames: Set<string> = new Set();
  if (!targetSection && skipSections && skipSections.length > 0) {
    skipPatternNames = new Set(
      allPatternDefs.filter(p => p.section && skipSections.includes(p.section)).map(p => p.name)
    );
    if (skipPatternNames.size > 0) {
      const { data: currentDraft } = await admin
        .from("shift_grid_drafts")
        .select("draft_data")
        .eq("project_id", projectId)
        .eq("target_month", monthStr)
        .maybeSingle();
      storedDraftEntries = (currentDraft?.draft_data as DraftEntry[] | null) ?? [];
      // ロック済みパターンを再仮組み対象から除外
      patterns = patterns.filter(p => !p.section || !skipSections.includes(p.section));
      // ロック済みセクションのスタッフの日程・月稼働を「使用済み」として記録
      otherSectionDates      = new Map();
      otherSectionMonthCount = new Map();
      const lockedStaffIds   = new Set<string>();
      for (const e of storedDraftEntries.filter(e2 => skipPatternNames.has(e2.n))) {
        const si = e.k.lastIndexOf("__");
        const staffId = e.k.slice(0, si);
        const date    = e.k.slice(si + 2);
        lockedStaffIds.add(staffId);
        if (!otherSectionDates.has(staffId)) otherSectionDates.set(staffId, new Set());
        otherSectionDates.get(staffId)!.add(date);
        if (date >= dateFrom && date <= dateTo) {
          otherSectionMonthCount.set(staffId, (otherSectionMonthCount.get(staffId) ?? 0) + 1);
        }
      }
      // ロック済みセクションのスタッフは候補から完全除外（人を奪わない）
      if (lockedStaffIds.size > 0) {
        activeMemberRows = activeMemberRows.filter(m => !lockedStaffIds.has(m.staff_id));
      }
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

  // 研修日セット: "staffId__date"（研修日はシフト仮組みから除外）
  const trainingSet = new Set<string>(
    (trainingRows ?? []).map(t => `${t.staff_id}__${t.training_date}`)
  );

  // スタッフ別研修日マップ（研修セクションパターンの割当制限に使用）
  const trainingDatesByStaff = new Map<string, Set<string>>();
  for (const t of (trainingRows ?? [])) {
    const sid = t.staff_id as string;
    if (!trainingDatesByStaff.has(sid)) trainingDatesByStaff.set(sid, new Set());
    trainingDatesByStaff.get(sid)!.add(t.training_date as string);
  }

  // セクション再仮組み時: 対象セクションの確定済みシフトは「置き換え対象」なので除外判定しない
  // （すでに確定済みでも再仮組みで上書きできるようにする）
  const regenPatternNames = targetSection
    ? new Set(patterns.map(p => p.name))
    : null;

  // 現在有効なシフト名セット（削除済みパターン名の確定シフトは仮組みで上書き可能にする）
  const validShiftNames = new Set<string>([
    ...allPatternDefs.map(p => p.name),
    "公休", "希望休", "研修",
  ]);

  // 既存シフトマップ: "staffId__date" → shiftName
  // targetSection 指定時: 再仮組み対象パターンのシフトはスキップ（上書き対象のため）
  // 削除済みパターン名のシフトもスキップ（上書き対象のため）
  const existingMap = new Map<string, string>();
  for (const s of (existingShiftRows ?? [])) {
    if (s.shift_name) {
      if (regenPatternNames?.has(s.shift_name as string)) continue;
      if (!validShiftNames.has(s.shift_name as string)) continue;
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
    // 削除済みパターン名のシフトも除外（稼働カウントに含めない）
    if (!validShiftNames.has(name)) continue;
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
    const wdRaw = (m as { work_days_count?: number | null }).work_days_count;
    const wdCount = (wdRaw != null && wdRaw > 0) ? wdRaw : 21;
    return sum + Math.min(wdCount, allDates.length);
  }, 0) / activeMemberRows.length;

  // パターン数（同じセクション内で分担）
  const patternCount = Math.max(1, patterns.length);

  // 1パターン・1日あたりの自動配置人数
  // = (スタッフ数 × 平均稼働日数) / 月日数 / パターン数
  const autoRequiredPerDay = Math.max(1, Math.round(
    activeMemberRows.length * avgTargetDays / allDates.length / patternCount
  ));

  // ── ラウンドロビン方式：均等配置 ─────────────────────────────────────
  // ラウンド1: 日1〜末日 → 各パターンに1人目を配置
  // ラウンド2: 日1〜末日 → 各パターンに2人目を配置
  // ラウンドN: ...
  // → どの日も「最後」にならないため、特定日への不足集中が構造的に起きない。
  // 稼働率ソートにより、少ない日数のスタッフが優先されるため均等に分散される。

  // スロット要件も含めた最大ラウンド数を算出
  let maxRound = 1;
  for (const p of patterns) {
    maxRound = Math.max(maxRound,
      p.required_count ?? 0,
      p.required_weekday ?? 0,
      p.required_weekend ?? 0,
    );
  }
  for (const v of slotMap.values()) maxRound = Math.max(maxRound, v);

  // (パターン名__日付) → ドラフトで割り当て済みの人数（O(1)参照用）
  const draftSlotCount = new Map<string, number>();

  for (let round = 1; round <= maxRound; round++) {
    // ラウンドごとに開始日をずらす（stride=11はすべての月長と互いに素）
    // → スタッフAがラウンドごとに異なる日から始まるため月全体に均等分散する
    // 例) 30日月: R1=1日目, R2=12日目, R3=23日目, R4=4日目 ...
    const startIdx = ((round - 1) * 11) % allDates.length;
    const dateOrder = startIdx === 0
      ? allDates
      : [...allDates.slice(startIdx), ...allDates.slice(0, startIdx)];

    for (const date of dateOrder) {
      const weekKey = isoWeekKey(date);

      // その日に既に割り当て済みのスタッフ（既存確定 + ドラフト + 他セクション）
      const assignedOnDate = new Set<string>();
      for (const [k] of existingMap) {
        if (k.endsWith(`__${date}`)) assignedOnDate.add(k.replace(`__${date}`, ""));
      }
      for (const [staffId, dates] of draftDates) {
        if (dates.has(date)) assignedOnDate.add(staffId);
      }
      if (otherSectionDates) {
        for (const [staffId, dates] of otherSectionDates) {
          if (dates.has(date)) assignedOnDate.add(staffId);
        }
      }

      for (const pattern of patterns) {
        const slotRequired = slotMap.get(`${pattern.name}__${date}`);
        let required: number;
        if (slotRequired !== undefined && slotRequired > 0) {
          required = slotRequired;
        } else {
          const dow = new Date(date + "T00:00:00Z").getUTCDay();
          const isWeekend = dow === 0 || dow === 6;
          const patternRequired = isWeekend
            ? (pattern.required_weekend ?? pattern.required_count ?? 0)
            : (pattern.required_weekday ?? pattern.required_count ?? 0);
          required = patternRequired > 0 ? patternRequired : autoRequiredPerDay;
        }

        if (round > required) continue; // このラウンドは不要

        // このラウンドで配置が必要か確認
        // 既存確定 + ドラフト割当済み が round 未満なら1人追加
        const existingCount = regenPatternNames?.has(pattern.name) ? 0
          : (existingShiftRows ?? []).filter(
              s => s.shift_date === date && s.shift_name === pattern.name
            ).length;
        const slotKey = `${pattern.name}__${date}`;
        const draftCount = draftSlotCount.get(slotKey) ?? 0;
        if (existingCount + draftCount >= round) continue; // このラウンド分は充足

        // 候補スタッフのフィルタリング
        const candidates = activeMemberRows.filter(m => {
          // アサイン日チェック（start_date前はシフトに入れない）
          const startDate = (m as { start_date?: string | null }).start_date ?? null;
          if (startDate && date < startDate) return false;
          // 離脱日チェック
          const endDate = (m as { end_date?: string | null }).end_date ?? null;
          if (endDate && date > endDate) return false;
          // 希望休・研修日・同日割当済み
          if (holidaySet.has(`${m.staff_id}__${date}`)) return false;
          if (trainingSet.has(`${m.staff_id}__${date}`)) return false;
          if (assignedOnDate.has(m.staff_id)) return false;
          if (existingMap.has(`${m.staff_id}__${date}`)) return false;
          // セクション一致
          if (pattern.section) {
            const ms = ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean);
            const effectiveSections = ms.length > 0 ? ms : (m.section ? [m.section] : []);
            if (effectiveSections.length === 0) return false;
            if (!effectiveSections.includes(pattern.section)) return false;
            // 研修セクションへの配置制限:
            // 研修日が設定されているスタッフは、登録された研修日のみ研修系パターンに配置可能
            // （研修日以外の日は他セクションで通常勤務）
            if (pattern.section.includes("研修")) {
              const myTrainingDates = trainingDatesByStaff.get(m.staff_id);
              if (myTrainingDates && myTrainingDates.size > 0 && !myTrainingDates.has(date)) {
                return false;
              }
            }
          }
          // ロール一致
          if (pattern.target_role === "admin" && m.role !== "project_admin") return false;
          if (pattern.target_role === "staff" && m.role !== "staff") return false;
          // 月稼働日数上限
          const wdType  = (m as { work_days_type?: string | null }).work_days_type  || "monthly";
          const wdCountRaw = (m as { work_days_count?: number | null }).work_days_count;
          const wdCount = (wdCountRaw != null && wdCountRaw > 0) ? wdCountRaw : 21;
          if (wdType === "monthly") {
            const current = (draftMonthCount.get(m.staff_id) ?? 0)
              + (existingMonthCount.get(m.staff_id) ?? 0)
              + (otherSectionMonthCount?.get(m.staff_id) ?? 0);
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
          // 連勤上限
          const maxConsec = (m as { max_consecutive_days?: number | null }).max_consecutive_days ?? 5;
          if (consecutiveDaysBefore(m.staff_id, date) >= maxConsec) return false;
          // 勤務間インターバル
          const prevPattern = getPrevDayPattern(m.staff_id, date);
          if (!hasAdequateInterval(prevPattern?.end_time, pattern.start_time)) return false;
          return true;
        });

        if (candidates.length === 0) continue;

        // ソート：優先シフト > 稼働率（低い順）> 連勤日数（少ない順）> ID
        const conseqCache = new Map<string, number>(
          candidates.map(m => [m.staff_id, consecutiveDaysBefore(m.staff_id, date)])
        );
        const scored = candidates.map(m => {
          const ps   = (m as { preferred_shift?: string | null }).preferred_shift;
          const pSec = (m as { preferred_section?: string | null }).preferred_section;
          let score = 0;
          if (ps === pattern.name) score++;
          if (pattern.section && pSec === pattern.section) score++;
          return { m, score };
        });
        scored.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          const aAssigned = (draftMonthCount.get(a.m.staff_id) ?? 0)
            + (existingMonthCount.get(a.m.staff_id) ?? 0)
            + (otherSectionMonthCount?.get(a.m.staff_id) ?? 0);
          const bAssigned = (draftMonthCount.get(b.m.staff_id) ?? 0)
            + (existingMonthCount.get(b.m.staff_id) ?? 0)
            + (otherSectionMonthCount?.get(b.m.staff_id) ?? 0);
          const aTargetRaw = (a.m as { work_days_count?: number | null }).work_days_count;
          const bTargetRaw = (b.m as { work_days_count?: number | null }).work_days_count;
          const aTarget = (aTargetRaw != null && aTargetRaw > 0) ? aTargetRaw : 21;
          const bTarget = (bTargetRaw != null && bTargetRaw > 0) ? bTargetRaw : 21;
          const aRate = aAssigned / Math.max(1, aTarget);
          const bRate = bAssigned / Math.max(1, bTarget);
          if (Math.abs(aRate - bRate) > 0.005) return aRate - bRate;
          const aConsec = conseqCache.get(a.m.staff_id) ?? 0;
          const bConsec = conseqCache.get(b.m.staff_id) ?? 0;
          if (aConsec !== bConsec) return aConsec - bConsec;
          return a.m.staff_id < b.m.staff_id ? -1 : 1;
        });

        // このラウンドで1人だけ配置
        const m = scored[0].m;
        draft.set(`${m.staff_id}__${date}`, {
          shiftName:  pattern.name,
          shiftStart: pattern.start_time,
          shiftEnd:   pattern.end_time,
        });
        assignedOnDate.add(m.staff_id);
        draftMonthCount.set(m.staff_id, (draftMonthCount.get(m.staff_id) ?? 0) + 1);
        if (!draftDates.has(m.staff_id)) draftDates.set(m.staff_id, new Set());
        draftDates.get(m.staff_id)!.add(date);
        if (!draftPatternByDate.has(m.staff_id)) draftPatternByDate.set(m.staff_id, new Map());
        draftPatternByDate.get(m.staff_id)!.set(date, pattern.name);
        draftSlotCount.set(slotKey, draftCount + 1);
      }
    }
  } // end round-robin

  if (draft.size === 0) {
    const sec = targetSection ?? "";
    const staffCount = activeMemberRows.length;
    if (staffCount === 0) {
      return { success: false, message: `対象スタッフが0人です。メンバー管理でセクションを「${sec}」に設定してください。` };
    }

    // 診断: 最初の日×最初のパターンで各条件を個別チェック
    const diagDate    = allDates[0] ?? "";
    const diagPattern = patterns[0];
    const diag = { endDate: 0, holiday: 0, training: 0, alreadyOn: 0, section: 0, role: 0, monthLimit: 0, consec: 0, interval: 0, pass: 0 };
    const diagWeekKey = isoWeekKey(diagDate);
    for (const m of activeMemberRows) {
      const endDate = (m as { end_date?: string | null }).end_date ?? null;
      if (endDate && diagDate > endDate)                        { diag.endDate++;   continue; }
      if (holidaySet.has(`${m.staff_id}__${diagDate}`))         { diag.holiday++;   continue; }
      if (trainingSet.has(`${m.staff_id}__${diagDate}`))        { diag.training++;  continue; }
      if (existingMap.has(`${m.staff_id}__${diagDate}`))        { diag.alreadyOn++; continue; }
      if (diagPattern?.section) {
        const ms = ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean);
        const eff = ms.length > 0 ? ms : (m.section ? [m.section] : []);
        if (eff.length === 0 || !eff.includes(diagPattern.section)) { diag.section++; continue; }
      }
      if (diagPattern?.target_role === "admin" && m.role !== "project_admin") { diag.role++; continue; }
      if (diagPattern?.target_role === "staff" && m.role !== "staff")          { diag.role++; continue; }
      const wdType  = (m as { work_days_type?: string | null }).work_days_type || "monthly";
      const wdDiagRaw = (m as { work_days_count?: number | null }).work_days_count;
      const wdCount = (wdDiagRaw != null && wdDiagRaw > 0) ? wdDiagRaw : 21;
      if (wdType === "monthly") {
        const cur = (draftMonthCount.get(m.staff_id) ?? 0) + (existingMonthCount.get(m.staff_id) ?? 0);
        if (cur >= wdCount) { diag.monthLimit++; continue; }
      }
      const maxC = (m as { max_consecutive_days?: number | null }).max_consecutive_days ?? 5;
      if (consecutiveDaysBefore(m.staff_id, diagDate) >= maxC) { diag.consec++; continue; }
      const prevP = getPrevDayPattern(m.staff_id, diagDate);
      if (!hasAdequateInterval(prevP?.end_time, diagPattern?.start_time)) { diag.interval++; continue; }
      diag.pass++;
    }
    const diagStr = `[診断(${diagDate}/${diagPattern?.name ?? "?"}): `
      + `終了日=${diag.endDate} 希望休=${diag.holiday} 研修日=${diag.training} 同日済=${diag.alreadyOn} `
      + `セクション=${diag.section} ロール=${diag.role} 月上限=${diag.monthLimit} `
      + `連勤=${diag.consec} 間隔=${diag.interval} 通過=${diag.pass}]`;
    return {
      success: false,
      message: `配置できるスタッフが見つかりませんでした（対象${staffCount}人）。 ${diagStr}`,
    };
  }

  // 全アクティブメンバー（セクション絞り込み前）の研修日エントリを生成
  // セクション指定の再仮組みでも全員分を上書きして最新状態を保つ
  const allActiveMemberIds = new Set(
    (memberRows ?? [])
      .filter(m => {
        const endDate = (m as { end_date?: string | null }).end_date ?? null;
        return !endDate || endDate >= dateFrom;
      })
      .map(m => m.staff_id as string)
  );
  const trainingEntries = (trainingRows ?? [])
    .filter(t => allActiveMemberIds.has(t.staff_id as string))
    .map(t => ({
      k: `${t.staff_id as string}__${t.training_date as string}`,
      n: "研修" as string,
      s: null as string | null,
      e: null as string | null,
      d: false,
    }));

  // GridDraftEntry 形式 { k, n, s, e, d } で保存（ShiftEditGrid と同じフォーマット）
  // 通常シフトより研修を優先（研修日は候補除外済みなので実際は重複しない）
  const regularEntries = [...draft.entries()].map(([key, val]) => ({
    k: key,
    n: val.shiftName,
    s: val.shiftStart,
    e: val.shiftEnd,
    d: false,
  }));
  const trainingKeySet = new Set(trainingEntries.map(e => e.k));
  const newEntries = [
    ...regularEntries.filter(e => !trainingKeySet.has(e.k)),
    ...trainingEntries,
  ];

  // セクション指定 or スキップセクション指定時: 既存ドラフトと新規エントリをマージ
  let draftEntries = newEntries;
  if (targetSection) {
    // 対象セクションのパターン名セット
    const targetPatternNames = new Set(patterns.map(p => p.name));
    // storedDraftEntries は事前取得済み（otherSectionDates 構築時に使用したもの）
    const preserved = storedDraftEntries.filter(e => !targetPatternNames.has(e.n));
    const newKeys = new Set(newEntries.map(e => e.k));
    draftEntries = [
      ...preserved.filter(e => !newKeys.has(e.k)),
      ...newEntries,
    ];
  } else if (skipPatternNames.size > 0) {
    // 全体再仮組み時: ロック済みセクションのエントリを保持してマージ
    const preserved = storedDraftEntries.filter(e => skipPatternNames.has(e.n));
    const newKeys = new Set(newEntries.map(e => e.k));
    draftEntries = [
      ...preserved.filter(e => !newKeys.has(e.k)),
      ...newEntries,
    ];
  }

  if (!noSave) {
    const savedBy = user.email?.split("@")[0]?.toUpperCase() ?? "";
    const { error } = await admin.from("shift_grid_drafts").upsert({
      project_id:   projectId,
      target_month: monthStr,
      draft_data:   draftEntries,
      saved_by:     savedBy,
      saved_at:     new Date().toISOString(),
    }, { onConflict: "project_id,target_month" });

    if (error) return { success: false, message: error.message };
  }

  return { success: true, assignedCount: draft.size, draftEntries };
}
