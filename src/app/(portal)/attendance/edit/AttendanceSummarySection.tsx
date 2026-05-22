"use client";

import { useState, useTransition, useEffect } from "react";
import { fetchAttendanceSummaryAction, type StaffSummary, type DayRecord } from "./work-record-actions";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

// ── ヘルパー ────────────────────────────────────────────────────────────
const WEEKDAY_JP = ["日","月","火","水","木","金","土"];

function toHHMM(iso: string | null): string {
  if (!iso) return "─";
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtDate(d: string) {
  const dt = new Date(d + "T00:00:00+09:00");
  return `${dt.getMonth() + 1}/${dt.getDate()}（${WEEKDAY_JP[dt.getDay()]}）`;
}

function lastMonth() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  return {
    start: new Date(y, m - 1, 1).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    end:   new Date(y, m,     0).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
  };
}
function lastWeek() {
  const now  = new Date();
  const diff = (now.getDay() === 0 ? 7 : now.getDay()) + 6;
  const mon  = new Date(now); mon.setDate(now.getDate() - diff);
  const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
  return {
    start: mon.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    end:   sun.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
  };
}

// ── ステータス表示 ────────────────────────────────────────────────────────
const STATUS_META: Record<DayRecord["status"], { label: string; color: string }> = {
  ok:          { label: "正常",       color: "text-zinc-400 dark:text-zinc-500" },
  no_clockin:  { label: "出勤未打刻", color: "text-red-600 dark:text-red-400 font-semibold" },
  no_clockout: { label: "退勤未打刻", color: "text-orange-600 dark:text-orange-400 font-semibold" },
  absent:      { label: "欠勤",       color: "text-red-500 dark:text-red-400" },
  late:        { label: "遅刻",       color: "text-yellow-600 dark:text-yellow-400" },
  early:       { label: "早退",       color: "text-blue-500 dark:text-blue-400" },
};

// ── 日別実績カード ────────────────────────────────────────────────────────
function DayRow({ d }: { d: DayRecord }) {
  const st = STATUS_META[d.status];
  return (
    <div className="flex items-start gap-2 py-2.5 border-b border-zinc-50 dark:border-zinc-800/60 last:border-0">
      <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500 w-20 flex-shrink-0 pt-0.5">
        {fmtDate(d.date)}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-zinc-600 dark:text-zinc-400 truncate">{d.shiftName}</p>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
            {toHHMM(d.clockIn)} → {toHHMM(d.clockOut)}
          </span>
          {(d.shiftStart || d.shiftEnd) && (
            <span className="text-[10px] text-zinc-300 dark:text-zinc-600">
              予定 {d.shiftStart ?? "─"}〜{d.shiftEnd ?? "─"}
            </span>
          )}
        </div>
        {(d.absenceReason || d.lateReason) && (
          <p className="text-[10px] text-zinc-400 mt-0.5 truncate">
            {d.absenceReason || d.lateReason}
          </p>
        )}
      </div>
      <span className={`text-xs flex-shrink-0 pt-0.5 ${st.color}`}>{st.label}</span>
    </div>
  );
}

