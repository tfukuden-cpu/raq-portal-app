"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitCorrectionAction } from "@/app/(portal)/corrections/actions";
import { RpgWindow, BlinkCursor, dotGothic, RPG_PAGE_BG, RPG_KEYFRAMES, RpgStarfield } from "@/components/rpg-ui";

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
  定時: "border-white/40 text-white/70",
  遅刻: "border-red-400/50 text-red-300",
  早退: "border-amber-300/50 text-amber-300",
  残業: "border-violet-400/50 text-violet-300",
};
const KIND_ACTIVE: Record<CorrKind, string> = {
  定時: "border-white bg-white/15 text-white",
  遅刻: "border-red-400 bg-red-500/25 text-red-100",
  早退: "border-amber-300 bg-amber-400/25 text-amber-100",
  残業: "border-violet-400 bg-violet-500/25 text-violet-100",
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
    return { label: "おやすみ", type: "holiday" };
  if (corr?.status === "pending")   return { label: "しんせいちゅう", type: "pending" };
  if (corr?.status === "approved")  return { label: "しょうにん済", type: "corrected" };
  if (r.clockIn && r.clockOut)      return { label: "しゅつげき済", type: "ok" };
  if (r.shiftStart)                 return { label: "みだこく", type: "missing" };
  return { label: "おやすみ", type: "holiday" };
}

const STATUS_CLASS: Record<StatusType, string> = {
  ok:        "text-emerald-300 border-emerald-400/60 bg-emerald-500/10",
  holiday:   "text-white/50 border-white/25 bg-white/5",
  missing:   "text-amber-300 border-amber-300/60 bg-amber-400/10",
  pending:   "text-amber-300 border-amber-300/60 bg-amber-400/10",
  corrected: "text-cyan-300 border-cyan-400/60 bg-cyan-500/10",
};

