"use client";

import { useState, useTransition, useEffect } from "react";
import {
  recordDepartureAction,
  submitAbsenceAction,
  submitLateAction,
} from "./actions";
import { BellIcon, ChevronRightIcon } from "@/components/icons";

type HomeState = "pre_departure" | "pre_clock_in" | "working" | "clocked_out";
type ModalType = "none" | "departure" | "absence" | "late";

export interface HomeClientProps {
  isAdmin?: boolean;
  displayName: string;
  projectName: string;
  hasMultipleProjects: boolean;
  todayLabel: string;
  shift: { name: string | null; start: string | null; end: string | null } | null;
  departureTime: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  hasAbsenceReport: boolean;
  absenceStatus: string | null;
  hasLateReport: boolean;
  lateStatus: string | null;
  noticeCount: number;
  upcomingShifts?: { date: string; name: string | null; start: string | null; end: string | null }[];
  enableDeparture?: boolean;
  hasPrevAbsence?: boolean;
  nextDayHasShift?: boolean;
}

function nowJST(): string {
  return new Date().toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}
function reportBadge(s: string | null) {
  if (s === "approved") return "承認済";
  if (s === "rejected") return "却下";
  return "報告済";
}

function DepartureIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>
    </svg>
  );
}

const ETA_OPTS = [
  { label: "すぐ着く", value: 5 },  { label: "10分", value: 10 },
  { label: "20分",     value: 20 },  { label: "30分", value: 30 },
  { label: "45分",     value: 45 },  { label: "1時間以上", value: 60 },
];

