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
  targetSection?: string,   // 指定時: そのセクションのみ再仮組み・他セクションのドラフトは保持
  noSave?: boolean,         // true のとき DB 書き込みをスキップ（グリッド編集内再仮組み用）
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

  for (const date of allDates) {
    const weekKey = isoWeekKey(date);

    const assignedOnDate = new Set<string>();
    for (const [k] of existingMap) {
      if (k.endsWith(`__${date}`)) assignedOnDate.add(k.replace(`__${date}`, ""));
    }
    for (const [staffId, dates] of draftDates) {
      if (dates.has(date)) assignedOnDate.add(staffId);
    }
    // 他セクションのドラフト割当も「その日は使用済み」として扱う
    if (otherSectionDates) {
      for (const [staffId, dates] of otherSectionDates) {
        if (dates.has(date)) assignedOnDate.add(staffId);
      }
    }

    for (const pattern of patterns) {
      const slotRequired = slotMap.get(`${pattern.name}__${date}`);
      let required: number;
      if (slotRequired !== undefined && slotRequired > 0) {
        // スロット要件が 1以上 明示設定されている場合のみ使用（0は「未設定」と同じ扱い）
        required = slotRequired;
      } else {
        // 未設定 or 0 → パターン自体の必要人数設定を確認
        const dow = new Date(date + "T00:00:00Z").getUTCDay();
        const isWeekend = dow === 0 || dow === 6;
        const patternRequired = isWeekend
          ? (pattern.required_weekend ?? pattern.required_count ?? 0)
          : (pattern.required_weekday ?? pattern.required_count ?? 0);
        // パターンも 0（未設定）ならスタッフ人数ベースの自動計算値を使用
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
        const wdCountRaw = (m as { work_days_count?: number | null }).work_days_count;
        const wdCount = (wdCountRaw != null && wdCountRaw > 0) ? wdCountRaw : 21;
        if (wdType === "monthly") {
          const current = (draftMonthCount.get(m.staff_id) ?? 0)
            + (existingMonthCount.get(m.staff_id) ?? 0)
            + (otherSectionMonthCount?.get(m.staff_id) ?? 0); // 他セクション分を加算
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

      // 優先度スコアでソート（同点時は稼働率が低いスタッフ優先で均等配分）
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
        // 均等配分: 稼働率（割当済/目標）が低いスタッフを優先
        // → 月全体を通じて各スタッフの稼働が平均的に分散される
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
        if (Math.abs(aRate - bRate) > 0.005) return aRate - bRate; // 稼働率が低い方を先に使う
        return Math.random() - 0.5;
      });

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
    if (staffCount === 0) {
      return { success: false, message: `対象スタッフが0人です。メンバー管理でセクションを「${sec}」に設定してください。` };
    }

    // 診断: 最初の日×最初のパターンで各条件を個別チェック
    const diagDate    = allDates[0] ?? "";
    const diagPattern = patterns[0];
    const diag = { endDate: 0, holiday: 0, alreadyOn: 0, section: 0, role: 0, monthLimit: 0, consec: 0, interval: 0, pass: 0 };
    const diagWeekKey = isoWeekKey(diagDate);
    for (const m of activeMemberRows) {
      const endDate = (m as { end_date?: string | null }).end_date ?? null;
      if (endDate && diagDate > endDate)                        { diag.endDate++;   continue; }
      if (holidaySet.has(`${m.staff_id}__${diagDate}`))         { diag.holiday++;   continue; }
      if (existingMap.has(`${m.staff_id}__${diagDate}`))        { diag.alreadyOn++; continue; }
      if (diagPattern?.section) {
        const ms = ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean);
        const eff = ms.length > 0 ? ms : (m.section ? [m.section] : []);
        if (eff.length > 0 && !eff.includes(diagPattern.section)) { diag.section++; continue; }
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
      + `終了日=${diag.endDate} 希望休=${diag.holiday} 同日済=${diag.alreadyOn} `
      + `セクション=${diag.section} ロール=${diag.role} 月上限=${diag.monthLimit} `
      + `連勤=${diag.consec} 間隔=${diag.interval} 通過=${diag.pass}]`;
    return {
      success: false,
      message: `配置できるスタッフが見つかりませんでした（対象${staffCount}人）。 ${diagStr}`,
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

    // storedDraftEntries は事前取得済み（otherSectionDates 構築時に使用したもの）
    const preserved = storedDraftEntries.filter(e => !targetPatternNames.has(e.n));

    // 保持エントリ + 新規エントリをマージ（同キーは新規優先）
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
