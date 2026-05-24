"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { submitCorrectionAction } from "@/app/(portal)/corrections/actions";

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

// 06:00〜23:45 の 15分刻みセレクト
const TIME_OPTIONS: string[] = [];
for (let m = 6 * 60; m <= 23 * 60 + 45; m += 15) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
}

type DayRecord = {
  date: string;
  dow: number;
  shiftName: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  clockIn: string | null;
  clockOut: string | null;
  clockInIso: string | null;
  clockOutIso: string | null;
};

type CorrectionSummary = {
  id: string;
  target_date: string;
  status: string;
};

type Props = {
  records: DayRecord[];
  corrections: CorrectionSummary[];
  projectName: string;
  year: number;
  month: number;
  prevMonth: string;
  nextMonth: string;
  workDays: number;
  totalStr: string;
  today: string;
  isFuture: boolean;
  scheduledDays: number;
  absentDays: number;
  lateDays: number;
  earlyDays: number;
  complianceRate: number | null;
};

function calcHours(inIso: string, outIso: string): string {
  const mins = Math.round(
    (new Date(outIso).getTime() - new Date(inIso).getTime()) / 60000
  );
  if (mins <= 0) return "-";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

const CORR_BADGE: Record<string, string> = {
  pending:  "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
  approved: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
  rejected: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
};
const CORR_LABEL: Record<string, string> = {
  pending: "審査中", approved: "承認済", rejected: "却下",
};

type CorrKind = "定時" | "遅刻" | "早退" | "残業";
const KIND_LIST: CorrKind[] = ["定時", "遅刻", "早退", "残業"];

const KIND_INACTIVE: Record<CorrKind, string> = {
  定時: "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400",
  遅刻: "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400",
  早退: "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400",
  残業: "border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400",
};
const KIND_ACTIVE: Record<CorrKind, string> = {
  定時: "border-blue-600 bg-blue-600 text-white",
  遅刻: "border-red-600 bg-red-600 text-white",
  早退: "border-amber-500 bg-amber-500 text-white",
  残業: "border-violet-600 bg-violet-600 text-white",
};

export default function RecordClient({
  records, corrections, projectName,
  year, month, prevMonth, nextMonth,
  workDays, totalStr, today, isFuture,
  scheduledDays, absentDays, lateDays, earlyDays, complianceRate,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [modal, setModal]         = useState<DayRecord | null>(null);
  const [kind, setKind]           = useState<CorrKind>("定時");
  const [timeIn, setTimeIn]       = useState("");
  const [timeOut, setTimeOut]     = useState("");
  const [reason, setReason]       = useState("");
  const [error, setError]         = useState<string | null>(null);

  const corrMap = new Map(corrections.map((c) => [c.target_date, c]));

  const openModal = (r: DayRecord) => {
    setModal(r);
    setKind("定時");
    setTimeIn(r.shiftStart?.slice(0, 5) ?? r.clockIn ?? "");
    setTimeOut(r.shiftEnd?.slice(0, 5) ?? r.clockOut ?? "");
    setReason("");
    setError(null);
  };

  const closeModal = () => { setModal(null); setError(null); };

  const handleKindChange = (k: CorrKind) => {
    setKind(k);
    if (!modal) return;
    if (k === "定時") {
      setTimeIn(modal.shiftStart?.slice(0, 5) ?? modal.clockIn ?? "");
      setTimeOut(modal.shiftEnd?.slice(0, 5) ?? modal.clockOut ?? "");
    } else if (k === "遅刻") {
      setTimeIn(modal.clockIn ?? "");
      setTimeOut("");
    } else {
      setTimeIn("");
      setTimeOut(modal.clockOut ?? "");
    }
  };

  const handleSubmit = () => {
    if (!modal) return;
    setError(null);
    if (!reason.trim()) { setError("修正理由を入力してください"); return; }
    if (kind === "定時" && !timeIn && !timeOut) { setError("出勤または退勤時刻を選択してください"); return; }
    if (kind === "遅刻" && !timeIn) { setError("出勤時刻を選択してください"); return; }
    if ((kind === "早退" || kind === "残業") && !timeOut) { setError("退勤時刻を選択してください"); return; }

    const corrIn  = (kind === "定時" || kind === "遅刻") ? timeIn : "";
    const corrOut = (kind === "定時" || kind === "早退" || kind === "残業") ? timeOut : "";

    const fd = new FormData();
    fd.set("targetDate",   modal.date);
    fd.set("correctedIn",  corrIn);
    fd.set("correctedOut", corrOut);
    fd.set("reason",       `[${kind}] ${reason}`);

    startTransition(async () => {
      const result = await submitCorrectionAction(fd);
      if (!result.success) {
        setError(result.message ?? "申請失敗");
      } else {
        closeModal();
        router.refresh();
      }
    });
  };

  return (
    <>
      {/* 印刷スタイル */}
      <style>{`
        @media print {
          aside, nav.fixed, .no-print { display: none !important; }
          [class*="md:pl-"] { padding-left: 0 !important; }
          .pb-safe { padding-bottom: 0 !important; }
          body { background: white !important; color: black !important; }
          .record-table { border-radius: 0 !important; border: none !important; }
          .record-table table { border-collapse: collapse !important; width: 100% !important; font-size: 10px !important; }
          .record-table th,
          .record-table td { border: 1px solid #d4d4d8 !important; padding: 5px 7px !important; background: white !important; color: black !important; }
          .record-table thead tr { background: #f4f4f5 !important; }
          .record-table thead th { font-weight: 600 !important; color: #52525b !important; background: #f4f4f5 !important; }
          .print-show { display: block !important; }
          .print-hide { display: none !important; }
          .summary-grid { display: flex; gap: 24px; margin-bottom: 8px; }
          .summary-item { font-size: 12px; }
        }
        .print-show { display: none; }
      `}</style>

      <main className="h-dvh flex flex-col bg-white dark:bg-zinc-950 overflow-hidden">
        <div className="max-w-5xl w-full mx-auto px-4 pt-5 pb-20 flex flex-col gap-3 h-full overflow-hidden">

          {/* 印刷用ヘッダー */}
          <div className="print-show mb-3">
            <p className="text-lg font-bold">{projectName}　勤怠実績　{year}年{month}月</p>
          </div>

          {/* ヘッダー */}
          <div className="print-hide">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">勤怠実績</h1>
          </div>

          {/* 月ナビ */}
          <div className="print-hide flex items-center justify-between">
            <a href={`/record?month=${prevMonth}`}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500">
              <ChevronLeftIcon className="w-4 h-4" />
            </a>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              {year}年 {month}月
            </h2>
            <a href={`/record?month=${nextMonth}`}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500">
              <ChevronRightIcon className="w-4 h-4" />
            </a>
          </div>

          {/* サマリー（3カード） */}
          <div className="print-hide grid grid-cols-3 gap-2">
            {/* 出勤日数 */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 rounded-xl p-3 text-center shadow-sm">
              <p className="text-xs text-zinc-500 mb-1">出勤日数</p>
              <p className="text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{workDays}日</p>
            </div>
            {/* 総勤務時間 */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 rounded-xl p-3 text-center shadow-sm">
              <p className="text-xs text-zinc-500 mb-1">総勤務時間</p>
              <p className="text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{totalStr}</p>
            </div>
            {/* 勤怠順守率 */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 rounded-xl p-3 text-center shadow-sm">
              <p className="text-xs text-zinc-500 mb-1">勤怠順守率</p>
              <p className={`text-xl font-bold tabular-nums ${complianceRate === null ? "text-zinc-900 dark:text-zinc-50" : complianceRate >= 90 ? "text-green-600 dark:text-green-400" : complianceRate >= 70 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
                {complianceRate ?? "--"}%
              </p>
              {complianceRate !== null && (absentDays > 0 || lateDays > 0 || earlyDays > 0) && (
                <p className="text-[10px] text-zinc-400 mt-0.5 tabular-nums">
                  {[
                    absentDays > 0 ? `欠勤${absentDays}` : null,
                    lateDays > 0 ? `遅刻${lateDays}` : null,
                    earlyDays > 0 ? `早退${earlyDays}` : null,
                  ].filter(Boolean).join("・")}
                </p>
              )}
            </div>
          </div>

          {/* 印刷用サマリー */}
          <div className="print-show summary-grid mb-3">
            <span className="summary-item">出勤日数：<strong>{workDays}日</strong></span>
            <span className="summary-item">総勤務時間：<strong>{totalStr}</strong></span>
            {complianceRate !== null && (
              <span className="summary-item">
                勤怠順守率：<strong>{complianceRate}%</strong>
                {(absentDays > 0 || lateDays > 0 || earlyDays > 0) && (
                  <span>（欠勤{absentDays}日・遅刻{lateDays}日・早退{earlyDays}日）</span>
                )}
              </span>
            )}
          </div>

          {/* テーブル */}
          {isFuture ? (
            <p className="text-sm text-zinc-500 text-center py-10">未来の月は表示できません</p>
          ) : (
            <div className="record-table flex-1 min-h-0 overflow-auto rounded-2xl border border-zinc-200/70 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
              <table className="w-full min-w-[660px] text-sm border-collapse">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500 whitespace-nowrap">日付</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500 whitespace-nowrap">案件名</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-zinc-500 whitespace-nowrap">予定時間</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-zinc-500 whitespace-nowrap">開始時間</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-zinc-500 whitespace-nowrap">終了時間</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-zinc-500 whitespace-nowrap">勤務時間</th>
                    <th className="no-print text-right px-3 py-2.5 text-xs font-semibold text-zinc-500 whitespace-nowrap">修正申請</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {records.map((r) => {
                    const isToday = r.date === today;
                    const isHol   = r.shiftName === "公休" || r.shiftName === "休";
                    const isSun   = r.dow === 0;
                    const isSat   = r.dow === 6;
                    const corr    = corrMap.get(r.date);
                    const hasData = !!(r.clockIn || r.clockOut || r.shiftName);

                    const dateColor = isToday
                      ? "text-blue-600 dark:text-blue-400 font-bold"
                      : isSun ? "text-red-500 dark:text-red-400"
                      : isSat ? "text-blue-500 dark:text-blue-400"
                      : "text-zinc-700 dark:text-zinc-300";

                    const rowBg = isToday
                      ? "bg-blue-50 dark:bg-blue-900/10"
                      : isHol
                      ? "bg-zinc-50 dark:bg-zinc-900/50"
                      : "";

                    return (
                      <tr key={r.date} className={rowBg}>

                        {/* 日付 */}
                        <td className={`px-3 py-2.5 whitespace-nowrap font-mono text-xs ${dateColor}`}>
                          {Number(r.date.slice(8))}日
                          <span className="ml-1">({WEEKDAY_JP[r.dow]})</span>
                        </td>

                        {/* 案件名 */}
                        <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                          {projectName}
                        </td>

                        {/* 予定時間（シフト） */}
                        <td className="px-3 py-2.5 text-center font-mono tabular-nums text-xs whitespace-nowrap text-zinc-500">
                          {(r.shiftStart || r.shiftEnd) ? (
                            <>{r.shiftStart?.slice(0, 5) ?? "--:--"}〜{r.shiftEnd?.slice(0, 5) ?? "--:--"}</>
                          ) : (
                            <span className="text-zinc-300 dark:text-zinc-600">-</span>
                          )}
                        </td>

                        {/* 開始時間（実績） */}
                        <td className="px-3 py-2.5 text-center font-mono tabular-nums text-xs whitespace-nowrap">
                          <span className={r.clockIn ? "text-green-600 dark:text-green-400" : "text-zinc-300 dark:text-zinc-600"}>
                            {r.clockIn ?? "--:--"}
                          </span>
                        </td>

                        {/* 終了時間（実績） */}
                        <td className="px-3 py-2.5 text-center font-mono tabular-nums text-xs whitespace-nowrap">
                          <span className={r.clockOut ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-300 dark:text-zinc-600"}>
                            {r.clockOut ?? "--:--"}
                          </span>
                        </td>

                        {/* 勤務時間 */}
                        <td className="px-3 py-2.5 text-center font-mono tabular-nums text-xs">
                          {r.clockInIso && r.clockOutIso
                            ? calcHours(r.clockInIso, r.clockOutIso)
                            : <span className="text-zinc-300 dark:text-zinc-600">-</span>}
                        </td>

                        {/* 修正申請 */}
                        <td className="no-print px-3 py-2.5 text-right whitespace-nowrap">
                          {!isHol && hasData && (
                            corr ? (
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${CORR_BADGE[corr.status] ?? ""}`}>
                                {CORR_LABEL[corr.status] ?? corr.status}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openModal(r)}
                                className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
                              >
                                申請
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* 補正申請モーダル */}
      {modal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          onClick={closeModal}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">打刻補正申請</h2>
              <p className="text-sm text-zinc-400 mt-0.5">
                {Number(modal.date.slice(5, 7))}月{Number(modal.date.slice(8))}日（{WEEKDAY_JP[modal.dow]}）
              </p>
            </div>

            {/* 区分選択 */}
            <div>
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">区分を選択</p>
              <div className="grid grid-cols-4 gap-1.5">
                {KIND_LIST.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleKindChange(k)}
                    className={`py-2 rounded-lg text-xs font-bold border transition-colors ${
                      kind === k ? KIND_ACTIVE[k] : KIND_INACTIVE[k]
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            {/* 時刻入力（15分刻みセレクト） */}
            <div className="space-y-3">
              {(kind === "定時" || kind === "遅刻") && (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                    {kind === "遅刻" ? "実際の出勤時刻" : "修正後の出勤時刻"}
                  </label>
                  <select
                    value={timeIn}
                    onChange={(e) => setTimeIn(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
                  >
                    <option value="">選択してください</option>
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              )}
              {(kind === "定時" || kind === "早退" || kind === "残業") && (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                    {kind === "定時" ? "修正後の退勤時刻" : kind === "早退" ? "実際の退勤時刻" : "残業終了時刻"}
                  </label>
                  <select
                    value={timeOut}
                    onChange={(e) => setTimeOut(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
                  >
                    <option value="">選択してください</option>
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* 理由 */}
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                修正理由 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例：打刻忘れ、機器不具合など"
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none"
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isPending}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {isPending ? "申請中..." : "申請する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