function StatusBadge({ label, type }: { label: string; type: StatusType }) {
  const icon = type === "missing" || type === "pending" ? <WarnIcon />
    : type === "corrected" ? <ClockIcon /> : <CheckIcon />;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border ${STATUS_CLASS[type]}`}>
      {icon}{label}
    </span>
  );
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
  records, corrections,
  year, month, prevMonth, nextMonth,
  workDays, totalStr, today, isFuture,
  scheduledDays, absentDays, lateDays, earlyDays,
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
    return r.shiftStart && !r.clockIn && !OFF.includes(r.shiftName ?? "") && r.date <= today;
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
      <style>{`@media print{aside,nav.fixed,.no-print{display:none!important}[class*="md:pl-"]{padding-left:0!important}.pb-safe{padding-bottom:0!important}body{background:white!important;color:black!important}.record-table{border-radius:0!important;border:none!important;background:white!important}.record-table table{border-collapse:collapse!important;width:100%!important;font-size:10px!important}.record-table th,.record-table td{border:1px solid #d4d4d8!important;padding:5px 7px!important;background:white!important;color:black!important}.record-table thead tr{background:#f4f4f5!important}.record-table thead th{font-weight:600!important;color:#52525b!important;background:#f4f4f5!important}}`}{RPG_KEYFRAMES}</style>

      <main className={`flex flex-col min-h-[100dvh] md:h-dvh md:overflow-hidden ${dotGothic.className}`} style={{ background: RPG_PAGE_BG }}>

        {/* ── ヘッダー（星空＋タイトル＋月ナビ） ── */}
        <div className="relative shrink-0 w-full px-4 md:px-8 pt-5 pb-3 overflow-hidden">
          <RpgStarfield />
          <div className="relative flex items-center justify-between flex-wrap gap-3">
            <h1 className="text-[20px] md:text-[22px] text-white">★ きんむ きろく</h1>
            {/* 月ナビ */}
            <div className="flex items-center gap-1">
              <a href={`/record?month=${prevMonth}`}
                className="w-8 h-8 flex items-center justify-center rounded border border-amber-300/60 text-amber-300 hover:bg-amber-300/10 transition-colors">◀</a>
              <span className="text-[14px] text-white tabular-nums px-2 min-w-[100px] text-center">
                {year}年{String(month).padStart(2,"0")}月
              </span>
              <a href={`/record?month=${nextMonth}`}
                className="w-8 h-8 flex items-center justify-center rounded border border-amber-300/60 text-amber-300 hover:bg-amber-300/10 transition-colors">▶</a>
            </div>
          </div>
        </div>

        {/* ── スクロール領域 ── */}
        <div className="flex-1 md:min-h-0 overflow-y-auto px-4 md:px-8 pb-36 md:pb-6 space-y-3.5">

          {/* メッセージウィンドウ */}
          <RpgWindow>
            <div className="px-4 py-3">
              <p className="text-[13px] md:text-[14px] text-white leading-relaxed">
                ＊「こんげつの きんむきろくだ。みだこくは そのひの ▶ボタンから ほうこく できるぞ。<BlinkCursor /></p>
            </div>
          </RpgWindow>

          {isFuture ? (
            <RpgWindow>
              <div className="px-4 py-10 text-center text-[13px] text-white/60">みらいの つきは まだ みられない。</div>
            </RpgWindow>
          ) : (
            <>
              {/* 総勤務時間 */}
              <RpgWindow title="そうかつ">
                <div className="px-4 py-3.5 flex items-center justify-between">
                  <div>
                    <p className="flex items-center gap-1.5 text-white/60 text-[11px] mb-0.5"><ClockIcon /> そうきんむ じかん</p>
                    <p className="text-[26px] text-amber-300 tabular-nums leading-tight">{totalStr}</p>
                  </div>
                  <div className="text-right text-[11px] text-white/55 tabular-nums space-y-0.5">
                    <p>しょてい {scheduledDays}日</p>
                    <p>しゅっきん {workDays}日</p>
                  </div>
                </div>
              </RpgWindow>

              {/* 統計（6項目） */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                <StatCard label="しゅっきん" value={`${workDays}日`} sub={`しょてい${scheduledDays}`} />
                <StatCard label="ちこく" value={`${lateDays}回`} />
                <StatCard label="そうたい" value={`${earlyDays}回`} />
                <StatCard label="けっきん" value={`${absentDays}日`} />
                <StatCard label="きゅうか" value={`${vacationDays}日`} />
                <StatCard label="しんせい中" value={`${pendingCount}件`} sub={pendingCount > 0 ? "ようかくにん" : undefined} accent={pendingCount > 0} />
              </div>

              {/* アラート */}
              {alertCount > 0 && (
                <RpgWindow>
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 text-amber-300">
                      <WarnIcon />
                      <div>
                        <p className="text-[13px]">かくにんが ひつような きんむが あるぞ</p>
                        <p className="text-[11px] text-amber-300/80">みだこく・しんせいちゅうが {alertCount}けん。したの ひょうで ▶を おそう。</p>
                      </div>
                    </div>
                  </div>
                </RpgWindow>
              )}

              {/* 勤怠テーブル */}
              <RpgWindow title="★きんむの きろく" bodyClassName="overflow-hidden">
                <div className="record-table overflow-x-auto">
                  <table className="w-full min-w-[480px] border-separate border-spacing-0 text-white">
                    <thead>
                      <tr>
                        {["日","曜","じょうたい","よてい","しゅっきん","たいきん","きんむ"].map((h, i) => (
                          <th key={h} className={`sticky top-0 z-10 bg-[#000846] px-2 py-2 text-[10px] text-white/60 whitespace-nowrap border-b border-white/30 ${i <= 1 ? "text-center" : i === 0 ? "text-left" : "text-center"}`}>{h}</th>
                        ))}
                        <th className="no-print sticky top-0 z-10 bg-[#000846] px-2 py-2 text-[10px] text-white/60 text-center whitespace-nowrap w-12 border-b border-white/30">しんせい</th>
                      </tr>
                    </thead>
                    <tbody>
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

                        return (
                          <tr key={r.date}
                            className={`border-b border-white/10 ${isToday ? "bg-amber-400/10" : isHoliday ? "bg-white/[0.03]" : ""}`}>
                            <td className={`px-2 py-2 text-[13px] tabular-nums whitespace-nowrap ${isToday ? "text-amber-300" : isSun ? "text-red-400" : "text-white/90"}`}>
                              {Number(r.date.slice(8))}
                            </td>
                            <td className={`px-1 py-2 text-[11px] text-center ${isSun ? "text-red-400" : isSat ? "text-cyan-300" : "text-white/45"}`}>
                              {WEEKDAY_JP[r.dow]}
                            </td>
                            <td className="px-2 py-2 text-center"><StatusBadge label={status.label} type={status.type} /></td>
                            <td className="px-2 py-2 text-center text-[11px] tabular-nums text-white/45 whitespace-nowrap">
                              {r.shiftStart
                                ? <>{r.shiftStart.slice(0,5)}<br />{r.shiftEnd?.slice(0,5) ?? "─"}</>
                                : <span className="text-white/25">─</span>}
                            </td>
                            <td className={`px-2 py-2 text-center text-[12px] tabular-nums whitespace-nowrap ${r.clockIn ? "text-white" : "text-white/25"}`}>{r.clockIn ?? "─"}</td>
                            <td className={`px-2 py-2 text-center text-[12px] tabular-nums whitespace-nowrap ${r.clockOut ? "text-white" : "text-white/25"}`}>{r.clockOut ?? "─"}</td>
                            <td className="px-2 py-2 text-center text-[12px] tabular-nums whitespace-nowrap text-white/80">{fmtWorked(r.clockInIso, r.clockOutIso)}</td>
                            <td className="no-print px-2 py-2 text-center whitespace-nowrap">
                              {canApply && (
                                needsAttn ? (
                                  <button type="button" onClick={() => openModal(r)}
                                    className="px-2 py-1 border border-amber-300 text-amber-300 text-[10px] rounded hover:bg-amber-300/15 transition-colors">▶</button>
                                ) : (
                                  <button type="button" onClick={() => openModal(r)}
                                    className="w-6 h-6 inline-flex items-center justify-center rounded border border-white/30 text-white/50 hover:bg-white/10 transition-colors"><EditIcon /></button>
                                )
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </RpgWindow>
            </>
          )}
        </div>
      </main>

      {/* 修正申請モーダル（RPG枠） */}
      {modal && (
        <div className={`fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4 ${dotGothic.className}`} onClick={closeModal}>
          <div className="w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <RpgWindow title="だこく ほせい しんせい">
              <div className="px-5 py-4 space-y-4">
                <p className="text-[12px] text-white/60">
                  {Number(modal.date.slice(5,7))}月{Number(modal.date.slice(8))}日（{WEEKDAY_JP[modal.dow]}）
                </p>
                <div>
                  <p className="text-[11px] text-white/70 mb-2">くぶんを えらぶ</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {KIND_LIST.map(k => (
                      <button key={k} type="button" onClick={() => handleKindChange(k)}
                        className={`py-2 rounded text-[11px] border transition-colors ${kind === k ? KIND_ACTIVE[k] : KIND_INACTIVE[k]}`}>
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  {(kind === "定時" || kind === "遅刻") && (
                    <div>
                      <label className="block text-[11px] text-white/70 mb-1">
                        {kind === "遅刻" ? "じっさいの しゅっきん時刻" : "しゅうせいご しゅっきん時刻"}
                      </label>
                      <select value={timeIn} onChange={e => setTimeIn(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-white/40 bg-[#02040f] text-white text-[13px]">
                        <option value="">えらんでください</option>
                        {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                  {(kind === "定時" || kind === "早退" || kind === "残業") && (
                    <div>
                      <label className="block text-[11px] text-white/70 mb-1">
                        {kind === "定時" ? "しゅうせいご たいきん時刻" : kind === "早退" ? "じっさいの たいきん時刻" : "ざんぎょう しゅうりょう時刻"}
                      </label>
                      <select value={timeOut} onChange={e => setTimeOut(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-white/40 bg-[#02040f] text-white text-[13px]">
                        <option value="">えらんでください</option>
                        {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-[11px] text-white/70 mb-1">しゅうせい りゆう <span className="text-red-400">*</span></label>
                  <textarea value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="れい：だこく わすれ、きき ふぐあい など" rows={3}
                    className="w-full px-3 py-2 rounded border border-white/40 bg-[#02040f] text-white text-[13px] resize-none placeholder:text-white/30" />
                </div>
                {error && <p className="text-[13px] text-red-400">{error}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={closeModal}
                    className="flex-1 py-2.5 rounded border border-white/40 text-[13px] text-white/70 hover:bg-white/10 transition-colors">
                    やめる
                  </button>
                  <button type="button" onClick={handleSubmit} disabled={isPending}
                    className="flex-1 py-2.5 rounded border-2 border-amber-300 text-amber-300 text-[13px] hover:bg-amber-300/15 disabled:opacity-50 transition-colors">
                    {isPending ? "しんせい中..." : "▶しんせいする"}
                  </button>
                </div>
              </div>
            </RpgWindow>
          </div>
        </div>
      )}
    </>
  );
}

// ── 統計カード（RPGミニ枠） ──
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-white/40 bg-[#000846] px-2.5 py-2 flex flex-col gap-0.5">
      <p className="text-[10px] text-white/55">{label}</p>
      <p className={`text-[18px] tabular-nums leading-none ${accent ? "text-amber-300" : "text-white"}`}>{value}</p>
      {sub && <p className={`text-[9px] tabular-nums ${accent ? "text-amber-300/80" : "text-white/40"}`}>{sub}</p>}
    </div>
  );
}
