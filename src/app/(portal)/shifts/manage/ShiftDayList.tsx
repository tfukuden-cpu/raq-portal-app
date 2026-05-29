"use client";

import { useState, useRef, useEffect } from "react";
import StaffPopupMenu from "@/components/StaffPopupMenu";
import StaffInfoPanel, { type StaffInfoMember } from "./StaffInfoPanel";

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

type Shift = {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  note: string | null;
};
type Member  = {
  id: string; name: string; role: string; section: string | null; sections: string[];
  work_days_type?: string | null; work_days_count?: number | null;
  preferred_shift?: string | null; preferred_section?: string | null;
  max_consecutive_days?: number | null; shift_note?: string | null;
  endDate?: string | null;
  churn_risk?: boolean; churn_risk_since?: string | null;
};
type Pattern = {
  name: string;
  required_count: number;
  required_weekday: number | null;
  required_weekend: number | null;
  section: string | null;
  start_time: string | null;
  end_time: string | null;
};

function isWeekendDate(dateStr: string): boolean {
  const dow = new Date(dateStr).getUTCDay();
  return dow === 0 || dow === 6;
}

/** 平日/休日を考慮した必要人数を返す */
function getRequiredForDate(p: Pattern, date: string): number {
  const weekend = isWeekendDate(date);
  if (weekend && p.required_weekend != null) return p.required_weekend;
  if (!weekend && p.required_weekday != null) return p.required_weekday;
  return p.required_count;
}

// 姓＋名1文字（例：田中太郎 → 田中太）
const shortName = (name: string) => {
  const parts = name.split(/[\s　]+/);
  if (parts.length >= 2) return parts[0] + (parts[1]?.[0] ?? "");
  return name.slice(0, 3);
};

// 今日（JST）
const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" })
  .format(new Date())
  .slice(0, 10);

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ── シフト色定義（ShiftEditGrid と共通） ──────────────────────────
const SECTION_SHIFT_COLORS: Record<string, { early: string; late: string; def: string }> = {
  "SV":       { early: "bg-blue-100 dark:bg-blue-900/50",      late: "bg-blue-300 dark:bg-blue-700/70",      def: "bg-blue-200 dark:bg-blue-800/60" },
  "査定":     { early: "bg-emerald-100 dark:bg-emerald-900/50", late: "bg-emerald-300 dark:bg-emerald-700/70", def: "bg-emerald-200 dark:bg-emerald-800/60" },
  "販売":     { early: "bg-orange-100 dark:bg-orange-900/50",   late: "bg-orange-300 dark:bg-orange-700/70",   def: "bg-orange-200 dark:bg-orange-800/60" },
  "MOTA":     { early: "bg-red-100 dark:bg-red-900/50",        late: "bg-red-300 dark:bg-red-700/70",        def: "bg-red-200 dark:bg-red-800/60" },
  "リメイク": { early: "bg-pink-100 dark:bg-pink-900/50",      late: "bg-pink-300 dark:bg-pink-700/70",      def: "bg-pink-200 dark:bg-pink-800/60" },
  "ローン":   { early: "bg-violet-100 dark:bg-violet-900/50",  late: "bg-violet-300 dark:bg-violet-700/70",  def: "bg-violet-200 dark:bg-violet-800/60" },
};
const SECTION_SHIFT_FALLBACK = { early: "bg-sky-100 dark:bg-sky-900/50", late: "bg-sky-300 dark:bg-sky-700/70", def: "bg-sky-200 dark:bg-sky-800/60" };

function getPatternBg(shiftName: string | null, pattern: Pattern | null): string {
  if (!shiftName || shiftName === "公休" || shiftName === "希望休" || shiftName === "有休" || shiftName === "特別休暇") return "";
  if (!pattern) return "";
  const colors = SECTION_SHIFT_COLORS[pattern.section ?? ""] ?? SECTION_SHIFT_FALLBACK;
  if (shiftName.includes("早番")) return colors.early;
  if (shiftName.includes("遅番")) return colors.late;
  const startH = pattern.start_time ? parseInt(pattern.start_time.split(":")[0], 10) : null;
  if (startH !== null && startH < 12) return colors.early;
  if (startH !== null && startH >= 12) return colors.late;
  return colors.def;
}

/** 3文字以内のシフト略称（早番/遅番を区別できるよう調整） */
function shiftAbbr(name: string): string {
  // 早番 → "早", 遅番 → "遅" をキーワードとして保持しつつ先頭2文字と合わせて3文字に
  if (name.includes("早番")) return name.replace("早番", "早").slice(0, 3);
  if (name.includes("遅番")) return name.replace("遅番", "遅").slice(0, 3);
  return name.slice(0, 3);
}

type TabKey = "shukkin" | "kyukyu" | "kiboshu";

type SlotReq = { section: string; pattern_name: string; shift_date: string; required_count: number };

type ChangeLog = {
  staff_id: string;
  shift_date: string;
  action: string;
  before_shift_name: string | null;
  after_shift_name: string | null;
  changed_by_name: string;
  changed_at: string;
};

