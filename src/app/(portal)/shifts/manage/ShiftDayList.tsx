"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertShiftAction, deleteShiftAction, swapShiftsAction } from "../actions";

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
type Pattern = { name: string; required_count: number; section: string | null; start_time: string | null; end_time: string | null };

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
// add: 空き枠クリック | action: 既存シフト選択 | change: 内容変更 | swap: スタッフ入れ替え
type ModalMode = "add" | "action" | "change" | "swap";

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

export default function ShiftDayList({
  allDates, shifts, activeMembers, shiftPatterns, selectedDate, onDateChange, projectId,
}: {
  allDates: string[];
  shifts: Shift[];
  activeMembers: Member[];
  shiftPatterns: Pattern[];
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
  // add モード用：固定パターン名（変更不可）
  const [lockedPattern, setLockedPattern] = useState<string | null>(null);

  // 週チャンク
  const weekChunks  = (() => {
    const c: string[][] = [];
    for (let i = 0; i < allDates.length; i += 7) c.push(allDates.slice(i, i + 7));
    return c;
  })();
  const weekIdx     = Math.max(0, weekChunks.findIndex((c) => c.includes(selectedDate)));
  const currentWeek = weekChunks[weekIdx] ?? [];

  const parseDayInfo = (d: string) => {
    const dt = new Date(d + "T00:00:00+09:00");
    return {
      dateNum: dt.getDate(),
      dow: WEEKDAY_JP[dt.getDay()],
      dayOfWeek: dt.getDay(),
    };
  };

  // ── シフトルックアップ（上部で定義済み） ─────────────────────────

  // パターン×日付 → メンバーリスト（セクションフィルター適用）
  const membersForPatternDay = (patternName: string, date: string) =>
    visibleMembers.filter((m) => getShift(m.id, date)?.shift_name === patternName);

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

        {/* ① セクションフィルター（セクションがある案件のみ表示） */}
        {hasSection && (
          <div className="flex overflow-x-auto gap-1 mb-2" style={{ scrollbarWidth: "none" }}>
            <button
              type="button"
              onClick={() => setSectionFilter(null)}
              className={cx(
                "px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0",
                sectionFilter === null
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700",
              )}
            >
              すべて
            </button>
            {sections.map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => setSectionFilter(sec)}
                className={cx(
                  "px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0",
                  sectionFilter === sec
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                )}
              >
                {sec}
              </button>
            ))}
          </div>
        )}

        {/* ② パターンタブ */}
        <div className="flex overflow-x-auto gap-1 mb-3" style={{ scrollbarWidth: "none" }}>
          {tabs.map((t) => {
            const isSel = tabKey === t.key;
            return (
              <button
                key={t.key} type="button"
                onClick={() => setTabKey(t.key)}
                className={cx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0",
                  isSel
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                )}
              >
                {t.label}
                <span className={cx(
                  "tabular-nums text-[10px] min-w-[1.5rem] text-center px-1.5 py-0.5 rounded-full font-bold",
                  isSel
                    ? "bg-white/15 text-white dark:text-zinc-900 dark:bg-black/15"
                    : "bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400",
                )}>
                  {t.badge}
                </span>
              </button>
            );
          })}
        </div>

        {/* ④ 週ナビ */}
        <div className="flex items-center justify-between mb-1 px-0.5">
          <button
            type="button"
            onClick={() => { const p = weekChunks[weekIdx - 1]; if (p) onDateChange(p[0]); }}
            disabled={weekIdx === 0}
            className="w-7 h-7 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 tabular-nums">
            {(() => {
              const first = currentWeek[0] ?? "";
              const last  = currentWeek[currentWeek.length - 1] ?? "";
              const f = parseDayInfo(first);
              const l = parseDayInfo(last);
              return `${first.slice(5).replace("-", "/")}(${f.dow}) — ${last.slice(5).replace("-", "/")}(${l.dow})`;
            })()}
          </span>
          <button
            type="button"
            onClick={() => { const n = weekChunks[weekIdx + 1]; if (n) onDateChange(n[0]); }}
            disabled={weekIdx === weekChunks.length - 1}
            className="w-7 h-7 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* ⑤ 日付列 */}
        <div className="flex">
          {currentWeek.map((d) => {
            const { dateNum, dow, dayOfWeek } = parseDayInfo(d);
            const isSel   = d === selectedDate;
            const isToday = d === todayStr;
            const isSun   = dayOfWeek === 0;
            const isSat   = dayOfWeek === 6;
            return (
              <button
                key={d}
                onClick={() => onDateChange(d)}
                className={cx(
                  "flex-1 flex flex-col items-center gap-0.5 py-2 transition-all",
                  isSel
                    ? "bg-zinc-900 dark:bg-zinc-100 rounded-t-xl"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60 rounded-t-xl",
                )}
              >
                <span className={cx(
                  "text-[10px] font-semibold leading-none",
                  isSel  ? "text-zinc-400 dark:text-zinc-500"
                  : isSun ? "text-red-400"
                  : isSat ? "text-blue-400"
                          : "text-zinc-400 dark:text-zinc-500",
                )}>
                  {dow}
                </span>
                <span className={cx(
                  "text-sm font-bold tabular-nums leading-none",
                  isSel  ? "text-white dark:text-zinc-900"
                  : isSun ? "text-red-500"
                  : isSat ? "text-blue-500"
                          : "text-zinc-800 dark:text-zinc-200",
                )}>
                  {dateNum}
                </span>
                <span className={cx(
                  "w-1 h-1 rounded-full",
                  isToday ? (isSel ? "bg-blue-400" : "bg-blue-500") : "bg-transparent",
                )} />
              </button>
            );
          })}
        </div>
      </div>

      {/* ━━ コンテンツ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="pt-2 space-y-3">

        {/* ── 出勤タブ ── */}
        {tabKey === "shukkin" && shiftPatterns.map((pattern) => {
          const byDay = currentWeek.map((d) =>
            activeMembers.filter((m) => getShift(m.id, d)?.shift_name === pattern.name)
          );
          const req      = pattern.required_count;
          const maxSlots = Math.max(req, ...byDay.map((ms) => ms.length));
          if (maxSlots === 0) return null;
          const isCollapsed = collapsedPatterns.has(pattern.name);
          // 選択日のカウント
          const selDayIdx = currentWeek.indexOf(selectedDate);
          const selCount = selDayIdx >= 0 ? (byDay[selDayIdx]?.length ?? 0) : 0;
          return (
            <div key={pattern.name}>
              <button
                type="button"
                onClick={() => togglePattern(pattern.name)}
                className="flex items-center gap-2 w-full px-0.5 mb-1 group"
              >
                <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{pattern.name}</span>
                {(pattern.start_time || pattern.end_time) && (
                  <span className="text-[10px] text-zinc-400 font-mono">
                    {pattern.start_time?.slice(0, 5)}〜{pattern.end_time?.slice(0, 5)}
                  </span>
                )}
                {req > 0 && (
                  <span className={cx(
                    "tabular-nums text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                    selCount >= req
                      ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
                      : "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400",
                  )}>
                    {selCount}/{req}
                  </span>
                )}
                <svg
                  className={cx("w-3.5 h-3.5 text-zinc-400 ml-auto transition-transform", isCollapsed ? "-rotate-90" : "")}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {!isCollapsed && <div className="overflow-hidden border border-zinc-100 dark:border-zinc-800 rounded-b-2xl">
                {Array.from({ length: maxSlots }, (_, slotIdx) => (
                  <div key={slotIdx} className="flex divide-x divide-zinc-100 dark:divide-zinc-800 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
                    {currentWeek.map((d, di) => {
                      const member    = byDay[di][slotIdx];
                      const isSel     = d === selectedDate;
                      const isAddable = slotIdx < req;
                      // 空き枠：未割当スタッフがいる場合のみ追加可能
                      const canAdd    = isAddable && !member && unassignedMembersForDate(d).length > 0;
                      return (
                        <button
                          key={d} type="button"
                          disabled={isPending || (!member && !canAdd)}
                          onClick={() => member ? openOccupied(member, d) : openEmpty(d, pattern.name)}
                          className={cx(
                            "flex-1 min-w-0 py-3 flex items-center justify-center transition-colors",
                            isSel
                              ? "bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                              : (member || canAdd)
                                ? "bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                                : "bg-white dark:bg-zinc-900 pointer-events-none",
                          )}
                        >
                          {member ? (
                            <span className={cx(
                              "text-[11px] font-semibold leading-none px-1 truncate",
                              isSel ? "text-blue-700 dark:text-blue-300" : "text-zinc-800 dark:text-zinc-200",
                            )}>{shortName(member.name)}</span>
                          ) : canAdd ? (
                            <span className={cx(
                              "text-sm leading-none font-light",
                              isSel ? "text-blue-300 dark:text-blue-700" : "text-zinc-200 dark:text-zinc-700",
                            )}>＋</span>
                          ) : isAddable ? (
                            // 必要枠だが未割当スタッフなし（全員割当済み）
                            <span className="text-[9px] text-zinc-200 dark:text-zinc-700">─</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {req > 0 && (
                  <div className="flex divide-x divide-zinc-100 dark:divide-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
                    {currentWeek.map((d, di) => {
                      const count = byDay[di].length;
                      const isSel = d === selectedDate;
                      const ok    = count >= req;
                      return (
                        <div key={d} className={cx("flex-1 py-1.5 flex items-center justify-center", isSel ? "bg-blue-50 dark:bg-blue-950/30" : "")}>
                          <span className={cx(
                            "tabular-nums text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                            ok
                              ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
                              : "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400",
                          )}>{count}/{req}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>}
            </div>
          );
        })}

        {/* ── 公休 / 希望休タブ ── */}
        {(tabKey === "kyukyu" || tabKey === "kiboshu") && (() => {
          const targetName = tabKey === "kyukyu" ? "公休" : "希望休";
          const byDay = currentWeek.map((d) =>
            activeMembers.filter((m) => getShift(m.id, d)?.shift_name === targetName)
          );
          // 空き枠（未割当スタッフがいる日は＋ボタン表示）
          const maxSlots = Math.max(...byDay.map((ms) => ms.length), 1);
          return (
            <div className="overflow-hidden border border-zinc-100 dark:border-zinc-800 rounded-b-2xl">
              {Array.from({ length: maxSlots }, (_, slotIdx) => (
                <div key={slotIdx} className="flex divide-x divide-zinc-100 dark:divide-zinc-800 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
                  {currentWeek.map((d, di) => {
                    const member  = byDay[di][slotIdx];
                    const isSel   = d === selectedDate;
                    // 最初の空きスロットのみ＋表示
                    const canAdd  = !member && slotIdx === byDay[di].length && unassignedMembersForDate(d).length > 0;
                    return (
                      <button
                        key={d} type="button"
                        disabled={isPending || (!member && !canAdd)}
                        onClick={() =>
                          member ? openOccupied(member, d)
                          : canAdd ? openEmptyOff(d, targetName as "公休" | "希望休")
                          : undefined
                        }
                        className={cx(
                          "flex-1 min-w-0 py-3 flex items-center justify-center transition-colors",
                          isSel
                            ? "bg-blue-50 dark:bg-blue-950/30" + ((member || canAdd) ? " hover:bg-blue-100 dark:hover:bg-blue-900/40" : "")
                            : (member || canAdd)
                              ? "bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                              : "bg-white dark:bg-zinc-900 pointer-events-none",
                        )}
                      >
                        {member ? (
                          <span className={cx(
                            "text-[11px] font-semibold leading-none px-1 truncate",
                            isSel ? "text-blue-700 dark:text-blue-300" : "text-zinc-800 dark:text-zinc-200",
                          )}>{shortName(member.name)}</span>
                        ) : canAdd ? (
                          <span className={cx(
                            "text-sm leading-none font-light",
                            isSel ? "text-blue-300 dark:text-blue-700" : "text-zinc-200 dark:text-zinc-700",
                          )}>＋</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
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
            // パターンのセクションに合うメンバーだけ候補に（セクション未設定パターンは全員）
            const lockedPatternSection = shiftPatterns.find(p => p.name === lockedPattern)?.section ?? null;
            const candidates = unassignedMembersForDate(modalDate).filter(m =>
              !lockedPatternSection || m.section === lockedPatternSection
            );
            const addAlerts = getShiftAlerts(modalStaffId, modalDate, name, allDates, shiftMap, shiftPatterns);
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
