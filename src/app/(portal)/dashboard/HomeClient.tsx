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
}

function nowJST(): string {
  return new Date().toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}
function reportBadge(s: string | null) {
  if (s === "approved") return "承認済";
  if (s === "rejected") return "却下";
  return "審査中";
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

// ─────────────────────────────────────────────────────────────────────────────
export default function HomeClient({
  displayName, todayLabel,
  shift, departureTime, clockInTime, clockOutTime,
  hasAbsenceReport, absenceStatus, hasLateReport, lateStatus, noticeCount,
  upcomingShifts, enableDeparture = true,
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
  const [absStep, setAbsStep]       = useState<1|2|3>(1);
  const [absReason, setAbsReason]   = useState("");
  const [absNextDay, setAbsNextDay] = useState(true);
  const [lateStep, setLateStep]     = useState<1|2>(1);
  const [lateReason, setLateReason] = useState("");
  const [lateEta, setLateEta]       = useState(30);

  const closeModal = () => {
    setModal("none");
    setAbsStep(1); setAbsReason(""); setAbsNextDay(true);
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
  const handleAbsence = (nextDay: boolean, dayAfter: boolean) => {
    const fd = new FormData();
    fd.set("reason", absReason); fd.set("nextDay", String(nextDay)); fd.set("dayAfter", String(dayAfter));
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
              <div className="flex-1 h-11 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center">
                <span className="text-[12px] text-zinc-400">欠勤済 · {reportBadge(absenceStatus)}</span>
              </div>
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
      <ModalWrap onClose={closeModal}>
        {absStep === 1 && (<>
          <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50 mb-1">欠勤を報告する</h2>
          <p className="text-[13px] text-zinc-400 mb-5">1 / 3</p>
          <textarea value={absReason} onChange={e => setAbsReason(e.target.value)}
            placeholder="欠勤の理由を入力..." rows={4}
            className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[16px] resize-none mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          <div className="flex gap-3">
            <button onClick={closeModal} className="flex-1 py-3 rounded-2xl bg-zinc-100 text-[17px] font-semibold text-zinc-600">キャンセル</button>
            <button onClick={() => setAbsStep(2)} disabled={!absReason.trim()} className="flex-1 py-3 rounded-2xl bg-blue-600 text-white text-[17px] font-semibold disabled:opacity-50">次へ</button>
          </div>
        </>)}
        {absStep === 2 && (<>
          <p className="text-[13px] text-zinc-400 mb-2">2 / 3</p>
          <h2 className="text-[24px] font-bold text-zinc-900 dark:text-zinc-50 leading-snug">明日は<br/>出勤できますか？</h2>
          <YesNo onYes={() => { setAbsNextDay(true); setAbsStep(3); }} onNo={() => { setAbsNextDay(false); setAbsStep(3); }} />
          <button onClick={() => setAbsStep(1)} className="mt-3 w-full py-2 text-[15px] text-blue-500">戻る</button>
        </>)}
        {absStep === 3 && (<>
          <p className="text-[13px] text-zinc-400 mb-2">3 / 3</p>
          <h2 className="text-[24px] font-bold text-zinc-900 dark:text-zinc-50 leading-snug">明後日は<br/>出勤できますか？</h2>
          <YesNo onYes={() => handleAbsence(absNextDay, true)} onNo={() => handleAbsence(absNextDay, false)} pending={isPending} />
          <button onClick={() => setAbsStep(2)} className="mt-3 w-full py-2 text-[15px] text-blue-500">戻る</button>
        </>)}
      </ModalWrap>
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
