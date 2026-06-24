"use client";

import { useState, useTransition, useEffect } from "react";
import { fetchAttendanceSummaryAction, type StaffSummary, type DayRecord } from "./work-record-actions";

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

// ── Excel（CSV）エクスポート ───────────────────────────────────────────────
function exportStaffCsv(s: StaffSummary, startDate: string, endDate: string) {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ["日付", "曜日", "シフト", "出勤予定", "退勤予定", "出勤打刻", "退勤打刻", "ステータス", "備考"];
  const rows = s.days.map(d => {
    const dt = new Date(d.date + "T00:00:00+09:00");
    const dow = WEEKDAY_JP[dt.getDay()];
    const dateStr = `${dt.getFullYear()}/${dt.getMonth()+1}/${dt.getDate()}`;
    const note = d.absenceReason || d.lateReason || "";
    return [
      dateStr, dow, d.shiftName,
      d.shiftStart ?? "", d.shiftEnd ?? "",
      toHHMM(d.clockIn), toHHMM(d.clockOut),
      STATUS_META[d.status].label,
      note,
    ];
  });

  const csv = [header, ...rows]
    .map(r => r.map(c => esc(c)).join(","))
    .join("\r\n");

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `勤怠実績_${s.name}_${startDate}_${endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── スタッフ詳細モーダル ─────────────────────────────────────────────────
function StaffDetailModal({
  s,
  startDate,
  endDate,
  onClose,
}: {
  s: StaffSummary;
  startDate: string;
  endDate: string;
  onClose: () => void;
}) {
  // 問題＝欠勤・打刻漏れのみ。遅刻・早退は正しく記録された通常勤務なので除外
  const hasIssue = s.absentDays + s.missingDays > 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                {s.accountNumber && (
                  <span className="text-xs font-mono text-zinc-400">{s.accountNumber}</span>
                )}
                <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{s.name}</span>
                {s.section && (
                  <span className="text-xs text-zinc-400">{s.section}</span>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5 tabular-nums">
                {startDate} 〜 {endDate}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-xl leading-none flex-shrink-0 mt-0.5"
            >
              ×
            </button>
          </div>

          {/* サマリー */}
          <div className="flex flex-wrap gap-3 mt-3">
            <Chip label="出勤" value={`${s.workDays + s.lateDays + s.earlyDays}/${s.totalDays}日`} color="text-zinc-700 dark:text-zinc-200" />
            {s.absentDays  > 0 && <Chip label="欠勤"     value={`${s.absentDays}日`}  color="text-red-600 dark:text-red-400" />}
            {s.lateDays    > 0 && <Chip label="遅刻"     value={`${s.lateDays}日`}    color="text-yellow-600 dark:text-yellow-400" />}
            {s.earlyDays   > 0 && <Chip label="早退"     value={`${s.earlyDays}日`}   color="text-blue-500 dark:text-blue-400" />}
            {s.missingDays > 0 && <Chip label="打刻漏れ" value={`${s.missingDays}日`} color="text-orange-500 font-semibold" />}
            {!hasIssue && <span className="text-xs text-zinc-400">問題なし</span>}
          </div>
        </div>

        {/* 日別実績リスト */}
        <div className="overflow-y-auto flex-1 px-5 py-2">
          {s.days.length === 0 ? (
            <p className="text-sm text-zinc-400 py-6 text-center">シフトデータがありません</p>
          ) : (
            <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
              {s.days.map((d, i) => {
                const st = STATUS_META[d.status];
                return (
                  <div key={i} className="flex items-start gap-3 py-2.5">
                    <span className="text-xs tabular-nums text-zinc-400 w-20 flex-shrink-0 pt-0.5">
                      {fmtDate(d.date)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{d.shiftName}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
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
              })}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            閉じる
          </button>
          <button
            type="button"
            onClick={() => exportStaffCsv(s, startDate, endDate)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            Excelエクスポート
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center px-3 py-1 rounded-lg bg-zinc-50 dark:bg-zinc-800 min-w-[52px]">
      <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-[10px] text-zinc-400">{label}</span>
    </div>
  );
}

// ── スタッフ行（クリックでモーダル） ────────────────────────────────────────
function StaffRow({ s, onOpen }: { s: StaffSummary; onOpen: () => void }) {
  // 問題＝欠勤・打刻漏れのみ。遅刻・早退は除外
  const hasIssue = s.absentDays + s.missingDays > 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors"
    >
      <div className="flex items-center gap-3">
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
          <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </button>
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

  // 詳細モーダル
  const [detailStaff, setDetailStaff] = useState<StaffSummary | null>(null);

  function doFetch(start: string, end: string) {
    setErrMsg(null);
    setStaffList(null);
    startTransition(async () => {
      const r = await fetchAttendanceSummaryAction(projectId, start, end);
      if (r.success) setStaffList(r.staffList ?? []);
      else setErrMsg(r.message ?? "取得失敗");
    });
  }

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

  // 検索フィルタ（staffList.length で判定 — filteredの長さではない）
  const filtered = (staffList ?? []).filter(s =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.staffId.toLowerCase().includes(search.toLowerCase()) ||
    (s.accountNumber ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const issueCount = (staffList ?? []).filter(
    s => s.absentDays + s.missingDays > 0,
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
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex-shrink-0">
              {filtered.length}名
            </span>
            {issueCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 tabular-nums font-medium flex-shrink-0">
                問題あり {issueCount}名
              </span>
            )}
            {/* 名前検索：staffListに5名以上いる場合に表示（filteredではない） */}
            {(staffList.length) > 5 && (
              <input
                type="search"
                placeholder="名前・ID・アカウント番号で絞り込み"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 min-w-36 max-w-xs px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            )}
          </div>
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
            {filtered.map(s => (
              <StaffRow
                key={s.staffId}
                s={s}
                onOpen={() => setDetailStaff(s)}
              />
            ))}
          </div>
        )
      )}

      {/* スタッフ詳細モーダル */}
      {detailStaff && (
        <StaffDetailModal
          s={detailStaff}
          startDate={startDate}
          endDate={endDate}
          onClose={() => setDetailStaff(null)}
        />
      )}
    </div>
  );
}