const PRIORITY_LABEL: Record<string, string> = {
  "第一希望休": "①", "第二希望休": "②", "第三希望休": "③", "第四希望休": "④", "冠婚葬祭": "婚",
};
const PRIORITY_COLOR: Record<string, string> = {
  "第一希望休": "text-blue-600 dark:text-blue-400",
  "第二希望休": "text-indigo-500 dark:text-indigo-400",
  "第三希望休": "text-purple-500 dark:text-purple-400",
  "第四希望休": "text-zinc-400 dark:text-zinc-500",
  "冠婚葬祭":   "text-red-500 dark:text-red-400",
};

export default function ShiftDayList({
  allDates, shifts, activeMembers, shiftPatterns, slotRequirements,
  changeLogs, absenceSet, selectedDate, onDateChange, projectId, offRequests,
  availableSections, shiftPatternNames, sortByAccount, onSetKyukyu,
}: {
  allDates: string[];
  shifts: Shift[];
  activeMembers: Member[];
  shiftPatterns: Pattern[];
  slotRequirements?: SlotReq[];
  changeLogs?: ChangeLog[];
  absenceSet?: Set<string>;
  selectedDate: string;
  onDateChange: (date: string) => void;
  projectId: string;
  targetYear: number;
  targetMonth: number;
  offRequests?: { staff_id: string; request_date: string; priority: string; source?: string }[];
  availableSections?: string[];
  shiftPatternNames?: string[];
  sortByAccount?: boolean;
  onSetKyukyu?: (staffId: string, date: string) => void;
}) {
  // staff_id__date → priority のマップ
  const offRequestMap = new Map(
    (offRequests ?? []).map(r => [`${r.staff_id}__${r.request_date}`, r.priority])
  );
  const [tabKey, setTabKey]   = useState<TabKey>("shukkin");
  const [nameFilter, setNameFilter] = useState("");
  const [staffMenu, setStaffMenu] = useState<{ staffId: string; staffName: string } | null>(null);
  const [staffInfoTarget, setStaffInfoTarget] = useState<Member | null>(null);
  // パターンごとの折りたたみ状態（初期値: 全折りたたみ）
  const [collapsedPatterns, setCollapsedPatterns] = useState<Set<string>>(
    () => new Set(shiftPatterns.map(p => p.name))
  );
  // 月次ストリップの横スクロールコンテナ
  const stripRef = useRef<HTMLDivElement>(null);
  // 日付ヘッダーストリップの内部 div（translateX でスクロール同期）
  const headerInnerRef = useRef<HTMLDivElement>(null);

  // データテーブルのスクロールに合わせて日付ヘッダーを同期
  const syncHeader = (scrollLeft: number) => {
    if (headerInnerRef.current) {
      headerInnerRef.current.style.transform = `translateX(-${scrollLeft}px)`;
    }
  };

  // 選択日が変わったらストリップを中央にスクロール
  useEffect(() => {
    if (!stripRef.current) return;
    const LEFT_COL = 80;  // w-20
    const COL_W    = 44;  // w-11
    const idx = allDates.indexOf(selectedDate);
    if (idx < 0) return;
    const target = LEFT_COL + idx * COL_W - (stripRef.current.clientWidth - LEFT_COL) / 2 + COL_W / 2;
    const scrollLeft = Math.max(0, target);
    stripRef.current.scrollTo({ left: scrollLeft, behavior: "smooth" });
    syncHeader(scrollLeft);
  }, [selectedDate, allDates]);

  const togglePattern = (name: string) => setCollapsedPatterns(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const visibleMembers = activeMembers;

  // 離脱リスクマップ（staff_id → churn_risk_since | null）
  const churnRiskSinceMap = new Map<string, string | null>();
  for (const m of visibleMembers) {
    if (m.churn_risk) churnRiskSinceMap.set(m.id, m.churn_risk_since ?? null);
  }
  /** 充足カウントから除外すべきか（離脱リスク判定） */
  function isChurnExcluded(memberId: string, date: string): boolean {
    if (!churnRiskSinceMap.has(memberId)) return false;
    const since = churnRiskSinceMap.get(memberId) ?? null;
    if (!since) return true;          // since 未設定 → 全期間除外
    return date >= since;             // since 以降を除外
  }
  /** セルに赤枠＋離脱リスク表示すべきか */
  function isChurnRiskCell(memberId: string, date: string): boolean {
    return isChurnExcluded(memberId, date);
  }

  // シフトルックアップ
  const shiftMap = new Map<string, Shift>(shifts.map((s) => [`${s.staff_id}__${s.shift_date}`, s]));
  const getShift = (sid: string, d: string) => shiftMap.get(`${sid}__${d}`);

  // パターン名 → パターン定義（色付けに使用）
  const patternByName = new Map<string, Pattern>(shiftPatterns.map(p => [p.name, p]));

  // 変更ログ：日付ごとにまとめる
  const logsByDate = new Map<string, ChangeLog[]>();
  for (const log of changeLogs ?? []) {
    if (!logsByDate.has(log.shift_date)) logsByDate.set(log.shift_date, []);
    logsByDate.get(log.shift_date)!.push(log);
  }

  // 欠勤チェック
  const isAbsent = (staffId: string, date: string) =>
    absenceSet?.has(`${staffId}__${date}`) ?? false;

  // 日別スロット必要数（shift_slot_requirements から） section + pattern + date をキーにする
  const slotReqMap = new Map<string, number>();
  (slotRequirements ?? []).forEach(r => {
    slotReqMap.set(`${r.section}__${r.pattern_name}__${r.shift_date}`, r.required_count);
  });
  // shift_slot_requirements を優先し、なければ shift_patterns のデフォルト値を使う
  const getReqForDate = (p: Pattern, date: string): number => {
    if (p.section) {
      const override = slotReqMap.get(`${p.section}__${p.name}__${date}`);
      if (override !== undefined) return override;
    }
    return getRequiredForDate(p, date);
  };

  // ── タブ ─────────────────────────────────────────────────────
  const tabs: { key: TabKey; label: string }[] = [
    { key: "shukkin", label: "出勤" },
    { key: "kyukyu",  label: "公休" },
    { key: "kiboshu", label: "希望休" },
  ];

  // 各パターンの最大スロット数（月全体: max(必要数, 実績) + 1 余剰枠）
  const patternMaxSlots = new Map<string, number>();
  for (const pattern of shiftPatterns) {
    const maxReq = allDates.length > 0
      ? Math.max(0, ...allDates.map(d => getReqForDate(pattern, d)))
      : 0;
    const maxActual = allDates.length > 0
      ? Math.max(0, ...allDates.map(d =>
          visibleMembers.filter(m => getShift(m.id, d)?.shift_name === pattern.name).length
        ))
      : 0;
    patternMaxSlots.set(pattern.name, Math.max(maxReq, maxActual) + 1);
  }
  const visibleShiftPatterns = shiftPatterns.filter(p => (patternMaxSlots.get(p.name) ?? 0) > 0);

  return (
    <>
      {/* ━━ タブ / フィルター ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">

        {/* ① タブ行（出勤 / 公休 / 希望休） */}
        <div className="px-4 pt-2 pb-2 flex items-center gap-1">
          <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5 flex-1">
            {tabs.map((t) => {
              const isSel = tabKey === t.key;
              return (
                <button
                  key={t.key} type="button"
                  onClick={() => setTabKey(t.key)}
                  className={cx(
                    "flex-1 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-all",
                    isSel
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {/* 全折りたたみ / 展開（出勤タブのみ） */}
          {tabKey === "shukkin" && visibleShiftPatterns.length > 1 && (
            <button
              type="button"
              onClick={() => {
                if (collapsedPatterns.size < visibleShiftPatterns.length) {
                  setCollapsedPatterns(new Set(visibleShiftPatterns.map(p => p.name)));
                } else {
                  setCollapsedPatterns(new Set());
                }
              }}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 whitespace-nowrap transition-colors border border-zinc-200 dark:border-zinc-700"
            >
              {collapsedPatterns.size < visibleShiftPatterns.length ? "全畳" : "全開"}
            </button>
          )}
        </div>

      </div>

      {/* ━━ コンテンツ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="pt-0">

        {/* ── 出勤タブ: 月次一覧テーブル ── */}
        {tabKey === "shukkin" && (
          <>
            {/* ── 日付ヘッダーストリップ（sticky・overflow-x コンテナ外） ── */}
            <div
              className="sticky z-20 flex bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-700"
              style={{ top: "var(--page-header-h, 0px)" }}
            >
              {/* 左コーナー */}
              <div className="sticky left-0 z-30 w-20 flex-shrink-0 h-12 px-2 flex items-end pb-2 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-700">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">日付</span>
              </div>
              {/* 日付ボタン群（overflow:hidden → translateX で同期） */}
              <div className="overflow-hidden flex-1">
                <div ref={headerInnerRef} className="flex">
                  <div className="flex pr-2">
                    {allDates.map(d => {
                      const dt        = new Date(d);
                      const dateNum   = dt.getUTCDate();
                      const dayOfWeek = dt.getUTCDay();
                      const dow       = WEEKDAY_JP[dayOfWeek];
                      const isSel     = d === selectedDate;
                      const isToday   = d === todayStr;
                      const isSun     = dayOfWeek === 0;
                      const isSat     = dayOfWeek === 6;
                      const hasLog    = (logsByDate.get(d)?.length ?? 0) > 0;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => onDateChange(d)}
                          className={cx(
                            "w-11 flex-shrink-0 h-12 flex flex-col items-center justify-center gap-0.5 relative transition-colors",
                            isSel
                              ? "bg-zinc-900 dark:bg-zinc-100"
                              : isSun ? "bg-red-50 dark:bg-red-950/20 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                              : isSat ? "bg-blue-50/40 dark:bg-blue-950/10 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                              : "bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                          )}
                        >
                          {isToday && !isSel && (
                            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-500" />
                          )}
                          {hasLog && !isSel && (
                            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-orange-400" />
                          )}
                          <span className={cx(
                            "text-[9px] font-medium leading-none",
                            isSel  ? "text-zinc-500 dark:text-zinc-500"
                            : isSun ? "text-red-400" : isSat ? "text-blue-400" : "text-zinc-400 dark:text-zinc-500",
                          )}>{dow}</span>
                          <span className={cx(
                            "text-sm font-bold tabular-nums leading-none",
                            isSel    ? "text-white dark:text-zinc-900"
                            : isToday ? "text-blue-600 dark:text-blue-400"
                            : isSun   ? "text-red-500"
                            : isSat   ? "text-blue-500"
                                      : "text-zinc-700 dark:text-zinc-300",
                          )}>{dateNum}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              {/* 合計列ヘッダー（右固定） */}
              <div className="sticky right-0 z-30 w-16 flex-shrink-0 h-12 flex items-end pb-2 justify-center bg-white dark:bg-zinc-900 border-l-2 border-zinc-300 dark:border-zinc-600">
                <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">合計</span>
              </div>
            </div>

            {/* ── データテーブル（パターン軸 / スタッフ軸 切り替え） ── */}
            {!sortByAccount ? (
              /* ── パターン軸ビュー（デフォルト） ── */
              <div
                ref={stripRef}
                className="overflow-x-auto border-b border-zinc-100 dark:border-zinc-800"
                style={{ scrollbarWidth: "none" }}
                onScroll={(e) => syncHeader(e.currentTarget.scrollLeft)}
              >
                <div className="flex min-w-max bg-white dark:bg-zinc-900">

                  {/* ── 左固定列（パターン名） ── */}
                  <div className="sticky left-0 z-20 w-20 flex-shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-700">
                    {visibleShiftPatterns.map((pattern, gi, arr) => {
                      const maxSlots  = patternMaxSlots.get(pattern.name) ?? 0;
                      const isCollapsed = collapsedPatterns.has(pattern.name);
                      const isLast    = gi === arr.length - 1;
                      return (
                        <div key={pattern.name} className={cx("flex flex-col", isLast ? "" : "border-b border-zinc-200 dark:border-zinc-700")}>
                          <button
                            type="button"
                            onClick={() => togglePattern(pattern.name)}
                            className="h-9 flex items-center gap-1 px-2 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-100 dark:border-zinc-700/60 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 transition-colors"
                          >
                            <span className="text-[10px] font-bold text-zinc-700 dark:text-zinc-300 truncate flex-1 text-left leading-tight" title={pattern.name}>
                              {pattern.name}
                            </span>
                            <svg
                              className={cx("w-2.5 h-2.5 text-zinc-400 flex-shrink-0 transition-transform", isCollapsed ? "-rotate-90" : "")}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {!isCollapsed && Array.from({ length: maxSlots }).map((_, i) => (
                            <div key={i} className={cx("h-8", i < maxSlots - 1 ? "border-b border-zinc-50 dark:border-zinc-800/50" : "")} />
                          ))}
                        </div>
                      );
                    })}
                  </div>

                  {/* ── 日付列 ── */}
                  <div className="flex pr-4">
                    {allDates.map(d => {
                      const isSel     = d === selectedDate;
                      const dayOfWeek = new Date(d).getUTCDay();
                      const isSun     = dayOfWeek === 0;
                      const isSat     = dayOfWeek === 6;

                      return (
                        <div
                          key={d}
                          className={cx(
                            "w-11 flex-shrink-0 flex flex-col",
                            isSel
                              ? "bg-blue-50/80 dark:bg-blue-950/20"
                              : (isSun || isSat) ? "bg-red-50/20 dark:bg-red-950/10" : "",
                          )}
                        >
                          {visibleShiftPatterns.map((pattern, gi, arr) => {
                            const maxSlots    = patternMaxSlots.get(pattern.name) ?? 0;
                            const isCollapsed = collapsedPatterns.has(pattern.name);
                            const staffOnDay  = visibleMembers.filter(m => getShift(m.id, d)?.shift_name === pattern.name);
                            const req         = getReqForDate(pattern, d);
                            const actual      = staffOnDay.filter(m => !isChurnExcluded(m.id, d)).length;
                            const isLastGrp   = gi === arr.length - 1;

                            return (
                              <div key={pattern.name} className={cx("flex flex-col", isLastGrp ? "" : "border-b border-zinc-200 dark:border-zinc-700")}>
                                {/* 充足数行 (h-9) */}
                                <div className="h-9 flex items-center justify-center border-b border-zinc-100 dark:border-zinc-700/60 bg-zinc-50/50 dark:bg-zinc-800/30">
                                  {pattern.section === "SV" ? (
                                    <span className="tabular-nums text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                                      {actual > 0 ? actual : "—"}
                                    </span>
                                  ) : req > 0 ? (
                                    <div className="flex flex-col items-center gap-px">
                                      <span className={cx(
                                        "tabular-nums text-[11px] font-bold leading-none",
                                        actual > req ? "text-emerald-600 dark:text-emerald-400"
                                        : actual < req ? "text-red-500 dark:text-red-400"
                                        : "text-emerald-600 dark:text-emerald-400",
                                      )}>{actual}/{req}</span>
                                      <span className={cx(
                                        "tabular-nums text-[8px] font-bold leading-none",
                                        actual > req ? "text-emerald-500 dark:text-emerald-400"
                                        : actual < req ? "text-red-400 dark:text-red-500"
                                        : "text-zinc-300 dark:text-zinc-600",
                                      )}>
                                        {actual > req ? `+${actual - req}人`
                                        : actual < req ? `-${req - actual}人`
                                        : "✓"}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-[9px] text-zinc-200 dark:text-zinc-700">—</span>
                                  )}
                                </div>
                                {/* スタッフ行 (h-8 each) */}
                                {!isCollapsed && Array.from({ length: maxSlots }).map((_, slotIdx) => {
                                  const member = staffOnDay[slotIdx];
                                  const absent = member ? isAbsent(member.id, d) : false;
                                  return (
                                    <div
                                      key={slotIdx}
                                      className={cx(
                                        "h-8 flex items-center justify-center w-full",
                                        slotIdx < maxSlots - 1 ? "border-b border-zinc-50 dark:border-zinc-800/50" : "",
                                        absent ? "bg-red-50 dark:bg-red-950/30" : "",
                                      )}
                                    >
                                      {member ? (
                                        <button
                                          type="button"
                                          onClick={() => setStaffInfoTarget(member)}
                                          className={cx(
                                            "text-[10px] font-semibold leading-none truncate px-0.5 hover:underline",
                                            absent
                                              ? "text-red-600 dark:text-red-400"
                                              : isSel ? "text-blue-700 dark:text-blue-300" : "text-zinc-700 dark:text-zinc-300",
                                          )}
                                        >
                                          {shortName(member.name)}
                                        </button>
                                      ) : slotIdx < req ? (
                                        <span className="w-4 h-px bg-zinc-100 dark:bg-zinc-800 rounded-full" />
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>

                  {/* ── 合計列（右固定） ── */}
                  <div className="sticky right-0 z-20 w-16 flex-shrink-0 bg-white dark:bg-zinc-900 border-l-2 border-zinc-300 dark:border-zinc-600">
                    {visibleShiftPatterns.map((pattern, gi, arr) => {
                      const isCollapsed = collapsedPatterns.has(pattern.name);
                      const maxSlots    = patternMaxSlots.get(pattern.name) ?? 0;
                      const isLastGrp   = gi === arr.length - 1;
                      const isSV        = pattern.section === "SV";

                      const totalActual   = allDates.reduce((s, d) =>
                        s + visibleMembers.filter(m => getShift(m.id, d)?.shift_name === pattern.name && !isChurnExcluded(m.id, d)).length, 0);
                      const totalRequired = isSV ? 0 : allDates.reduce((s, d) => s + getReqForDate(pattern, d), 0);
                      const net           = totalRequired - totalActual;

                      return (
                        <div key={pattern.name} className={cx("flex flex-col", isLastGrp ? "" : "border-b border-zinc-200 dark:border-zinc-700")}>
                          <div className="h-9 flex flex-col items-center justify-center border-b border-zinc-100 dark:border-zinc-700/60 bg-zinc-100/60 dark:bg-zinc-800/50">
                            {isSV ? (
                              <span className="tabular-nums text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                                {totalActual > 0 ? totalActual : "—"}
                              </span>
                            ) : totalRequired > 0 ? (
                              <>
                                <span className={cx(
                                  "tabular-nums text-[11px] font-bold leading-none",
                                  net > 0 ? "text-red-500 dark:text-red-400"
                                  : net < 0 ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-emerald-600 dark:text-emerald-400",
                                )}>{totalActual}/{totalRequired}</span>
                                <span className={cx(
                                  "tabular-nums text-[9px] font-bold leading-none mt-0.5",
                                  net > 0 ? "text-red-400 dark:text-red-500"
                                  : net < 0 ? "text-emerald-500 dark:text-emerald-400"
                                  : "text-zinc-300 dark:text-zinc-600",
                                )}>
                                  {net > 0 ? `-${net}人` : net < 0 ? `+${-net}人` : "✓"}
                                </span>
                              </>
                            ) : (
                              <span className="text-[9px] text-zinc-200 dark:text-zinc-700">—</span>
                            )}
                          </div>
                          {!isCollapsed && Array.from({ length: maxSlots }).map((_, i) => (
                            <div key={i} className={cx("h-8", i < maxSlots - 1 ? "border-b border-zinc-50 dark:border-zinc-800/50" : "")} />
                          ))}
                        </div>
                      );
                    })}
                  </div>

                </div>
              </div>
            ) : (
              /* ── スタッフ行ビュー（番号順） ── */
              <>
              {/* 名前検索 */}
              <div className="px-3 py-2 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
                <input
                  type="search"
                  placeholder="名前で絞り込み…"
                  value={nameFilter}
                  onChange={e => setNameFilter(e.target.value)}
                  className="w-full max-w-xs px-3 py-1.5 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 border border-transparent focus:border-blue-400 dark:focus:border-blue-500 outline-none transition-colors"
                />
              </div>
              <div
                ref={stripRef}
                className="overflow-x-auto border-b border-zinc-100 dark:border-zinc-800"
                style={{ scrollbarWidth: "none" }}
                onScroll={(e) => syncHeader(e.currentTarget.scrollLeft)}
              >
                {(() => {
                  const filtered = nameFilter.trim()
                    ? visibleMembers.filter(m => m.name.includes(nameFilter.trim()))
                    : visibleMembers;
                  return (
                <div className="flex min-w-max bg-white dark:bg-zinc-900">

                  {/* 左固定列（スタッフ名） */}
                  <div className="sticky left-0 z-20 w-20 flex-shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-700">
                    {filtered.map((m, i) => {
                      const isRisk = churnRiskSinceMap.has(m.id);
                      return (
                      <div key={m.id} className={cx(
                        "h-9 flex flex-col justify-center px-2",
                        i < filtered.length - 1 ? "border-b border-zinc-100 dark:border-zinc-800" : "",
                        isRisk ? "bg-red-50 dark:bg-red-950/30" : "",
                      )}>
                        <span className="text-[9px] font-medium text-zinc-400 dark:text-zinc-500 leading-none truncate">
                          {m.section ?? "—"}
                        </span>
                        <div className="flex items-center gap-1 mt-0.5">
                          <button
                            type="button"
                            onClick={() => setStaffInfoTarget(m)}
                            className={cx(
                              "text-[10px] font-semibold hover:underline leading-tight truncate text-left",
                              isRisk ? "text-red-700 dark:text-red-300" : "text-zinc-700 dark:text-zinc-300",
                            )}
                          >
                            {shortName(m.name)}
                          </button>
                          {isRisk && (
                            <span className="text-[7px] font-bold px-0.5 py-px rounded bg-red-100 dark:bg-red-900/40 text-red-500 dark:text-red-400 leading-none shrink-0 whitespace-nowrap">
                              離脱
                            </span>
                          )}
                        </div>
                      </div>
                    );})}

                  </div>

                  {/* 日付列 */}
                  <div className="flex pr-4">
                    {allDates.map(d => {
                      const isSel     = d === selectedDate;
                      const dayOfWeek = new Date(d).getUTCDay();
                      const isSun     = dayOfWeek === 0;
                      const isSat     = dayOfWeek === 6;

                      return (
                        <div
                          key={d}
                          className={cx(
                            "w-11 flex-shrink-0 flex flex-col",
                            isSel ? "bg-blue-50/80 dark:bg-blue-950/20"
                            : (isSun || isSat) ? "bg-red-50/20 dark:bg-red-950/10" : "",
                          )}
                        >
                          {filtered.map((m, i) => {
                            const shift   = getShift(m.id, d);
                            const sName   = shift?.shift_name ?? null;
                            const absent  = isAbsent(m.id, d);
                            const churnCell = isChurnRiskCell(m.id, d);
                            const pattern = sName ? (patternByName.get(sName) ?? null) : null;
                            const patBg   = sName ? getPatternBg(sName, pattern) : "";
                            const offBg   =
                              (sName === "希望休" || sName === "有休" || sName === "特別休暇") ? "bg-zinc-700 dark:bg-zinc-700"
                              : sName === "公休" ? "bg-zinc-500 dark:bg-zinc-600"
                              : "";
                            const cellBg  = absent ? "bg-red-50 dark:bg-red-950/30" : offBg || patBg;
                            return (
                              <div
                                key={m.id}
                                className={cx(
                                  "h-9 flex flex-col items-center justify-center w-full relative",
                                  i < filtered.length - 1 ? "border-b border-zinc-50 dark:border-zinc-800/50" : "",
                                  cellBg,
                                  churnCell ? "ring-inset ring-1 ring-red-400 dark:ring-red-500" : "",
                                )}
                              >
                                {sName ? (
                                  <>
                                    <span className={cx(
                                      "text-[10px] font-semibold leading-none truncate px-0.5",
                                      absent ? "text-red-600 dark:text-red-400"
                                      : offBg ? "text-white"
                                      : patBg ? "text-zinc-800 dark:text-zinc-100"
                                      : isSel ? "text-blue-700 dark:text-blue-300"
                                      : "text-zinc-700 dark:text-zinc-300",
                                    )}>
                                      {shiftAbbr(sName)}
                                    </span>
                                    {churnCell && (
                                      <span className="text-[6px] leading-none font-bold text-red-500 dark:text-red-400 whitespace-nowrap">離脱リスク</span>
                                    )}
                                  </>
                                ) : onSetKyukyu ? (
                                  <button
                                    type="button"
                                    onClick={() => onSetKyukyu(m.id, d)}
                                    className="w-full h-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                                    title="公休にする"
                                  >
                                    <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500">休</span>
                                  </button>
                                ) : (
                                  <span className="w-2 h-px bg-zinc-100 dark:bg-zinc-800 rounded-full" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>

                  {/* 合計列（右固定）：出勤日数 */}
                  <div className="sticky right-0 z-20 w-16 flex-shrink-0 bg-white dark:bg-zinc-900 border-l-2 border-zinc-300 dark:border-zinc-600">
                    {filtered.map((m, i) => {
                      const workCount = allDates.filter(d => {
                        const sn = getShift(m.id, d)?.shift_name;
                        return sn && sn !== "公休" && sn !== "希望休";
                      }).length;
                      return (
                        <div key={m.id} className={cx(
                          "h-9 flex items-center justify-center",
                          i < filtered.length - 1 ? "border-b border-zinc-100 dark:border-zinc-800" : "",
                        )}>
                          <span className="tabular-nums text-[11px] font-bold text-zinc-600 dark:text-zinc-400">
                            {workCount > 0 ? workCount : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                </div>
                  );
                })()}
              </div>
              </>
            )}
          </>
        )}

        {/* ── 公休 / 希望休タブ: 月次テーブル ── */}
        {(tabKey === "kyukyu" || tabKey === "kiboshu") && (() => {
          const targetName = tabKey === "kyukyu" ? "公休" : "希望休";
          const maxActual  = allDates.length > 0
            ? Math.max(1, ...allDates.map(d => visibleMembers.filter(m => getShift(m.id, d)?.shift_name === targetName).length))
            : 1;
          return (
            <>
              {/* ── 日付ヘッダーストリップ（sticky） ── */}
              <div
                className="sticky z-20 flex bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-700"
                style={{ top: "var(--page-header-h, 0px)" }}
              >
                <div className="sticky left-0 z-30 w-20 flex-shrink-0 h-12 px-2 flex items-end pb-2 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-700">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">日付</span>
                </div>
                <div className="overflow-hidden flex-1">
                  <div ref={headerInnerRef} className="flex">
                    <div className="flex pr-4">
                      {allDates.map(d => {
                        const dt        = new Date(d);
                        const dateNum   = dt.getUTCDate();
                        const dayOfWeek = dt.getUTCDay();
                        const dow       = WEEKDAY_JP[dayOfWeek];
                        const isSel     = d === selectedDate;
                        const isToday   = d === todayStr;
                        const isSun     = dayOfWeek === 0;
                        const isSat     = dayOfWeek === 6;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => onDateChange(d)}
                            className={cx(
                              "w-11 flex-shrink-0 h-12 flex flex-col items-center justify-center gap-0.5 relative transition-colors",
                              isSel
                                ? "bg-zinc-900 dark:bg-zinc-100"
                                : isSun ? "bg-red-50 dark:bg-red-950/20 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                                : isSat ? "bg-blue-50/40 dark:bg-blue-950/10 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                                : "bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                            )}
                          >
                            {isToday && !isSel && (
                              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-500" />
                            )}
                            <span className={cx(
                              "text-[9px] font-medium leading-none",
                              isSel  ? "text-zinc-500 dark:text-zinc-500"
                              : isSun ? "text-red-400" : isSat ? "text-blue-400" : "text-zinc-400 dark:text-zinc-500",
                            )}>{dow}</span>
                            <span className={cx(
                              "text-sm font-bold tabular-nums leading-none",
                              isSel    ? "text-white dark:text-zinc-900"
                              : isToday ? "text-blue-600 dark:text-blue-400"
                              : isSun   ? "text-red-500" : isSat ? "text-blue-500" : "text-zinc-700 dark:text-zinc-300",
                            )}>{dateNum}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── データテーブル ── */}
              <div
                ref={stripRef}
                className="overflow-x-auto border-b border-zinc-100 dark:border-zinc-800"
                style={{ scrollbarWidth: "none" }}
                onScroll={(e) => syncHeader(e.currentTarget.scrollLeft)}
              >
              <div className="flex min-w-max bg-white dark:bg-zinc-900">

                {/* 左固定列 */}
                <div className="sticky left-0 z-20 w-20 flex-shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-700">
                  <div className="h-9 px-2 flex items-center bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-100 dark:border-zinc-700/60">
                    <span className="text-[10px] font-bold text-zinc-700 dark:text-zinc-300">{targetName}</span>
                  </div>
                  {Array.from({ length: maxActual }).map((_, i) => (
                    <div key={i} className={cx("h-8", i < maxActual - 1 ? "border-b border-zinc-50 dark:border-zinc-800/50" : "")} />
                  ))}
                </div>

                {/* 日付列 */}
                <div className="flex pr-4">
                  {allDates.map(d => {
                    const isSel      = d === selectedDate;
                    const dayOfWeek  = new Date(d).getUTCDay();
                    const isSun      = dayOfWeek === 0;
                    const isSat      = dayOfWeek === 6;
                    const staffOnDay = visibleMembers.filter(m => getShift(m.id, d)?.shift_name === targetName);

                    return (
                      <div
                        key={d}
                        className={cx(
                          "w-11 flex-shrink-0 flex flex-col",
                          isSel
                            ? "bg-blue-50/80 dark:bg-blue-950/20"
                            : (isSun || isSat) ? "bg-red-50/20 dark:bg-red-950/10" : "",
                        )}
                      >
                        {/* 件数行 */}
                        <div className="h-9 flex items-center justify-center border-b border-zinc-100 dark:border-zinc-700/60 bg-zinc-50/50 dark:bg-zinc-800/30">
                          <span className={cx(
                            "tabular-nums text-[11px] font-bold leading-none",
                            staffOnDay.length > 0 ? "text-zinc-600 dark:text-zinc-400" : "text-zinc-200 dark:text-zinc-700",
                          )}>
                            {staffOnDay.length > 0 ? staffOnDay.length : "—"}
                          </span>
                        </div>

                        {/* スタッフ行 */}
                        {Array.from({ length: maxActual }).map((_, slotIdx) => {
                          const member = staffOnDay[slotIdx];
                          return (
                            <div
                              key={slotIdx}
                              className={cx(
                                "h-8 flex items-center justify-center w-full",
                                slotIdx < maxActual - 1 ? "border-b border-zinc-50 dark:border-zinc-800/50" : "",
                              )}
                            >
                              {member && (() => {
                                const priority = tabKey === "kiboshu"
                                  ? offRequestMap.get(`${member.id}__${d}`)
                                  : undefined;
                                const label = priority ? PRIORITY_LABEL[priority] : undefined;
                                const color = priority ? PRIORITY_COLOR[priority] : undefined;
                                return (
                                  <button
                                    type="button"
                                    onClick={() => setStaffInfoTarget(member)}
                                    className={cx(
                                      "text-[10px] font-semibold leading-none truncate px-0.5 hover:underline flex items-center gap-px",
                                      isSel ? "text-blue-700 dark:text-blue-300" : "text-zinc-700 dark:text-zinc-300",
                                    )}
                                  >
                                    {label && (
                                      <span className={cx("text-[9px] font-bold flex-shrink-0", color ?? "")}>{label}</span>
                                    )}
                                    {shortName(member.name)}
                                  </button>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

              </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* ── 選択日の変更ログ ── */}
      {(() => {
        const logs = logsByDate.get(selectedDate) ?? [];
        if (logs.length === 0) return null;
        const staffById = new Map(activeMembers.map(m => [m.id, m.name]));
        return (
          <div className="mx-4 mt-3 mb-2 rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 overflow-hidden">
            <div className="px-3 py-2 flex items-center gap-1.5 border-b border-orange-200 dark:border-orange-800">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
              <p className="text-[11px] font-bold text-orange-700 dark:text-orange-300">
                {selectedDate} の変更ログ（{logs.length}件）
              </p>
            </div>
            <div className="divide-y divide-orange-100 dark:divide-orange-900/40">
              {logs.map((log, i) => {
                const name = staffById.get(log.staff_id) ?? log.staff_id;
                const from = log.before_shift_name ?? "（なし）";
                const to   = log.after_shift_name  ?? "（削除）";
                const at   = new Date(log.changed_at).toLocaleString("ja-JP", {
                  timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
                  hour: "2-digit", minute: "2-digit",
                });
                return (
                  <div key={i} className="px-3 py-1.5 flex items-baseline gap-2 text-[11px]">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300 flex-shrink-0">{name}</span>
                    <span className="text-zinc-500">
                      {from} → {to}
                    </span>
                    <span className="ml-auto text-zinc-400 flex-shrink-0 tabular-nums">{log.changed_by_name} {at}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* スタッフ情報パネル */}
      {staffInfoTarget && (
        <StaffInfoPanel
          member={{
            id:                   staffInfoTarget.id,
            name:                 staffInfoTarget.name,
            section:              staffInfoTarget.section,
            sections:             staffInfoTarget.sections,
            work_days_type:       staffInfoTarget.work_days_type ?? null,
            work_days_count:      staffInfoTarget.work_days_count ?? null,
            preferred_shift:      staffInfoTarget.preferred_shift ?? null,
            preferred_section:    staffInfoTarget.preferred_section ?? null,
            max_consecutive_days: staffInfoTarget.max_consecutive_days ?? null,
            shift_note:           staffInfoTarget.shift_note ?? null,
            endDate:              staffInfoTarget.endDate,
          }}
          projectId={projectId}
          availableSections={availableSections ?? []}
          shiftPatternNames={shiftPatternNames ?? []}
          onClose={() => setStaffInfoTarget(null)}
        />
      )}

      {staffMenu && (
        <StaffPopupMenu
          staffId={staffMenu.staffId}
          staffName={staffMenu.staffName}
          projectId={projectId}
          onClose={() => setStaffMenu(null)}
        />
      )}
    </>
  );
}
