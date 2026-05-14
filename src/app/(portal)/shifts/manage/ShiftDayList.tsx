"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertShiftAction, deleteShiftAction, swapShiftsAction } from "../actions";
import { requestExtraShiftByLineAction, type LineRequestResult } from "./actions";

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
type Member  = { id: string; name: string; role: string; section: string | null };
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

/** パターンが何らかの必要数設定を持つか */
function hasAnyRequired(p: Pattern): boolean {
  return p.required_count > 0 || p.required_weekday != null || p.required_weekend != null;
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

function ModalWrap({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-6 shadow-2xl max-h-[85dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

type TabKey = "shukkin" | "kyukyu" | "kiboshu";
// add: 空き枠クリック | action: 既存シフト選択 | change: 内容変更 | swap: スタッフ入れ替え | line: LINE出勤依頼
type ModalMode = "add" | "action" | "change" | "swap" | "line";

type EligibilityResult = {
  weekRestsIfWork: number;
  consecutiveDays: number;
  canWork: boolean;
  weekWarning: boolean;
  consecutiveWarning: boolean;
};

/** 公休スタッフがその日出勤した場合の週休・連勤を判定 */
function analyzeWorkEligibility(
  memberId: string,
  date: string,
  allDates: string[],
  shiftMap: Map<string, Shift>,
): EligibilityResult {
  const isRest = (s: string | null | undefined) => !s || s === "公休" || s === "希望休";
  const getS   = (d: string) => shiftMap.get(`${memberId}__${d}`)?.shift_name ?? null;
  const dateIdx = allDates.indexOf(date);

  // 週（月〜日）の休日数：この日を出勤扱いで計算
  const dt      = new Date(date + "T00:00:00+09:00");
  const dow     = dt.getDay();
  const toMon   = dow === 0 ? -6 : 1 - dow;
  const monday  = new Date(dt.getTime() + toMon * 86400000);
  const sunday  = new Date(monday.getTime() + 6 * 86400000);
  const weekDates = allDates.filter(d => {
    const dd = new Date(d + "T00:00:00+09:00");
    return dd >= monday && dd <= sunday;
  });
  const weekRestsIfWork = weekDates.filter(d => d !== date && isRest(getS(d))).length;

  // 連続勤務日数：この日を出勤扱いで前後を数える
  let before = 0, after = 0;
  for (let i = dateIdx - 1; i >= 0; i--) {
    if (isRest(getS(allDates[i]))) break;
    before++;
  }
  for (let i = dateIdx + 1; i < allDates.length; i++) {
    if (isRest(getS(allDates[i]))) break;
    after++;
  }
  const consecutiveDays = before + 1 + after;

  return {
    weekRestsIfWork,
    consecutiveDays,
    canWork:             weekRestsIfWork >= 2 && consecutiveDays < 5,
    weekWarning:         weekRestsIfWork < 2,
    consecutiveWarning:  consecutiveDays >= 5,
  };
}

// "HH:MM" or "HH:MM:SS" → 分に変換
const timeToMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** シフト割当前のアラートを計算 */
function getShiftAlerts(
  staffId: string,
  date: string,
  shiftName: string,
  allDates: string[],
  shiftMap: Map<string, Shift>,
  shiftPatterns: Pattern[],
): string[] {
  if (!staffId || !shiftName) return [];

  const alerts: string[] = [];
  const getShift = (d: string) => shiftMap.get(`${staffId}__${d}`) ?? null;
  const getS     = (d: string) => getShift(d)?.shift_name ?? null;
  const isRest   = (s: string | null) => !s || s === "公休" || s === "希望休";
  const dateIdx  = allDates.indexOf(date);
  if (dateIdx < 0) return [];

  const newIsRest  = isRest(shiftName);
  const newPattern = shiftPatterns.find((p) => p.name === shiftName);

  if (!newIsRest) {
    // ── 連続勤務チェック ────────────────────────────
    let before = 0, after = 0;
    for (let i = dateIdx - 1; i >= 0; i--) {
      if (isRest(getS(allDates[i]))) break;
      before++;
    }
    for (let i = dateIdx + 1; i < allDates.length; i++) {
      if (isRest(getS(allDates[i]))) break;
      after++;
    }
    const consecutive = before + 1 + after;
    if (consecutive >= 5) {
      alerts.push(`${consecutive}連勤になります`);
    }

    // ── 同一シフト連続チェック ──────────────────────
    let sameBefore = 0, sameAfter = 0;
    for (let i = dateIdx - 1; i >= 0; i--) {
      if (getS(allDates[i]) !== shiftName) break;
      sameBefore++;
    }
    for (let i = dateIdx + 1; i < allDates.length; i++) {
      if (getS(allDates[i]) !== shiftName) break;
      sameAfter++;
    }
    const sameConsecutive = sameBefore + 1 + sameAfter;
    if (sameConsecutive >= 3) {
      alerts.push(`「${shiftName}」が${sameConsecutive}日連続になります`);
    }

    // ── 勤務間インターバルチェック（11時間未満を警告）──
    // 前日終業 → 今日始業
    if (dateIdx > 0 && newPattern?.start_time) {
      const prevShift = getShift(allDates[dateIdx - 1]);
      const prevEnd   = prevShift?.shift_end
        ?? shiftPatterns.find((p) => p.name === prevShift?.shift_name)?.end_time
        ?? null;
      if (prevEnd && !isRest(prevShift?.shift_name ?? null)) {
        const restMin = (timeToMin(newPattern.start_time) + 24 * 60) - timeToMin(prevEnd);
        if (restMin < 15 * 60) {
          alerts.push(`前日終業から始業まで${Math.floor(restMin / 60)}時間しかありません（インターバル不足）`);
        }
      }
    }
    // 今日終業 → 翌日始業
    if (dateIdx < allDates.length - 1 && newPattern?.end_time) {
      const nextShift = getShift(allDates[dateIdx + 1]);
      const nextStart = nextShift?.shift_start
        ?? shiftPatterns.find((p) => p.name === nextShift?.shift_name)?.start_time
        ?? null;
      if (nextStart && !isRest(nextShift?.shift_name ?? null)) {
        const restMin = (timeToMin(nextStart) + 24 * 60) - timeToMin(newPattern.end_time);
        if (restMin < 15 * 60) {
          alerts.push(`翌日始業まで${Math.floor(restMin / 60)}時間しかありません（インターバル不足）`);
        }
      }
    }
  }

  // ── 今週（月〜日）の週休チェック ──────────────────
  const dt  = new Date(date + "T00:00:00+09:00");
  const dow = dt.getDay();
  const toMonday = dow === 0 ? -6 : 1 - dow;
  const monday   = new Date(dt.getTime() + toMonday * 86400000);
  const sunday   = new Date(monday.getTime() + 6 * 86400000);
  const weekDates = allDates.filter((d) => {
    const dd = new Date(d + "T00:00:00+09:00");
    return dd >= monday && dd <= sunday;
  });
  const restInWeek = weekDates.filter((d) => {
    const s = d === date ? shiftName : getS(d);
    return isRest(s);
  }).length;
  if (weekDates.length >= 5) {
    if (restInWeek === 0) {
      alerts.push("今週（月〜日）の休日が0日になります");
    } else if (restInWeek === 1) {
      alerts.push("今週（月〜日）の休日が1日です（週休2日未満）");
    }
  }

  return alerts;
}

/** アラート表示コンポーネント */
function ShiftAlerts({ alerts }: { alerts: string[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {alerts.map((alert, i) => (
        <div key={i} className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/50">
          <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">{alert}</p>
        </div>
      ))}
    </div>
  );
}

type SlotReq = { section: string; pattern_name: string; shift_date: string; required_count: number };

export default function ShiftDayList({
  allDates, shifts, activeMembers, shiftPatterns, slotRequirements, selectedDate, onDateChange, projectId,
}: {
  allDates: string[];
  shifts: Shift[];
  activeMembers: Member[];
  shiftPatterns: Pattern[];
  slotRequirements?: SlotReq[];
  selectedDate: string;
  onDateChange: (date: string) => void;
  projectId: string;
  targetYear: number;
  targetMonth: number;
}) {
  const router = useRouter();
  const [isPending, startTransition]      = useTransition();
  const [error, setError]                 = useState<string | null>(null);
  const [tabKey, setTabKey]               = useState<TabKey>("shukkin");
  const [sectionFilter, setSectionFilter] = useState<string | null>(null);
  // パターンごとの折りたたみ状態
  const [collapsedPatterns, setCollapsedPatterns] = useState<Set<string>>(new Set());
  // スワイプ検出
  const touchStartX = useRef<number | null>(null);
  // 月次ストリップの横スクロールコンテナ
  const stripRef = useRef<HTMLDivElement>(null);

  // 選択日が変わったらストリップを中央にスクロール
  useEffect(() => {
    if (!stripRef.current) return;
    const LEFT_COL = 80;  // w-20
    const COL_W    = 44;  // w-11
    const idx = allDates.indexOf(selectedDate);
    if (idx < 0) return;
    const target = LEFT_COL + idx * COL_W - (stripRef.current.clientWidth - LEFT_COL) / 2 + COL_W / 2;
    stripRef.current.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [selectedDate, allDates]);
  const togglePattern = (name: string) => setCollapsedPatterns(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  // セクション一覧（nullでない値のみ・ソート）
  const sections = [...new Set(activeMembers.map(m => m.section).filter((s): s is string => !!s))].sort();
  const hasSection = sections.length > 0;
  // フィルター適用済みメンバー
  const visibleMembers = sectionFilter
    ? activeMembers.filter(m => m.section === sectionFilter)
    : activeMembers;

  // シフトルックアップ
  const shiftMap = new Map<string, Shift>(shifts.map((s) => [`${s.staff_id}__${s.shift_date}`, s]));
  const getShift = (sid: string, d: string) => shiftMap.get(`${sid}__${d}`);

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

  // モーダル
  const [modalMode,    setModalMode]    = useState<ModalMode>("add");
  const [modalOpen,    setModalOpen]    = useState(false);
  const [editShift,    setEditShift]    = useState<Shift | null>(null);
  const [modalDate,    setModalDate]    = useState(selectedDate);
  const [modalStaffId, setModalStaffId] = useState("");
  const [name,  setName]  = useState("");
  const [start, setStart] = useState("");
  const [end,   setEnd]   = useState("");
  const [note,  setNote]  = useState("");

  // LINE依頼モーダル用
  const [lineMessage,    setLineMessage]    = useState("");
  const [lineResult,     setLineResult]     = useState<LineRequestResult | null>(null);
  const [selectedOffIds, setSelectedOffIds] = useState<Set<string>>(new Set());

  const toggleOffId = (id: string) => setSelectedOffIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // add モード用：固定パターン名（変更不可）
  const [lockedPattern, setLockedPattern] = useState<string | null>(null);

  const parseDayInfo = (d: string) => {
    const dt = new Date(d + "T00:00:00+09:00");
    return {
      dateNum: dt.getDate(),
      dow: WEEKDAY_JP[dt.getDay()],
      dayOfWeek: dt.getDay(),
    };
  };

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
    // +1 で充足後も余剰配置できる空きスロットを常に1つ確保
    patternMaxSlots.set(pattern.name, Math.max(maxReq, maxActual) + 1);
  }
  const visibleShiftPatterns = shiftPatterns.filter(p => (patternMaxSlots.get(p.name) ?? 0) > 0);

  // 指定日にシフト未割当のメンバー（セクションフィルター適用）
  const unassignedMembersForDate = (date: string) =>
    visibleMembers.filter((m) => !getShift(m.id, date));

  // ── モーダルを開く ────────────────────────────────────────────

  // 空き枠クリック：パターン固定・未割当スタッフのみ
  const openEmpty = (date: string, patternName: string) => {
    setEditShift(null);
    setModalMode("add");
    setModalDate(date);
    setModalStaffId("");
    setLockedPattern(patternName);
    setName(patternName);
    const p = shiftPatterns.find((p) => p.name === patternName);
    setStart(p?.start_time?.slice(0, 5) ?? "");
    setEnd(p?.end_time?.slice(0, 5) ?? "");
    setNote("");
    setError(null);
    setLineMessage("");
    setLineResult(null);
    // 公休スタッフの適格チェック：週休2日を保てて5連勤未満の人を自動選択
    const lockedSec = p?.section ?? null;
    const safeIds = new Set(
      activeMembers
        .filter(m =>
          getShift(m.id, date)?.shift_name === "公休" &&
          (!lockedSec || m.section === lockedSec) &&
          analyzeWorkEligibility(m.id, date, allDates, shiftMap).canWork
        )
        .map(m => m.id)
    );
    setSelectedOffIds(safeIds);
    setModalOpen(true);
  };

  // 公休/希望休タブの空き枠クリック（パターン固定）
  const openEmptyOff = (date: string, patternName: "公休" | "希望休") => {
    setEditShift(null);
    setModalMode("add");
    setModalDate(date);
    setModalStaffId("");
    setLockedPattern(patternName);
    setName(patternName);
    setStart(""); setEnd(""); setNote("");
    setError(null);
    setModalOpen(true);
  };

  // 既存シフトクリック：アクション選択
  const openOccupied = (member: Member, date: string) => {
    const shift = getShift(member.id, date)!;
    setEditShift(shift);
    setModalMode("action");
    setModalDate(date);
    setModalStaffId(member.id);
    setName(shift.shift_name ?? "");
    setStart(shift.shift_start?.slice(0, 5) ?? "");
    setEnd(shift.shift_end?.slice(0, 5) ?? "");
    setNote(shift.note ?? "");
    setLockedPattern(null);
    setError(null);
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  // ── アクション ───────────────────────────────────────────────

  const handleSubmit = () => {
    if (!modalStaffId) { setError("社員を選択してください"); return; }
    if (!name)         { setError("シフト名を入力してください"); return; }
    const fd = new FormData();
    if (editShift) fd.set("id", editShift.id);
    fd.set("projectId", projectId);
    fd.set("staffId",   modalStaffId);
    fd.set("shiftName", name);
    fd.set("shiftStart", start);
    fd.set("shiftEnd",   end);
    fd.set("shiftDate",  modalDate);
    fd.set("note",       note);
    startTransition(async () => {
      const r = await upsertShiftAction(fd);
      if (!r.success) setError(r.message ?? "登録失敗");
      else { closeModal(); router.refresh(); }
    });
  };

  const handleDelete = () => {
    if (!editShift) return;
    const fd = new FormData();
    fd.set("id", editShift.id);
    fd.set("projectId", projectId);
    startTransition(async () => {
      await deleteShiftAction(fd);
      closeModal();
      router.refresh();
    });
  };

  const handleSwap = (staffIdB: string) => {
    if (!editShift) return;
    const fd = new FormData();
    fd.set("shiftIdA",  editShift.id);
    fd.set("staffIdB",  staffIdB);
    fd.set("projectId", projectId);
    startTransition(async () => {
      const r = await swapShiftsAction(fd);
      if (!r.success) setError(r.message ?? "入れ替え失敗");
      else { closeModal(); router.refresh(); }
    });
  };

  // ── タブ ─────────────────────────────────────────────────────
  const shukkinCount = shiftPatterns.reduce(
    (s, p) => s + visibleMembers.filter((m) => getShift(m.id, selectedDate)?.shift_name === p.name).length, 0
  );
  const tabs: { key: TabKey; label: string; badge: number }[] = [
    { key: "shukkin", label: "出勤", badge: shukkinCount },
    { key: "kyukyu",  label: "公休",
      badge: visibleMembers.filter((m) => getShift(m.id, selectedDate)?.shift_name === "公休").length },
    { key: "kiboshu", label: "希望休",
      badge: visibleMembers.filter((m) => getShift(m.id, selectedDate)?.shift_name === "希望休").length },
  ];

  // ── スワップ用：同日の他メンバー情報 ─────────────────────────
  const swapCandidates = modalStaffId
    ? visibleMembers
        .filter((m) => m.id !== modalStaffId)
        .map((m) => ({ ...m, currentShift: getShift(m.id, modalDate) ?? null }))
    : [];

  return (
    <>
      {/* ━━ sticky ヘッダー ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="sticky top-0 z-10 bg-white dark:bg-zinc-950 -mx-4 px-4 pt-3 pb-0 border-b border-zinc-100 dark:border-zinc-800">

        {/* ① セクション + タブ（同一行） */}
        <div className="flex items-center justify-between mb-3 gap-2">
          {/* タブ */}
          <div className="flex items-center gap-0.5">
            {tabs.map((t) => {
              const isSel = tabKey === t.key;
              return (
                <button
                  key={t.key} type="button"
                  onClick={() => setTabKey(t.key)}
                  className={cx(
                    "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all",
                    isSel
                      ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                      : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
                  )}
                >
                  {t.label}
                  <span className={cx(
                    "tabular-nums text-[10px] font-bold",
                    isSel ? "text-white/60 dark:text-zinc-900/60" : "text-zinc-400 dark:text-zinc-500",
                  )}>
                    {t.badge}
                  </span>
                </button>
              );
            })}
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
                className="ml-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 whitespace-nowrap transition-colors"
              >
                {collapsedPatterns.size < visibleShiftPatterns.length ? "全畳" : "全開"}
              </button>
            )}
          </div>

          {/* セクションフィルター（セクションがある案件のみ） */}
          {hasSection && (
            <div className="flex overflow-x-auto gap-1 flex-shrink" style={{ scrollbarWidth: "none" }}>
              <button type="button" onClick={() => setSectionFilter(null)}
                className={cx(
                  "px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all flex-shrink-0",
                  sectionFilter === null
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                    : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300",
                )}>
                全班
              </button>
              {sections.map((sec) => (
                <button key={sec} type="button" onClick={() => setSectionFilter(sec)}
                  className={cx(
                    "px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all flex-shrink-0",
                    sectionFilter === sec
                      ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                      : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300",
                  )}>
                  {sec}
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ━━ コンテンツ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="pt-0">

        {/* ── 出勤タブ: 月次一覧テーブル ── */}
        {tabKey === "shukkin" && (
          <div
            ref={stripRef}
            className="overflow-x-auto -mx-4 border-b border-zinc-100 dark:border-zinc-800"
            style={{ scrollbarWidth: "none" }}
          >
            <div className="flex min-w-max bg-white dark:bg-zinc-900">

              {/* ── 左固定列（パターン名） ── */}
              <div className="sticky left-0 z-20 w-20 flex-shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-700">
                {/* 日付ヘッダー行 */}
                <div className="h-12 px-2 flex items-end pb-2 border-b border-zinc-200 dark:border-zinc-700">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">日付</span>
                </div>

                {/* パターングループ */}
                {visibleShiftPatterns.map((pattern, gi, arr) => {
                  const maxSlots  = patternMaxSlots.get(pattern.name) ?? 0;
                  const isCollapsed = collapsedPatterns.has(pattern.name);
                  const isLast    = gi === arr.length - 1;
                  return (
                    <div key={pattern.name} className={cx("flex flex-col", isLast ? "" : "border-b border-zinc-200 dark:border-zinc-700")}>
                      {/* パターン名 + 折りたたみボタン（充足数行と同高 h-9） */}
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

                      {/* スタッフ行プレースホルダー */}
                      {!isCollapsed && Array.from({ length: maxSlots }).map((_, i) => (
                        <div
                          key={i}
                          className={cx("h-8", i < maxSlots - 1 ? "border-b border-zinc-50 dark:border-zinc-800/50" : "")}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* ── 日付列 ── */}
              <div className="flex pr-4">
                {allDates.map(d => {
                  // "YYYY-MM-DD" を UTC midnight としてパース → getUTCDay/getUTCDate でサーバー(UTC)・クライアント間の不一致を防ぐ
                  const dt        = new Date(d);
                  const dateNum   = dt.getUTCDate();
                  const dayOfWeek = dt.getUTCDay();
                  const dow       = WEEKDAY_JP[dayOfWeek];
                  const isSel     = d === selectedDate;
                  const isToday   = d === todayStr;
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
                      {/* 日付ボタン */}
                      <button
                        type="button"
                        onClick={() => onDateChange(d)}
                        className={cx(
                          "h-12 w-full flex flex-col items-center justify-center gap-0.5 border-b border-zinc-200 dark:border-zinc-700 relative transition-colors",
                          isSel ? "bg-zinc-900 dark:bg-zinc-100" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
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
                          : isSun   ? "text-red-500"
                          : isSat   ? "text-blue-500"
                                    : "text-zinc-700 dark:text-zinc-300",
                        )}>{dateNum}</span>
                      </button>

                      {/* パターングループ */}
                      {visibleShiftPatterns.map((pattern, gi, arr) => {
                        const maxSlots   = patternMaxSlots.get(pattern.name) ?? 0;
                        const isCollapsed = collapsedPatterns.has(pattern.name);
                        const staffOnDay = visibleMembers.filter(m => getShift(m.id, d)?.shift_name === pattern.name);
                        const req        = getReqForDate(pattern, d);
                        const actual     = staffOnDay.length;
                        const ok         = req === 0 || actual >= req;
                        const isLastGrp  = gi === arr.length - 1;

                        return (
                          <div key={pattern.name} className={cx("flex flex-col", isLastGrp ? "" : "border-b border-zinc-200 dark:border-zinc-700")}>
                            {/* 充足数行 (h-9) */}
                            <div className="h-9 flex items-center justify-center border-b border-zinc-100 dark:border-zinc-700/60 bg-zinc-50/50 dark:bg-zinc-800/30">
                              {req > 0 ? (
                                <div className="flex flex-col items-center gap-px">
                                  <span className={cx(
                                    "tabular-nums text-[11px] font-bold leading-none",
                                    ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400",
                                  )}>{actual}</span>
                                  <span className="text-[8px] text-zinc-300 dark:text-zinc-600 leading-none tabular-nums">/{req}</span>
                                </div>
                              ) : (
                                <span className="text-[9px] text-zinc-200 dark:text-zinc-700">—</span>
                              )}
                            </div>

                            {/* スタッフ行 (h-8 each) */}
                            {!isCollapsed && Array.from({ length: maxSlots }).map((_, slotIdx) => {
                              const member      = staffOnDay[slotIdx];
                              const isAddable   = slotIdx < req;
                              // 必要数超えの余剰配置：実績の直後スロットもクリック可
                              const isExtraSlot = !member && slotIdx === staffOnDay.length;
                              const canAdd      = (isAddable || isExtraSlot) && !member;
                              return (
                                <button
                                  key={slotIdx}
                                  type="button"
                                  disabled={isPending || (!member && !canAdd)}
                                  onClick={() => member ? openOccupied(member, d) : canAdd ? openEmpty(d, pattern.name) : undefined}
                                  className={cx(
                                    "h-8 flex items-center justify-center w-full transition-colors",
                                    slotIdx < maxSlots - 1 ? "border-b border-zinc-50 dark:border-zinc-800/50" : "",
                                    member || canAdd
                                      ? isSel
                                        ? "hover:bg-blue-100/60 dark:hover:bg-blue-900/30 cursor-pointer"
                                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60 cursor-pointer"
                                      : "pointer-events-none",
                                  )}
                                >
                                  {member ? (
                                    <span className={cx(
                                      "text-[10px] font-semibold leading-none truncate px-0.5",
                                      isSel ? "text-blue-700 dark:text-blue-300" : "text-zinc-700 dark:text-zinc-300",
                                    )}>{shortName(member.name)}</span>
                                  ) : canAdd ? (
                                    <span className={cx(
                                      "text-base font-thin leading-none",
                                      isSel ? "text-blue-300/70 dark:text-blue-600/70" : "text-zinc-200 dark:text-zinc-700",
                                    )}>+</span>
                                  ) : isAddable ? (
                                    <span className="w-4 h-px bg-zinc-100 dark:bg-zinc-800 rounded-full" />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        )}

        {/* ── 公休 / 希望休タブ: 月次テーブル ── */}
        {(tabKey === "kyukyu" || tabKey === "kiboshu") && (() => {
          const targetName = tabKey === "kyukyu" ? "公休" : "希望休";
          const maxActual  = allDates.length > 0
            ? Math.max(1, ...allDates.map(d => visibleMembers.filter(m => getShift(m.id, d)?.shift_name === targetName).length))
            : 1;
          return (
            <div
              ref={stripRef}
              className="overflow-x-auto -mx-4 border-b border-zinc-100 dark:border-zinc-800"
              style={{ scrollbarWidth: "none" }}
            >
              <div className="flex min-w-max bg-white dark:bg-zinc-900">

                {/* 左固定列 */}
                <div className="sticky left-0 z-20 w-20 flex-shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-700">
                  <div className="h-12 px-2 flex items-end pb-2 border-b border-zinc-200 dark:border-zinc-700">
                    <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">日付</span>
                  </div>
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
                    const dt        = new Date(d);
                    const dateNum   = dt.getUTCDate();
                    const dayOfWeek = dt.getUTCDay();
                    const dow       = WEEKDAY_JP[dayOfWeek];
                    const isSel     = d === selectedDate;
                    const isToday   = d === todayStr;
                    const isSun     = dayOfWeek === 0;
                    const isSat     = dayOfWeek === 6;
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
                        {/* 日付ボタン */}
                        <button
                          type="button"
                          onClick={() => onDateChange(d)}
                          className={cx(
                            "h-12 w-full flex flex-col items-center justify-center gap-0.5 border-b border-zinc-200 dark:border-zinc-700 relative transition-colors",
                            isSel ? "bg-zinc-900 dark:bg-zinc-100" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
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
                          const canAdd = !member && slotIdx === staffOnDay.length && unassignedMembersForDate(d).length > 0;
                          return (
                            <button
                              key={slotIdx}
                              type="button"
                              disabled={isPending || (!member && !canAdd)}
                              onClick={() =>
                                member ? openOccupied(member, d)
                                : canAdd ? openEmptyOff(d, targetName as "公休" | "希望休")
                                : undefined
                              }
                              className={cx(
                                "h-8 flex items-center justify-center w-full transition-colors",
                                slotIdx < maxActual - 1 ? "border-b border-zinc-50 dark:border-zinc-800/50" : "",
                                member || canAdd
                                  ? isSel
                                    ? "hover:bg-blue-100/60 dark:hover:bg-blue-900/30 cursor-pointer"
                                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60 cursor-pointer"
                                  : "pointer-events-none",
                              )}
                            >
                              {member ? (
                                <span className={cx(
                                  "text-[10px] font-semibold leading-none truncate px-0.5",
                                  isSel ? "text-blue-700 dark:text-blue-300" : "text-zinc-700 dark:text-zinc-300",
                                )}>{shortName(member.name)}</span>
                              ) : canAdd ? (
                                <span className={cx(
                                  "text-base font-thin leading-none",
                                  isSel ? "text-blue-300/70 dark:text-blue-600/70" : "text-zinc-200 dark:text-zinc-700",
                                )}>+</span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

              </div>
            </div>
          );
        })()}
      </div>

      {/* ━━ モーダル ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {modalOpen && (
        <ModalWrap onClose={closeModal}>

          {/* ── action: 何をするか選ぶ ── */}
          {modalMode === "action" && (() => {
            const member = activeMembers.find((m) => m.id === modalStaffId);
            const { dow } = parseDayInfo(modalDate);
            return (
              <>
                <div className="mb-5">
                  <p className="text-xs font-semibold text-zinc-400 mb-1">
                    {modalDate.slice(5).replace("-", "/")}（{dow}）
                  </p>
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 leading-tight">
                    {member?.name}
                  </h2>
                  <span className="inline-block mt-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                    {name}
                  </span>
                </div>
                <div className="space-y-2">
                  <button
                    type="button" onClick={() => setModalMode("change")} disabled={isPending}
                    className="w-full py-3.5 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
                  >
                    シフト内容を変更
                  </button>
                  <button
                    type="button" onClick={() => { setError(null); setModalMode("swap"); }} disabled={isPending}
                    className="w-full py-3.5 rounded-2xl bg-blue-50 dark:bg-blue-950/30 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                  >
                    スタッフを入れ替え
                  </button>
                  <button
                    type="button" onClick={handleDelete} disabled={isPending}
                    className="w-full py-3.5 rounded-2xl bg-red-50 dark:bg-red-950/30 text-sm font-semibold text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                  >
                    {isPending ? "削除中…" : "シフトを削除"}
                  </button>
                  <button
                    type="button" onClick={closeModal}
                    className="w-full py-3 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  >
                    キャンセル
                  </button>
                </div>
              </>
            );
          })()}

          {/* ── swap: スタッフ入れ替え先を選ぶ ── */}
          {modalMode === "swap" && (() => {
            const currentMember = activeMembers.find((m) => m.id === modalStaffId);
            const { dow } = parseDayInfo(modalDate);
            return (
              <>
                <div className="mb-4">
                  <button
                    type="button" onClick={() => setModalMode("action")}
                    className="text-xs text-zinc-400 hover:text-zinc-600 mb-2 flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    戻る
                  </button>
                  <p className="text-xs font-semibold text-zinc-400 mb-1">
                    {modalDate.slice(5).replace("-", "/")}（{dow}）入れ替え先を選択
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{currentMember?.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">{name}</span>
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-xl mb-3">
                    {error}
                  </p>
                )}

                <div className="space-y-2">
                  {swapCandidates.length === 0 && (
                    <p className="text-sm text-zinc-400 text-center py-4">他のメンバーがいません</p>
                  )}
                  {swapCandidates.map((m) => {
                    const hasShift = !!m.currentShift;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleSwap(m.id)}
                        disabled={isPending}
                        className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors text-left"
                      >
                        <div>
                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{m.name}</p>
                          <p className="text-[11px] text-zinc-400 font-mono">{m.id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {hasShift ? (
                            <>
                              <span className="text-xs px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-semibold">
                                {m.currentShift!.shift_name}
                              </span>
                              <span className="text-[10px] text-zinc-400">⇄ 入れ替え</span>
                            </>
                          ) : (
                            <span className="text-xs px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-semibold">
                              → 譲渡
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button" onClick={closeModal}
                  className="w-full mt-4 py-3 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  キャンセル
                </button>
              </>
            );
          })()}

          {/* ── add: 空き枠への追加（パターン固定・未割当スタッフのみ） ── */}
          {modalMode === "add" && (() => {
            const { dow } = parseDayInfo(modalDate);
            const lockedPatternSection = shiftPatterns.find(p => p.name === lockedPattern)?.section ?? null;
            const candidates = unassignedMembersForDate(modalDate).filter(m =>
              !lockedPatternSection || m.section === lockedPatternSection
            );
            const addAlerts = getShiftAlerts(modalStaffId, modalDate, name, allDates, shiftMap, shiftPatterns);

            // 公休スタッフ（同セクション絞り込み済み）
            const offMembers = activeMembers.filter(m =>
              getShift(m.id, modalDate)?.shift_name === "公休" &&
              (!lockedPatternSection || m.section === lockedPatternSection)
            );

            const handleLineSend = () => {
              setLineResult(null);
              startTransition(async () => {
                const r = await requestExtraShiftByLineAction(
                  projectId,
                  modalDate,
                  [...selectedOffIds],
                  lockedPattern ?? "シフト",
                  lineMessage || undefined,
                );
                setLineResult(r);
              });
            };

            return (
              <>
                <div className="mb-5">
                  <p className="text-xs font-semibold text-zinc-400 mb-1">
                    {modalDate.slice(5).replace("-", "/")}（{dow}）
                  </p>
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">シフトを追加</h2>
                  {lockedPattern && (
                    <span className="inline-block mt-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900">
                      {lockedPattern}
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  {/* スタッフ選択（未割当のみ） */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                      社員 <span className="text-red-400">*</span>
                      <span className="ml-2 font-normal text-zinc-400">（未割当 {candidates.length}名）</span>
                    </label>
                    {candidates.length === 0 ? (
                      <p className="text-sm text-zinc-400 py-2">この日に追加できるスタッフがいません</p>
                    ) : (
                      <select
                        value={modalStaffId}
                        onChange={(e) => setModalStaffId(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100"
                      >
                        <option value="">— 選択してください —</option>
                        {candidates.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}（{m.id}）</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* アラート（スタッフ選択後に即時表示） */}
                  <ShiftAlerts alerts={addAlerts} />

                  {/* 備考 */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1.5">備考</label>
                    <input
                      type="text" value={note} onChange={(e) => setNote(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-xl">
                      {error}
                    </p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button" onClick={closeModal}
                      className="flex-1 py-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button" onClick={handleSubmit} disabled={isPending || candidates.length === 0}
                      className="flex-1 py-3.5 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 transition-colors"
                    >
                      {isPending ? "登録中…" : "確定"}
                    </button>
                  </div>

                  {/* ── LINE出勤依頼セクション ── */}
                  {offMembers.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 pt-1">
                        <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800" />
                        <span className="text-[10px] text-zinc-400">または</span>
                        <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800" />
                      </div>

                      <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                            公休スタッフへLINEで出勤依頼
                          </p>
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => setSelectedOffIds(new Set(offMembers.map(m => m.id)))}
                              className="text-[10px] text-blue-500 hover:text-blue-700 font-semibold">全選択</button>
                            <span className="text-zinc-200 dark:text-zinc-700">|</span>
                            <button type="button" onClick={() => setSelectedOffIds(new Set())}
                              className="text-[10px] text-zinc-400 hover:text-zinc-600 font-semibold">解除</button>
                          </div>
                        </div>

                        {/* スタッフ一覧（チェックボックス＋適格バッジ） */}
                        <div className="space-y-1.5">
                          {offMembers.map(m => {
                            const elig = analyzeWorkEligibility(m.id, modalDate, allDates, shiftMap);
                            const checked = selectedOffIds.has(m.id);
                            return (
                              <label
                                key={m.id}
                                className={cx(
                                  "flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-colors",
                                  checked
                                    ? "bg-blue-50 dark:bg-blue-950/20"
                                    : "bg-zinc-50 dark:bg-zinc-800/40 hover:bg-zinc-100 dark:hover:bg-zinc-800/70",
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleOffId(m.id)}
                                  className="w-4 h-4 rounded accent-blue-600 flex-shrink-0"
                                />
                                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 flex-1 min-w-0 truncate">
                                  {m.name}
                                </span>
                                <div className="flex gap-1 flex-shrink-0">
                                  {/* 週休バッジ */}
                                  {elig.weekRestsIfWork >= 2 ? (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                                      週休{elig.weekRestsIfWork}日
                                    </span>
                                  ) : elig.weekRestsIfWork === 1 ? (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 whitespace-nowrap">
                                      週休1日
                                    </span>
                                  ) : (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 whitespace-nowrap">
                                      週休0日
                                    </span>
                                  )}
                                  {/* 連勤バッジ */}
                                  {elig.consecutiveDays >= 5 && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 whitespace-nowrap">
                                      {elig.consecutiveDays}連勤
                                    </span>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                        </div>

                        {/* 送信結果 */}
                        {lineResult && (
                          <div className={cx(
                            "px-3 py-2 rounded-xl text-xs font-semibold",
                            lineResult.success
                              ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                              : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300",
                          )}>
                            {lineResult.success
                              ? `✓ ${lineResult.sent}名に送信しました`
                              : lineResult.message}
                            {(lineResult.noLine ?? []).length > 0 && (
                              <p className="mt-1 font-normal text-zinc-400">
                                LINE未連携のため未送信：{lineResult.noLine!.join("、")}
                              </p>
                            )}
                          </div>
                        )}

                        {!lineResult && (
                          <>
                            <textarea
                              rows={3}
                              value={lineMessage}
                              onChange={e => setLineMessage(e.target.value)}
                              placeholder={`【出勤のご協力をお願いします】\n${modalDate.slice(5).replace("-", "/")}（${dow}）の${lockedPattern ?? "シフト"}に空きが出ています。\nご都合がよければ管理者にご連絡ください。`}
                              className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 resize-none"
                            />
                            <button
                              type="button"
                              onClick={handleLineSend}
                              disabled={isPending || selectedOffIds.size === 0}
                              className="w-full py-3 rounded-2xl text-white text-sm font-bold disabled:opacity-40 transition-opacity hover:opacity-90"
                              style={{ backgroundColor: "#06C755" }}
                            >
                              <span className="flex items-center justify-center gap-2">
                                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white flex-shrink-0">
                                  <path d="M19.365 9.89c.50 0 .906.407.906.907s-.406.907-.906.907H17.27v1.204h2.094c.5 0 .906.406.906.906s-.406.907-.906.907h-3c-.5 0-.907-.407-.907-.907V9.89c0-.5.407-.907.907-.907h3zm-5.423 0c.5 0 .906.407.906.907v3.924c0 .5-.406.907-.906.907s-.906-.407-.906-.907V10.797c0-.5.406-.907.906-.907zm-2.854 0c.346 0 .657.197.81.504l1.672 3.34c.222.444.041.985-.402 1.207-.443.222-.985.041-1.207-.402l-.22-.44h-1.306l-.22.44c-.222.443-.764.624-1.207.402-.443-.222-.624-.763-.402-1.207l1.672-3.34c.153-.307.464-.504.81-.504zm0 2.27l-.356.71h.713l-.356-.71zM5.84 9.89c.5 0 .906.407.906.907v2.354l1.814-2.682c.183-.27.487-.42.807-.38.32.04.6.26.706.57.044.132.063.267.055.4v3.757c0 .5-.406.907-.906.907s-.907-.407-.907-.907v-2.354l-1.814 2.682c-.21.31-.579.456-.935.376-.357-.08-.627-.376-.669-.74-.01-.083-.01-.167 0-.25V10.797c0-.5.406-.907.906-.907zM12 2C6.477 2 2 6.036 2 11c0 2.67 1.28 5.063 3.306 6.73.145.122.203.316.151.496l-.47 1.717c-.073.266.107.538.378.538.07 0 .14-.018.202-.054L8.05 19.05c.131-.076.284-.09.427-.039C9.357 19.332 10.666 19.5 12 19.5c5.523 0 10-4.036 10-9s-4.477-9-10-9z"/>
                                </svg>
                                {isPending ? "送信中…" : `選択した${selectedOffIds.size}名にLINEで依頼`}
                              </span>
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </>
            );
          })()}

          {/* ── change: シフト内容変更（パターン・時刻変更可） ── */}
          {modalMode === "change" && (() => {
            const { dow } = parseDayInfo(modalDate);
            const member = activeMembers.find((m) => m.id === modalStaffId);
            const changeAlerts = getShiftAlerts(modalStaffId, modalDate, name, allDates, shiftMap, shiftPatterns);
            // メンバーのセクションに合うパターンだけ表示（セクション未設定パターンは常に表示）
            const memberSection = member?.section ?? null;
            const filteredPatterns = memberSection
              ? shiftPatterns.filter(p => !p.section || p.section === memberSection)
              : shiftPatterns;
            const presets = [
              ...filteredPatterns.map((p) => ({ name: p.name, start: p.start_time?.slice(0, 5) ?? "", end: p.end_time?.slice(0, 5) ?? "" })),
              { name: "公休",   start: "", end: "" },
              { name: "希望休", start: "", end: "" },
            ];
            return (
              <>
                <div className="mb-5">
                  <button
                    type="button" onClick={() => setModalMode("action")}
                    className="text-xs text-zinc-400 hover:text-zinc-600 mb-2 flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    戻る
                  </button>
                  <p className="text-xs font-semibold text-zinc-400 mb-1">
                    {modalDate.slice(5).replace("-", "/")}（{dow}）
                  </p>
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">シフトを変更</h2>
                  <p className="text-sm font-semibold text-zinc-500 mt-0.5">{member?.name}</p>
                </div>

                <div className="space-y-4">
                  {/* プリセット */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1.5">シフト</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {presets.map((p) => (
                        <button
                          key={p.name} type="button"
                          onClick={() => { setName(p.name); setStart(p.start); setEnd(p.end); }}
                          className={cx(
                            "py-2.5 rounded-xl text-sm font-semibold transition-colors",
                            name === p.name
                              ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                          )}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* アラート（パターン選択後に即時表示） */}
                  <ShiftAlerts alerts={changeAlerts} />

                  {/* カスタム名 */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                      シフト名 <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text" value={name} onChange={(e) => setName(e.target.value)}
                      placeholder="例：日勤、公休"
                      className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100"
                    />
                  </div>

                  {/* 時刻 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1.5">開始</label>
                      <input
                        type="time" value={start} onChange={(e) => setStart(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1.5">終了</label>
                      <input
                        type="time" value={end} onChange={(e) => setEnd(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
                      />
                    </div>
                  </div>

                  {/* 備考 */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1.5">備考</label>
                    <input
                      type="text" value={note} onChange={(e) => setNote(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-xl">
                      {error}
                    </p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button" onClick={closeModal}
                      className="flex-1 py-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button" onClick={handleSubmit} disabled={isPending}
                      className="flex-1 py-3.5 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 transition-colors"
                    >
                      {isPending ? "更新中…" : "確定"}
                    </button>
                  </div>
                </div>
              </>
            );
          })()}

        </ModalWrap>
      )}
    </>
  );
}