function StatusBadge({ state }: { state: HomeState }) {
  const map = {
    pre_departure: { label: "未出発", textCls: "text-orange-500", dotCls: "bg-orange-400", pulse: false },
    pre_clock_in:  { label: "未出勤", textCls: "text-blue-500",   dotCls: "bg-blue-400",   pulse: false },
    working:       { label: "勤務中", textCls: "text-emerald-600",dotCls: "bg-emerald-500", pulse: true  },
    clocked_out:   { label: "退勤済", textCls: "text-zinc-400",   dotCls: "bg-zinc-300",   pulse: false },
  };
  const c = map[state];
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative flex h-3 w-3">
        {c.pulse && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex h-3 w-3 rounded-full ${c.dotCls}`} />
      </span>
      <span className={`text-[22px] font-bold tracking-tight ${c.textCls}`}>{c.label}</span>
    </div>
  );
}

function ModalWrap({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl w-full max-w-sm mx-4 p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
function YesNo({ onYes, onNo, pending }: { onYes: () => void; onNo: () => void; pending?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 mt-6">
      <button onClick={onYes} disabled={pending}
        className="py-4 rounded-2xl bg-blue-600 text-white text-[17px] font-semibold active:opacity-70 disabled:opacity-50">できます</button>
      <button onClick={onNo} disabled={pending}
        className="py-4 rounded-2xl bg-zinc-100 text-zinc-800 text-[17px] font-semibold active:opacity-70 disabled:opacity-50">できません</button>
    </div>
  );
}

const WD = ["日","月","火","水","木","金","土"];
function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）`;
}

const HR = () => <div className="border-t border-zinc-100 dark:border-zinc-800" />;

type Symptoms = {
  fever: boolean; fever_temp: string;
  headache: boolean; cough: boolean; fatigue: boolean;
  nausea: boolean; other: boolean; other_detail: string;
};
const initSymptoms: Symptoms = {
  fever: false, fever_temp: "", headache: false, cough: false,
  fatigue: false, nausea: false, other: false, other_detail: "",
};

function SymptomRow({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[14px] text-zinc-700 dark:text-zinc-300">{label}</span>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => onChange(true)}
          className={`px-3 py-1 rounded-lg text-[13px] font-semibold transition-colors ${
            value
              ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
          }`}>有</button>
        <button type="button" onClick={() => onChange(false)}
          className={`px-3 py-1 rounded-lg text-[13px] font-semibold transition-colors ${
            !value
              ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200"
              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
          }`}>無</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function HomeClient({
  displayName, todayLabel,
  shift, departureTime, clockInTime, clockOutTime,
  hasAbsenceReport, absenceStatus, hasLateReport, lateStatus, noticeCount,
  upcomingShifts, enableDeparture = true,
  hasPrevAbsence = false, nextDayHasShift = false,
}: HomeClientProps) {

  const [modal, setModal]            = useState<ModalType>("none");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback]      = useState<{ ok: boolean; msg: string } | null>(null);

  const [optDeparture, setOptDeparture] = useState(departureTime);
  const optClockIn  = clockInTime;
  const optClockOut = clockOutTime;

  const state: HomeState =
    optClockOut ? "clocked_out"
    : optClockIn ? "working"
    : (optDeparture || !enableDeparture) ? "pre_clock_in"
    : "pre_departure";

  const [etaDep, setEtaDep]         = useState(30);
  const [absReason, setAbsReason]   = useState("");
  const [symptoms, setSymptoms]     = useState<Symptoms>(initSymptoms);
  const [recoveryStatus, setRecoveryStatus] = useState<"改善"|"横ばい"|"悪化"|null>(null);
  const [hasConsultation, setHasConsultation] = useState<boolean|null>(null);
  const [absError, setAbsError]     = useState<string|null>(null);
  const [lateStep, setLateStep]     = useState<1|2>(1);
  const [lateReason, setLateReason] = useState("");
  const [lateEta, setLateEta]       = useState(30);

  const closeModal = () => {
    setModal("none");
    setAbsReason(""); setSymptoms(initSymptoms);
    setRecoveryStatus(null); setHasConsultation(null); setAbsError(null);
    setLateStep(1); setLateReason(""); setLateEta(30);
  };

  const handleDeparture = () => {
    const fd = new FormData(); fd.set("etaMinutes", String(etaDep));
    closeModal();
    startTransition(async () => {
      const r = await recordDepartureAction(fd);
      if (r.success) { setOptDeparture(nowJST()); setFeedback({ ok: true, msg: r.message ?? "出発報告しました" }); }
      else setFeedback({ ok: false, msg: r.message ?? "エラー" });
    });
  };
  const handleAbsenceSubmit = () => {
    if (!absReason.trim()) { setAbsError("理由を入力してください"); return; }
    if (hasConsultation === null) { setAbsError("当日受診予定を選択してください"); return; }
    setAbsError(null);
    const fd = new FormData();
    fd.set("reason", absReason);
    fd.set("symptomsJson", JSON.stringify(symptoms));
    fd.set("hasConsultation", String(hasConsultation));
    fd.set("nextDayHasShift", String(nextDayHasShift));
    if (recoveryStatus) fd.set("recoveryStatus", recoveryStatus);
    closeModal();
    startTransition(async () => {
      const r = await submitAbsenceAction(fd);
      setFeedback({ ok: r.success, msg: r.message ?? "欠勤報告しました" });
    });
  };
  const handleLate = () => {
    const fd = new FormData();
    fd.set("reason", lateReason); fd.set("expectedArrival", ""); fd.set("etaMinutes", String(lateEta));
    closeModal();
    startTransition(async () => {
      const r = await submitLateAction(fd);
      setFeedback({ ok: r.success, msg: r.message ?? "遅刻報告しました" });
    });
  };

  const canReport = state === "pre_departure" || state === "pre_clock_in";
  const isHoliday = shift?.name === "公休" || shift?.name === "休" || shift?.name === "公休日";

  const [liveTime, setLiveTime] = useState(nowJST);
  useEffect(() => {
    if (enableDeparture) return;
    const id = setInterval(() => setLiveTime(nowJST()), 1000);
    return () => clearInterval(id);
  }, [enableDeparture]);

  const [greeting, setGreeting] = useState("");
  useEffect(() => {
    const h = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })).getHours();
    setGreeting(h < 10 ? "おはようございます" : h < 17 ? "こんにちは" : "お疲れ様です");
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  // 打刻表示ヘルパー
  const stamp = (time: string | null | undefined) =>
    time
      ? <span className="text-[32px] font-light tabular-nums leading-none text-zinc-900 dark:text-zinc-100">{time}</span>
      : <span className="text-[16px] font-medium text-zinc-300 dark:text-zinc-700">未打刻</span>;

  return (
    <>
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="max-w-lg mx-auto px-5 pt-8 pb-32 flex flex-col gap-0">

        {/* ── ヘッダー ── */}
        <div className="flex items-start justify-between mb-6">
          <div>
            {greeting && <p className="text-[12px] text-zinc-400 mb-0.5">{greeting}</p>}
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {displayName}
            </h1>
          </div>
          <a href="/notices" className="relative mt-1">
            <BellIcon className="w-6 h-6 text-zinc-300 dark:text-zinc-600" />
            {noticeCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                {noticeCount > 99 ? "99+" : noticeCount}
              </span>
            )}
          </a>
        </div>

        {/* ── ステータスバッジ ── */}
        <div className="mb-5">
          <StatusBadge state={state} />
        </div>

        {/* ══════════ enableDeparture あり ══════════ */}
        {enableDeparture && (<>

          {/* 日付 + シフト */}
          <p className="text-[13px] text-zinc-400 tabular-nums mb-1">{todayLabel}</p>
          {shift && !isHoliday && (
            <p className="text-[17px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              {shift.name}
              {shift.start && <span className="ml-2 text-[14px] font-normal text-zinc-400 tabular-nums">{shift.start.slice(0,5)}–{shift.end?.slice(0,5) ?? "--:--"}</span>}
            </p>
          )}
          {shift && isHoliday && <p className="text-[17px] font-medium text-zinc-400 mb-1">公休日</p>}
          {!shift && <p className="text-[15px] text-zinc-300 mb-1">シフト未登録</p>}

          {/* 出発ボタン */}
          {state === "pre_departure" && (
            <button onClick={() => !isPending && setModal("departure")} disabled={isPending}
              className="mt-5 w-full h-[52px] rounded-2xl bg-blue-600 active:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 text-white text-[17px] font-semibold mb-2">
              <DepartureIcon className="w-[18px] h-[18px]" />
              {isPending ? "処理中..." : "出発報告する"}
            </button>
          )}

          <div className="mt-6 mb-6"><HR /></div>

          {/* 出発 / 出勤 / 退勤 タイムスタンプ */}
          <div className="flex gap-8 mb-6">
            {[
              { label: "出発", time: optDeparture },
              { label: "出勤", time: optClockIn },
              { label: "退勤", time: optClockOut },
            ].map(({ label, time }) => (
              <div key={label} className="flex flex-col gap-1.5">
                <span className="text-[11px] text-zinc-400 tracking-wide">{label}</span>
                {stamp(time)}
              </div>
            ))}
          </div>

        </>)}

        {/* ══════════ enableDeparture なし ══════════ */}
        {!enableDeparture && (<>

          {/* ライブクロック */}
          <p className="text-[54px] font-extralight tabular-nums leading-none tracking-tight text-zinc-900 dark:text-white mb-1">
            {liveTime}
          </p>
          <p className="text-[13px] text-zinc-400 tabular-nums mb-1">{todayLabel}</p>
          {shift && !isHoliday && (
            <p className="text-[16px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              {shift.name}
              {shift.start && <span className="ml-2 text-[14px] font-normal text-zinc-400 tabular-nums">{shift.start.slice(0,5)}–{shift.end?.slice(0,5) ?? "--:--"}</span>}
            </p>
          )}
          {shift && isHoliday && <p className="text-[16px] font-medium text-zinc-400 mb-1">公休日</p>}
          {!shift && <p className="text-[15px] text-zinc-300 mb-1">シフト未登録</p>}

          <div className="mt-6 mb-6"><HR /></div>

          {/* 出勤 / 退勤 タイムスタンプ */}
          <div className="flex gap-10 mb-6">
            {[
              { label: "出勤", time: optClockIn },
              { label: "退勤", time: optClockOut },
            ].map(({ label, time }) => (
              <div key={label} className="flex flex-col gap-1.5">
                <span className="text-[11px] text-zinc-400 tracking-wide">{label}</span>
                {stamp(time)}
              </div>
            ))}
          </div>

        </>)}

        {/* ── 欠勤・遅刻ボタン ── */}
        {canReport && (<>
          <HR />
          <div className="flex gap-3 mt-6 mb-6">
            {hasAbsenceReport ? (
              <a href="/absence-followup"
                className="flex-1 h-11 rounded-xl border border-blue-200 dark:border-blue-800 text-[14px] font-medium text-blue-600 dark:text-blue-400 active:bg-blue-50 dark:active:bg-blue-900/20 flex items-center justify-center transition-colors">
                経過報告
              </a>
            ) : (
              <button onClick={() => !isPending && setModal("absence")} disabled={isPending}
                className="flex-1 h-11 rounded-xl border border-zinc-200 dark:border-zinc-800 text-[14px] font-medium text-red-500 active:bg-red-50 disabled:opacity-40 transition-colors">
                欠勤報告
              </button>
            )}
            {hasLateReport ? (
              <div className="flex-1 h-11 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center">
                <span className="text-[12px] text-zinc-400">遅刻済 · {reportBadge(lateStatus)}</span>
              </div>
            ) : (
              <button onClick={() => !isPending && setModal("late")} disabled={isPending}
                className="flex-1 h-11 rounded-xl border border-zinc-200 dark:border-zinc-800 text-[14px] font-medium text-amber-500 active:bg-amber-50 disabled:opacity-40 transition-colors">
                遅刻報告
              </button>
            )}
          </div>
        </>)}

        {/* ── 次回出勤 ── */}
        {upcomingShifts && upcomingShifts.length > 0 && (<>
          <HR />
          <div className="mt-6">
            {upcomingShifts.map((s) => (
              <a key={s.date} href="/shifts"
                className="flex items-center justify-between py-3.5 border-b border-zinc-100 dark:border-zinc-800/60 last:border-b-0 active:opacity-60">
                <span className="text-[15px] text-zinc-700 dark:text-zinc-300">{fmtDate(s.date)}</span>
                <div className="flex items-center gap-1.5">
                  {s.name && <span className="text-[13px] font-semibold text-zinc-500">{s.name}</span>}
                  {s.start && <span className="text-[13px] tabular-nums text-zinc-400">{s.start.slice(0,5)}–{s.end?.slice(0,5) ?? "--:--"}</span>}
                  <ChevronRightIcon className="w-4 h-4 text-zinc-300" />
                </div>
              </a>
            ))}
          </div>
        </>)}

      </div>
    </main>

    {/* トースト */}
    {feedback && (
      <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-40 whitespace-nowrap px-5 py-3 rounded-2xl text-[14px] font-semibold shadow-xl ${
        feedback.ok ? "bg-zinc-900 text-white" : "bg-red-500 text-white"
      }`}>
        {feedback.msg}
      </div>
    )}

    {/* ════════ MODALS ════════ */}
    {modal === "departure" && (
      <ModalWrap onClose={closeModal}>
        <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50 mb-1">出発を報告する</h2>
        <p className="text-[13px] text-zinc-400 mb-5">到着予定を選んでください</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {ETA_OPTS.map(({ label, value }) => (
            <button key={value} onClick={() => setEtaDep(value)}
              className={`py-2.5 rounded-xl text-[15px] font-semibold active:opacity-70 ${
                etaDep === value ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-800"
              }`}>{label}</button>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={closeModal} className="flex-1 py-3 rounded-2xl bg-zinc-100 text-[17px] font-semibold text-zinc-600">キャンセル</button>
          <button onClick={handleDeparture} disabled={isPending} className="flex-1 py-3 rounded-2xl bg-blue-600 text-white text-[17px] font-semibold disabled:opacity-50">報告する</button>
        </div>
      </ModalWrap>
    )}

    {modal === "absence" && (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
        onClick={closeModal}>
        <div className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl w-full max-w-sm mx-0 sm:mx-4 shadow-2xl max-h-[92dvh] flex flex-col"
          onClick={e => e.stopPropagation()}>
          {/* ヘッダー（固定） */}
          <div className="px-5 pt-5 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0">
            <h2 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-50">欠員報告フォーマット</h2>
            <p className="text-[11px] text-red-500 mt-0.5">※当日9:00までに必ずご報告ください※</p>
          </div>
          {/* スクロール本体 */}
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            {/* 自動項目 */}
            <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3 space-y-1.5 text-[13px]">
              {[
                ["報告日",   todayLabel],
                ["報告者",   displayName],
                ["報告区分", "欠勤"],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <span className="text-zinc-400 w-16 flex-shrink-0">{k}</span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-200">{v}</span>
                </div>
              ))}
            </div>

            {/* 理由 */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                理由 <span className="text-red-500">*</span>
              </label>
              <textarea value={absReason} onChange={e => setAbsReason(e.target.value)}
                placeholder="例：発熱のため" rows={2}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[15px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>

            {/* 症状 */}
            <div>
              <p className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">症状等（可能な範囲で回答）</p>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                <SymptomRow label="発熱" value={symptoms.fever}
                  onChange={v => setSymptoms(s => ({ ...s, fever: v, fever_temp: v ? s.fever_temp : "" }))} />
                {symptoms.fever && (
                  <div className="flex items-center gap-2 py-2 pl-4">
                    <input type="number" value={symptoms.fever_temp}
                      onChange={e => setSymptoms(s => ({ ...s, fever_temp: e.target.value }))}
                      placeholder="36.5" step="0.1" min="35" max="42"
                      className="w-20 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[15px] text-center focus:outline-none focus:ring-1 focus:ring-blue-500/40" />
                    <span className="text-[13px] text-zinc-400">度</span>
                  </div>
                )}
                <SymptomRow label="頭痛" value={symptoms.headache}
                  onChange={v => setSymptoms(s => ({ ...s, headache: v }))} />
                <SymptomRow label="咳や喉の痛み" value={symptoms.cough}
                  onChange={v => setSymptoms(s => ({ ...s, cough: v }))} />
                <SymptomRow label="だるさ倦怠感" value={symptoms.fatigue}
                  onChange={v => setSymptoms(s => ({ ...s, fatigue: v }))} />
                <SymptomRow label="吐き気や嘔吐" value={symptoms.nausea}
                  onChange={v => setSymptoms(s => ({ ...s, nausea: v }))} />
                <SymptomRow label="その他" value={symptoms.other}
                  onChange={v => setSymptoms(s => ({ ...s, other: v, other_detail: v ? s.other_detail : "" }))} />
                {symptoms.other && (
                  <div className="py-2 pl-4">
                    <input type="text" value={symptoms.other_detail}
                      onChange={e => setSymptoms(s => ({ ...s, other_detail: e.target.value }))}
                      placeholder="内容を入力"
                      className="w-full px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[15px] focus:outline-none focus:ring-1 focus:ring-blue-500/40" />
                  </div>
                )}
              </div>
            </div>

            {/* 軽快状況（前日欠勤のみ） */}
            {hasPrevAbsence && (
              <div>
                <p className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 mb-2">軽快状況</p>
                <div className="grid grid-cols-3 gap-2">
                  {(["改善", "横ばい", "悪化"] as const).map(v => (
                    <button key={v} type="button"
                      onClick={() => setRecoveryStatus(prev => prev === v ? null : v)}
                      className={`py-2 rounded-xl text-[14px] font-semibold border-2 transition-colors ${
                        recoveryStatus === v
                          ? v === "改善"  ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-500 text-emerald-700 dark:text-emerald-300"
                          : v === "悪化"  ? "bg-red-50 dark:bg-red-900/30 border-red-500 text-red-700 dark:text-red-300"
                          : "bg-amber-50 dark:bg-amber-900/30 border-amber-500 text-amber-700 dark:text-amber-300"
                          : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
                      }`}>{v}</button>
                  ))}
                </div>
              </div>
            )}

            {/* 当日受診予定 */}
            <div>
              <p className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 mb-2">当日受診予定 <span className="text-red-500">*</span></p>
              <div className="grid grid-cols-2 gap-2">
                {([true, false] as const).map(v => (
                  <button key={String(v)} type="button" onClick={() => setHasConsultation(v)}
                    className={`py-2.5 rounded-xl text-[14px] font-semibold border-2 transition-colors ${
                      hasConsultation === v
                        ? v ? "bg-blue-50 dark:bg-blue-900/30 border-blue-500 text-blue-700 dark:text-blue-300"
                           : "bg-zinc-100 dark:bg-zinc-800 border-zinc-400 text-zinc-700 dark:text-zinc-200"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
                    }`}>{v ? "有" : "無"}</button>
                ))}
              </div>
            </div>

            {/* 自動項目（翌日） */}
            <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3 space-y-1.5 text-[13px]">
              <div className="flex gap-3">
                <span className="text-zinc-400 flex-1">翌日出勤予定</span>
                <span className={`font-semibold ${nextDayHasShift ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>
                  {nextDayHasShift ? "有" : "無"}
                </span>
                <span className="text-zinc-300 dark:text-zinc-600 text-[11px]">自動</span>
              </div>
              <div className="flex gap-3">
                <span className="text-zinc-400 flex-1">翌日出勤可否報告予定</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-200">17:00</span>
              </div>
            </div>

            {absError && <p className="text-[13px] text-red-500">{absError}</p>}
          </div>

          {/* フッターボタン（固定） */}
          <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex gap-3 flex-shrink-0">
            <button onClick={closeModal}
              className="flex-1 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-[16px] font-semibold text-zinc-600 dark:text-zinc-300">
              キャンセル
            </button>
            <button onClick={handleAbsenceSubmit} disabled={isPending}
              className="flex-1 py-3 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-[16px] font-semibold disabled:opacity-50 transition-colors">
              {isPending ? "送信中..." : "報告する"}
            </button>
          </div>
        </div>
      </div>
    )}

    {modal === "late" && (
      <ModalWrap onClose={closeModal}>
        {lateStep === 1 && (<>
          <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50 mb-1">遅刻を報告する</h2>
          <p className="text-[13px] text-zinc-400 mb-5">1 / 2</p>
          <textarea value={lateReason} onChange={e => setLateReason(e.target.value)}
            placeholder="遅刻の理由を入力..." rows={4}
            className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[16px] resize-none mb-4 focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
          <div className="flex gap-3">
            <button onClick={closeModal} className="flex-1 py-3 rounded-2xl bg-zinc-100 text-[17px] font-semibold text-zinc-600">キャンセル</button>
            <button onClick={() => setLateStep(2)} disabled={!lateReason.trim()} className="flex-1 py-3 rounded-2xl bg-amber-500 text-white text-[17px] font-semibold disabled:opacity-50">次へ</button>
          </div>
        </>)}
        {lateStep === 2 && (<>
          <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50 mb-1">到着予定</h2>
          <p className="text-[13px] text-zinc-400 mb-5">2 / 2</p>
          <div className="grid grid-cols-3 gap-2 mb-5">
            {ETA_OPTS.map(({ label, value }) => (
              <button key={value} onClick={() => setLateEta(value)}
                className={`py-2.5 rounded-xl text-[15px] font-semibold active:opacity-70 ${
                  lateEta === value ? "bg-amber-500 text-white" : "bg-zinc-100 text-zinc-800"
                }`}>{label}</button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setLateStep(1)} className="flex-1 py-3 rounded-2xl bg-zinc-100 text-[17px] font-semibold text-zinc-600">戻る</button>
            <button onClick={handleLate} disabled={isPending} className="flex-1 py-3 rounded-2xl bg-amber-500 text-white text-[17px] font-semibold disabled:opacity-50">{isPending ? "送信中..." : "報告する"}</button>
          </div>
        </>)}
      </ModalWrap>
    )}
    </>
  );
}
