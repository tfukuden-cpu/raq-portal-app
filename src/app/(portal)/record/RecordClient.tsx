"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { submitCorrectionAction } from "@/app/(portal)/corrections/actions";

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

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

type CorrectionSummary = { target_date: string; status: string };

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

type CorrKind = "定時" | "遅刻" | "早退" | "残業";
const KIND_LIST: CorrKind[] = ["定時", "遅刻", "早退", "残業"];
const KIND_INACTIVE: Record<CorrKind, string> = {
  定時: "border-blue-200 bg-blue-50 text-blue-600",
  遅刻: "border-red-200 bg-red-50 text-red-600",
  早退: "border-amber-200 bg-amber-50 text-amber-600",
  残業: "border-violet-200 bg-violet-50 text-violet-600",
};
const KIND_ACTIVE: Record<CorrKind, string> = {
  定時: "border-blue-600 bg-blue-600 text-white",
  遅刻: "border-red-600 bg-red-600 text-white",
  早退: "border-amber-500 bg-amber-500 text-white",
  残業: "border-violet-600 bg-violet-600 text-white",
};

function calcWorkedMins(inIso: string, outIso: string): number {
  return Math.round((new Date(outIso).getTime() - new Date(inIso).getTime()) / 60000);
}

function fmtWorked(inIso: string | null, outIso: string | null): string {
  if (!inIso || !outIso) return "-";
  const mins = calcWorkedMins(inIso, outIso);
  if (mins <= 0) return "-";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}時間${m}分` : `${h}時間`;
}

type StatusType = "ok" | "holiday" | "missing" | "pending" | "corrected";

function getRowStatus(r: DayRecord, corr?: CorrectionSummary): { label: string; type: StatusType } {
  const OFF = ["公休", "休", "公休日", "有休", "希望休", "特別休暇", "代休", "振替休日", "休暇"];
  const isHoliday = OFF.includes(r.shiftName ?? "");
  if (isHoliday || (!r.shiftName && !r.clockIn && !r.clockOut))
    return { label: "休日", type: "holiday" };
  if (corr?.status === "pending")   return { label: "修正待ち", type: "pending" };
  if (corr?.status === "approved")  return { label: "承認済", type: "corrected" };
  if (r.clockIn && r.clockOut)      return { label: "出勤済", type: "ok" };
  if (r.shiftStart)                 return { label: "未打刻", type: "missing" };
  return { label: "休日", type: "holiday" };
}

function StatusBadge({ label, type }: { label: string; type: StatusType }) {
  const base = "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold";
  if (type === "ok")       return <span className={`${base} bg-green-50 text-green-700 border border-green-200`}><CheckIcon />{ label}</span>;
  if (type === "holiday")  return <span className={`${base} bg-zinc-100 text-zinc-500 border border-zinc-200`}><CheckIcon />{ label}</span>;
  if (type === "missing")  return <span className={`${base} bg-orange-50 text-orange-700 border border-orange-200`}><WarnIcon />{ label}</span>;
  if (type === "pending")  return <span className={`${base} bg-orange-50 text-orange-700 border border-orange-200`}><ClockIcon />{ label}</span>;
  if (type === "corrected")return <span className={`${base} bg-blue-50 text-blue-700 border border-blue-200`}><CheckIcon />{ label}</span>;
  return null;
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><polyline points="20 6 9 17 4 12"/></svg>;
}
function WarnIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
}
function ClockIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
}
function EditIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
}

export default function RecordClient({
  records, corrections, projectName,
  year, month, prevMonth, nextMonth,
  workDays, totalStr, today, isFuture,
  scheduledDays, absentDays, lateDays, earlyDays, complianceRate,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [modal, setModal]   = useState<DayRecord | null>(null);
  const [kind, setKind]     = useState<CorrKind>("定時");
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError]   = useState<string | null>(null);

  const corrMap = new Map(corrections.map(c => [c.target_date, c]));
  const pendingCount   = corrections.filter(c => c.status === "pending").length;
  const missingCount   = records.filter(r => {
    const OFF = ["公休","休","公休日","有休","希望休","特別休暇","代休","振替休日","休暇"];
    return r.shiftStart && !r.clockIn && !OFF.includes(r.shiftName ?? "");
  }).length;
  const alertCount     = pendingCount + missingCount;
  const vacationDays   = records.filter(r => ["有休","希望休","特別休暇","代休","振替休日","休暇"].includes(r.shiftName ?? "")).length;

  const openModal = (r: DayRecord) => {
    setModal(r); setKind("定時");
    setTimeIn(r.shiftStart?.slice(0,5) ?? r.clockIn ?? "");
    setTimeOut(r.shiftEnd?.slice(0,5) ?? r.clockOut ?? "");
    setReason(""); setError(null);
  };
  const closeModal = () => { setModal(null); setError(null); };

  const handleKindChange = (k: CorrKind) => {
    setKind(k);
    if (!modal) return;
    if (k === "定時")      { setTimeIn(modal.shiftStart?.slice(0,5) ?? modal.clockIn ?? ""); setTimeOut(modal.shiftEnd?.slice(0,5) ?? modal.clockOut ?? ""); }
    else if (k === "遅刻") { setTimeIn(modal.clockIn ?? ""); setTimeOut(""); }
    else                   { setTimeIn(""); setTimeOut(modal.clockOut ?? ""); }
  };

  const handleSubmit = () => {
    if (!modal) return;
    setError(null);
    if (!reason.trim()) { setError("修正理由を入力してください"); return; }
    if (kind === "定時" && !timeIn && !timeOut) { setError("出勤または退勤時刻を選択してください"); return; }
    if (kind === "遅刻" && !timeIn)  { setError("出勤時刻を選択してください"); return; }
    if ((kind === "早退" || kind === "残業") && !timeOut) { setError("退勤時刻を選択してください"); return; }

    const corrIn  = (kind === "定時" || kind === "遅刻") ? timeIn : "";
    const corrOut = (kind === "定時" || kind === "早退" || kind === "残業") ? timeOut : "";
    const fd = new FormData();
    fd.set("targetDate", modal.date); fd.set("correctedIn", corrIn);
    fd.set("correctedOut", corrOut);  fd.set("reason", `[${kind}] ${reason}`);
    startTransition(async () => {
      const result = await submitCorrectionAction(fd);
      if (!result.success) setError(result.message ?? "申請失敗");
      else { closeModal(); router.refresh(); }
    });
  };

  return (
    <>
      <style>{`@media print{aside,nav.fixed,.no-print{display:none!important}[class*="md:pl-"]{padding-left:0!important}.pb-safe{padding-bottom:0!important}body{background:white!important;color:black!important}.record-table{border-radius:0!important;border:none!important}.record-table table{border-collapse:collapse!important;width:100%!important;font-size:10px!important}.record-table th,.record-table td{border:1px solid #d4d4d8!important;padding:5px 7px!important;background:white!important;color:black!important}.record-table thead tr{background:#f4f4f5!important}.record-table thead th{font-weight:600!important;color:#52525b!important;background:#f4f4f5!important}.print-show{display:block!important}.print-hide{display:none!important}}.print-show{display:none;}`}</style>

      <main className="min-h-screen bg-[#f4f6fa] dark:bg-zinc-950">
        <div className="max-w-6xl mx-auto px-4 md:px-8 pt-5 pb-12">

          {/* ── タイトル + タブ + 月ナビ ── */}
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <h1 className="text-[22px] font-bold text-[#0d1b35] dark:text-white">勤怠実績</h1>
            <div className="flex items-center gap-3">
              {/* 日別/週別/月別タブ（現在は日別のみ） */}
              <div className="flex border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                {["日別","週別","月別"].map((t, i) => (
                  <button key={t} type="button"
                    className={`px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                      i === 0
                        ? "bg-[#0d1b35] text-white"
                        : "bg-white dark:bg-zinc-900 text-zinc-400 hover:text-zinc-600"
                    } ${i > 0 ? "border-l border-zinc-200 dark:border-zinc-700" : ""}`}>
                    {t}
                  </button>
                ))}
              </div>
              {/* 月ナビ */}
              <div className="flex items-center gap-1 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 px-1">
                <a href={`/record?month=${prevMonth}`}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors">
                  <ChevronLeftIcon className="w-4 h-4" />
                </a>
                <span className="text-[13px] font-bold tabular-nums text-zinc-800 dark:text-zinc-100 px-1 min-w-[72px] text-center">
                  {year}年{String(month).padStart(2,"0")}月
                </span>
                <a href={`/record?month=${nextMonth}`}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors">
                  <ChevronRightIcon className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>

          {/* ── 統計カード行 ── */}
          <div className="grid grid-cols-2 md:grid-cols-8 gap-3 mb-4">
            {/* 総勤務時間（大カード） */}
            <div className="col-span-2 bg-[#0d1b35] dark:bg-zinc-800 rounded-2xl p-4 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-white/60 text-[11px] font-semibold">
                <ClockIcon /> 総勤務時間
              </div>
              <p className="text-[28px] font-bold text-white tabular-nums leading-tight">{totalStr}</p>
              <div className="flex items-center gap-2 text-[11px] text-white/50 tabular-nums">
                <span>所定 {scheduledDays}日</span>
                <span>出勤 {workDays}日</span>
              </div>
            </div>
            {/* 出勤日数 */}
            <StatCard label="出勤日数" value={`${workDays}日`} sub={`所定 ${scheduledDays}日`} />
            {/* 遅刻 */}
            <StatCard label="遅刻" value={`${lateDays}回`} />
            {/* 早退 */}
            <StatCard label="早退" value={`${earlyDays}回`} />
            {/* 欠勤 */}
            <StatCard label="欠勤" value={`${absentDays}日`} />
            {/* 休暇 */}
            <StatCard label="休暇" value={`${vacationDays}日`} />
            {/* 修正待ち */}
            <StatCard
              label="修正待ち"
              value={`${pendingCount}件`}
              sub={pendingCount > 0 ? "要確認" : undefined}
              accent={pendingCount > 0}
            />
          </div>

          {/* ── アラートバナー ── */}
          {alertCount > 0 && (
            <div className="mb-4 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center flex-shrink-0">
                  <WarnIcon />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-orange-800 dark:text-orange-300">確認が必要な勤怠があります</p>
                  <p className="text-[12px] text-orange-600 dark:text-orange-400">
                    未打刻や修正待ちの勤怠が {alertCount} 件あります。
                  </p>
                </div>
              </div>
              <span className="text-[12px] text-orange-600 dark:text-orange-400 font-medium whitespace-nowrap flex items-center gap-0.5">
                該当日を確認 <ChevronRightIcon className="w-3.5 h-3.5" />
              </span>
            </div>
          )}

          {/* ── テーブル ── */}
          {isFuture ? (
            <p className="text-[13px] text-zinc-500 text-center py-10">未来の月は表示できません</p>
          ) : (
            <div className="record-table bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden shadow-sm">
              <table className="w-full min-w-[700px] border-collapse">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-800/40">
                    {["日付","曜日","ステータス","予定時間","開始時間","終了時間","勤務時間","備考","修正申請"].map((h, i) => (
                      <th key={h} className={`px-4 py-3 text-[11px] font-bold text-zinc-500 dark:text-zinc-400 whitespace-nowrap ${i <= 1 ? "text-left" : "text-center"} ${i >= 7 ? "no-print" : ""}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/80">
                  {records.map((r) => {
                    const isToday = r.date === today;
                    const isSun   = r.dow === 0;
                    const isSat   = r.dow === 6;
                    const corr    = corrMap.get(r.date);
                    const status  = getRowStatus(r, corr);
                    const OFF     = ["公休","休","公休日","有休","希望休","特別休暇","代休","振替休日","休暇"];
                    const isHoliday = OFF.includes(r.shiftName ?? "");
                    const hasData   = !!(r.clockIn || r.clockOut || r.shiftName);
                    const canApply  = !isHoliday && hasData && !corr;
                    const needsAttn = status.type === "missing" || status.type === "pending";
                    const note      = corr?.status === "pending" ? "申請中"
                                    : corr?.status === "approved" ? "承認済"
                                    : isHoliday ? "休日" : "";

                    return (
                      <tr key={r.date}
                        className={`transition-colors ${
                          isToday   ? "bg-blue-50/60 dark:bg-blue-950/20"
                          : isHoliday ? "bg-zinc-50/50 dark:bg-zinc-900/30"
                          : "hover:bg-zinc-50/60 dark:hover:bg-zinc-800/20"
                        }`}>

                        {/* 日付 */}
                        <td className={`px-4 py-3 text-[13px] font-bold tabular-nums whitespace-nowrap ${
                          isToday ? "text-blue-600 dark:text-blue-400"
                          : isSun ? "text-red-500 dark:text-red-400"
                          : "text-zinc-700 dark:text-zinc-300"
                        }`}>
                          {Number(r.date.slice(8))}日
                        </td>

                        {/* 曜日 */}
                        <td className={`px-3 py-3 text-[12px] font-semibold ${
                          isSun ? "text-red-400" : isSat ? "text-blue-400" : "text-zinc-400"
                        }`}>
                          {WEEKDAY_JP[r.dow]}
                        </td>

                        {/* ステータスバッジ */}
                        <td className="px-3 py-3 text-center">
                          <StatusBadge label={status.label} type={status.type} />
                        </td>

                        {/* 予定時間 */}
                        <td className="px-3 py-3 text-center text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                          {r.shiftStart
                            ? <>{r.shiftStart.slice(0,5)} - {r.shiftEnd?.slice(0,5) ?? "--:--"}</>
                            : <span className="text-zinc-300 dark:text-zinc-600">-</span>}
                        </td>

                        {/* 開始時間 */}
                        <td className={`px-3 py-3 text-center text-[13px] font-semibold tabular-nums whitespace-nowrap ${
                          r.clockIn ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-300 dark:text-zinc-600"
                        }`}>
                          {r.clockIn ?? "-"}
                        </td>

                        {/* 終了時間 */}
                        <td className={`px-3 py-3 text-center text-[13px] font-semibold tabular-nums whitespace-nowrap ${
                          r.clockOut ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-300 dark:text-zinc-600"
                        }`}>
                          {r.clockOut ?? "-"}
                        </td>

                        {/* 勤務時間 */}
                        <td className="px-3 py-3 text-center text-[13px] font-semibold tabular-nums whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                          {fmtWorked(r.clockInIso, r.clockOutIso)}
                        </td>

                        {/* 備考 */}
                        <td className="px-3 py-3 text-center text-[11px] text-zinc-400 whitespace-nowrap">
                          {note || "-"}
                        </td>

                        {/* 修正申請 */}
                        <td className="no-print px-4 py-3 text-center whitespace-nowrap">
                          {canApply && (
                            needsAttn ? (
                              <button type="button" onClick={() => openModal(r)}
                                className="px-3 py-1.5 bg-[#0d1b35] text-white text-[11px] font-bold rounded-lg hover:bg-[#162b50] transition-colors">
                                修正申請
                              </button>
                            ) : (
                              <button type="button" onClick={() => openModal(r)}
                                className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                                <EditIcon />
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

      {/* 修正申請モーダル */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="text-[15px] font-bold text-zinc-900 dark:text-zinc-50">打刻補正申請</h2>
              <p className="text-[13px] text-zinc-400 mt-0.5">
                {Number(modal.date.slice(5,7))}月{Number(modal.date.slice(8))}日（{WEEKDAY_JP[modal.dow]}）
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-2">区分を選択</p>
              <div className="grid grid-cols-4 gap-1.5">
                {KIND_LIST.map(k => (
                  <button key={k} type="button" onClick={() => handleKindChange(k)}
                    className={`py-2 rounded-lg text-[11px] font-bold border transition-colors ${kind === k ? KIND_ACTIVE[k] : KIND_INACTIVE[k]}`}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {(kind === "定時" || kind === "遅刻") && (
                <div>
                  <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                    {kind === "遅刻" ? "実際の出勤時刻" : "修正後の出勤時刻"}
                  </label>
                  <select value={timeIn} onChange={e => setTimeIn(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[13px]">
                    <option value="">選択してください</option>
                    {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}
              {(kind === "定時" || kind === "早退" || kind === "残業") && (
                <div>
                  <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                    {kind === "定時" ? "修正後の退勤時刻" : kind === "早退" ? "実際の退勤時刻" : "残業終了時刻"}
                  </label>
                  <select value={timeOut} onChange={e => setTimeOut(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[13px]">
                    <option value="">選択してください</option>
                    {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                修正理由 <span className="text-red-500">*</span>
              </label>
              <textarea value={reason} onChange={e => setReason(e.target.value)}
                placeholder="例：打刻忘れ、機器不具合など" rows={3}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[13px] resize-none" />
            </div>
            {error && <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={closeModal}
                className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-[13px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                キャンセル
              </button>
              <button type="button" onClick={handleSubmit} disabled={isPending}
                className="flex-1 py-2.5 rounded-xl bg-[#0d1b35] hover:bg-[#162b50] disabled:opacity-50 text-white text-[13px] font-semibold transition-colors">
                {isPending ? "申請中..." : "申請する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── 統計カード ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-3.5 flex flex-col gap-1">
      <p className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">{label}</p>
      <p className={`text-[22px] font-bold tabular-nums leading-none ${accent ? "text-orange-500" : "text-[#0d1b35] dark:text-white"}`}>
        {value}
      </p>
      {sub && <p className={`text-[10px] tabular-nums ${accent ? "text-orange-400" : "text-zinc-400"}`}>{sub}</p>}
    </div>
  );
}