// ── スタッフ行（折り畳み） ────────────────────────────────────────────────
function StaffRow({ s }: { s: StaffSummary }) {
  const [open, setOpen] = useState(false);
  const hasIssue = s.absentDays + s.lateDays + s.earlyDays + s.missingDays > 0;

  return (
    <div className="border border-zinc-100 dark:border-zinc-800 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left"
      >
        {/* 名前・アカウント */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {s.accountNumber && (
              <span className="text-xs tabular-nums font-mono text-zinc-400 dark:text-zinc-500 flex-shrink-0">
                {s.accountNumber}
              </span>
            )}
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{s.name}</span>
            {s.section && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{s.section}</span>
            )}
          </div>
          {/* サマリーチップ */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
              出勤 {s.workDays + s.lateDays + s.earlyDays}/{s.totalDays}日
            </span>
            {s.absentDays  > 0 && <span className="text-[10px] tabular-nums text-red-500">欠勤 {s.absentDays}日</span>}
            {s.lateDays    > 0 && <span className="text-[10px] tabular-nums text-yellow-600 dark:text-yellow-400">遅刻 {s.lateDays}日</span>}
            {s.earlyDays   > 0 && <span className="text-[10px] tabular-nums text-blue-500">早退 {s.earlyDays}日</span>}
            {s.missingDays > 0 && <span className="text-[10px] tabular-nums text-orange-500 font-semibold">打刻漏れ {s.missingDays}日</span>}
            {!hasIssue && <span className="text-[10px] text-zinc-300 dark:text-zinc-600">問題なし</span>}
          </div>
        </div>
        {/* 問題インジケーター ＋ chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasIssue && (
            <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
          )}
          <svg
            className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-1 bg-zinc-50/50 dark:bg-zinc-900/50">
          {s.days.length === 0 ? (
            <p className="text-xs text-zinc-400 py-3">シフトデータがありません</p>
          ) : (
            s.days.map((d, i) => <DayRow key={i} d={d} />)
          )}
        </div>
      )}
    </div>
  );
}

// ── メインコンポーネント ──────────────────────────────────────────────────
export default function AttendanceSummarySection({
  projectId,
  onExport,
}: {
  projectId: string;
  onExport: () => void;
}) {
  const today          = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const thisMonthStart = today.slice(0, 7) + "-01";

  const [startDate, setStartDate] = useState(thisMonthStart);
  const [endDate,   setEndDate]   = useState(today);
  const [staffList, setStaffList] = useState<StaffSummary[] | null>(null);
  const [errMsg,    setErrMsg]    = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [search,    setSearch]    = useState("");

  function doFetch(start: string, end: string) {
    setErrMsg(null);
    setStaffList(null);
    startTransition(async () => {
      const r = await fetchAttendanceSummaryAction(projectId, start, end);
      if (r.success) setStaffList(r.staffList ?? []);
      else setErrMsg(r.message ?? "取得失敗");
    });
  }

  // マウント時・期間変更時に自動取得
  useEffect(() => {
    doFetch(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function applyPeriod(start: string, end: string) {
    setStartDate(start);
    setEndDate(end);
    doFetch(start, end);
  }

  const PERIOD_BTNS = [
    { label: "今月", start: thisMonthStart, end: today },
    { label: "先月", ...lastMonth() },
    { label: "先週", ...lastWeek() },
  ];

  const filtered = (staffList ?? []).filter(s =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.staffId.toLowerCase().includes(search.toLowerCase()) ||
    (s.accountNumber ?? "").includes(search),
  );

  const issueCount = (staffList ?? []).filter(
    s => s.absentDays + s.lateDays + s.earlyDays + s.missingDays > 0,
  ).length;

  return (
    <div className="space-y-4">

      {/* 期間選択 */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="date" value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-zinc-400 text-sm">〜</span>
          <input
            type="date" value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => doFetch(startDate, endDate)}
            disabled={isPending}
            className="px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors flex-shrink-0"
          >
            {isPending ? "…" : "表示"}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {PERIOD_BTNS.map(({ label, start, end }) => (
            <button
              key={label}
              onClick={() => applyPeriod(start, end)}
              className="px-3 py-1 rounded-full text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ヘッダー：件数 ＋ 検索 ＋ 実績出力ボタン */}
      {staffList !== null && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {filtered.length}名
            </span>
            {issueCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 tabular-nums font-medium">
                問題あり {issueCount}名
              </span>
            )}
            {filtered.length > 5 && (
              <input
                type="search" placeholder="名前・IDで絞り込み" value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 min-w-0 max-w-xs px-2.5 py-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
              />
            )}
          </div>
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            実績出力
          </button>
        </div>
      )}

      {/* ローディング */}
      {isPending && (
        <p className="text-sm text-zinc-400 py-6 text-center">読み込み中…</p>
      )}

      {/* エラー */}
      {errMsg && (
        <p className="text-sm text-red-500">{errMsg}</p>
      )}

      {/* スタッフ一覧 */}
      {!isPending && staffList !== null && (
        filtered.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-10 text-center text-sm text-zinc-400">
            {search ? "該当するスタッフがいません" : "シフトデータがありません"}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(s => <StaffRow key={s.staffId} s={s} />)}
          </div>
        )
      )}
    </div>
  );
}
