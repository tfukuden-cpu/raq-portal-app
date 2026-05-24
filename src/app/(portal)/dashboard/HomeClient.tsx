"use client";

import { useState, useTransition, useEffect } from "react";
import {
  recordDepartureAction,
  submitAbsenceAction,
  submitLateAction,
} from "./actions";
import { BellIcon, CheckCircleIcon, ChevronRightIcon } from "@/components/icons";

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
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function statusBadge(s: string | null) {
  if (s === "approved") return "承認済";
  if (s === "rejected") return "却下";
  return "審査中";
}

function DepartureIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>
    </svg>
  );
}
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
    </svg>
  );
}

const ETA_OPTS = [
  { label: "すぐ着く", value: 5 },
  { label: "10分",     value: 10 },
  { label: "20分",     value: 20 },
  { label: "30分",     value: 30 },
  { label: "45分",     value: 45 },
  { label: "1時間以上", value: 60 },
];

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
        className="py-4 rounded-2xl bg-blue-600 text-white font-bold text-base active:scale-[0.97] disabled:opacity-50 transition-transform">
        できます
      </button>
      <button onClick={onNo} disabled={pending}
        className="py-4 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-bold text-base active:scale-[0.97] disabled:opacity-50 transition-transform">
        できません
      </button>
    </div>
  );
}

const WD = ["日","月","火","水","木","金","土"];
function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）`;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function HomeClient({
  displayName, projectName, hasMultipleProjects, todayLabel,
  shift, departureTime, clockInTime, clockOutTime,
  hasAbsenceReport, absenceStatus, hasLateReport, lateStatus, noticeCount,
  upcomingShifts, enableDeparture = true,
}: HomeClientProps) {

  const [modal, setModal]           = useState<ModalType>("none");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback]     = useState<{ ok: boolean; msg: string } | null>(null);

  const [optDeparture, setOptDeparture] = useState(departureTime);
  const optClockIn  = clockInTime;
  const optClockOut = clockOutTime;

  const state: HomeState =
    optClockOut ? "clocked_out"
    : optClockIn ? "working"
    : (optDeparture || !enableDeparture) ? "pre_clock_in"
    : "pre_departure";

  // 出発モーダル
  const [etaDep, setEtaDep] = useState(30);
  // 欠勤モーダル
  const [absStep, setAbsStep]   = useState<1|2|3>(1);
  const [absReason, setAbsReason] = useState("");
  const [absNextDay, setAbsNextDay] = useState(true);
  // 遅刻モーダル
  const [lateStep, setLateStep]   = useState<1|2>(1);
  const [lateReason, setLateReason] = useState("");
  const [lateEta, setLateEta]     = useState(30);

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
      setFeedback({ ok: r.success, msg: r.message ?? "" });
    });
  };
  const handleLate = () => {
    const fd = new FormData();
    fd.set("reason", lateReason); fd.set("expectedArrival", ""); fd.set("etaMinutes", String(lateEta));
    closeModal();
    startTransition(async () => {
      const r = await submitLateAction(fd);
      setFeedback({ ok: r.success, msg: r.message ?? "" });
    });
  };

  const canReport = state === "pre_departure" || state === "pre_clock_in";
  const isHoliday = shift?.name === "公休" || shift?.name === "休" || shift?.name === "公休日";

  // ライブクロック
  const [liveTime, setLiveTime] = useState(nowJST);
  useEffect(() => {
    if (enableDeparture) return;
    const id = setInterval(() => setLiveTime(nowJST()), 10000);
    return () => clearInterval(id);
  }, [enableDeparture]);

  // 挨拶
  const [greeting, setGreeting] = useState("");
  useEffect(() => {
    const h = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })).getHours();
    setGreeting(h < 10 ? "おはようございます" : h < 17 ? "こんにちは" : "お疲れ様です");
  }, []);

  // トースト自動消去
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  return (
    <>
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="max-w-md mx-auto px-6 pt-14 pb-32">

        {/* ── ヘッダー ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-10">
          <div>
            {greeting && (
              <p className="text-[12px] font-medium text-zinc-400 dark:text-zinc-600 mb-1 tracking-wide">
                {greeting}
              </p>
            )}
            <h1 className="text-[26px] font-bold tracking-tight text-zinc-900 dark:text-zinc-50 leading-none">
              {displayName}
            </h1>
          </div>
          <a href="/notices" className="relative p-1 -mr-1 mt-0.5">
            <BellIcon className="w-[22px] h-[22px] text-zinc-300 dark:text-zinc-700" />
            {noticeCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                {noticeCount > 99 ? "99+" : noticeCount}
              </span>
            )}
          </a>
        </div>

        {/* ═══════════════════════════════════════════════════
            出発報告あり
        ═══════════════════════════════════════════════════ */}
        {enableDeparture && (
          <div className="flex flex-col gap-8">

            {/* 日付 ＋ シフト */}
            <div>
              <p className="text-[13px] text-zinc-400 dark:text-zinc-600 tabular-nums mb-3">
                {todayLabel}
              </p>
              {!shift && (
                <p className="text-sm text-zinc-300 dark:text-zinc-700">シフト未登録</p>
              )}
              {shift && isHoliday && (
                <span className="text-sm font-medium text-zinc-400">公休日</span>
              )}
              {shift && !isHoliday && (
                <div className="flex items-baseline gap-3">
                  <span className="text-[22px] font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">
                    {shift.name}
                  </span>
                  {shift.start && (
                    <span className="text-base tabular-nums font-light text-zinc-400 dark:text-zinc-500">
                      {shift.start.slice(0,5)}<span className="mx-1 text-zinc-200 dark:text-zinc-800">–</span>{shift.end?.slice(0,5) ?? "--:--"}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ── 状態エリア ── */}
            {state === "pre_departure" ? (
              /* 出発報告ボタン（大型） */
              <button
                type="button"
                onClick={() => !isPending && setModal("departure")}
                disabled={isPending}
                className="w-full rounded-3xl bg-blue-600 hover:bg-blue-500 active:scale-[0.97] transition-all duration-150 py-10 flex flex-col items-center gap-4 shadow-xl shadow-blue-600/25"
              >
                <div className="w-16 h-16 rounded-[20px] bg-white/20 flex items-center justify-center">
                  <DepartureIcon className="w-8 h-8 text-white" />
                </div>
                <div className="text-center">
                  <p className="text-[20px] font-bold text-white tracking-tight">
                    {isPending ? "処理中..." : "出発報告"}
                  </p>
                  <p className="text-[12px] text-white/60 mt-1">タップして出発を知らせる</p>
                </div>
              </button>
            ) : (
              /* 状態バッジ（読み取り専用） */
              <div className={[
                "flex items-center gap-3 px-4 py-3.5 rounded-2xl",
                state === "working"
                  ? "bg-emerald-50 dark:bg-emerald-950/40"
                  : "bg-zinc-50 dark:bg-zinc-900",
              ].join(" ")}>
                {state === "working"
                  ? <CheckCircleIcon className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  : state === "pre_clock_in"
                    ? <ClockIcon className="w-5 h-5 text-zinc-400 flex-shrink-0" />
                    : <CheckCircleIcon className="w-5 h-5 text-zinc-400 flex-shrink-0" />
                }
                <div>
                  <p className={`text-sm font-semibold ${
                    state === "working"
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-zinc-600 dark:text-zinc-400"
                  }`}>
                    {state === "working" ? "勤務中"
                      : state === "pre_clock_in" ? "出勤未打刻"
                      : "退勤済み"}
                  </p>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
                    {state === "working" ? "退勤は現場端末で打刻してください"
                      : state === "pre_clock_in" ? "現場端末で出勤打刻してください"
                      : "お疲れ様でした！"}
                  </p>
                </div>
              </div>
            )}

            {/* タイムスタンプ（白地のまま、ボックスなし） */}
            <div className="grid grid-cols-3 px-1">
              {[
                { label: "出発", time: optDeparture },
                { label: "出勤", time: optClockIn },
                { label: "退勤", time: optClockOut },
              ].map(({ label, time }, i) => (
                <div key={label}
                  className={[
                    i === 1 ? "text-center border-x border-zinc-100 dark:border-zinc-800/60" : "",
                    i === 2 ? "text-right" : "",
                  ].join(" ")}>
                  <p className="text-[9px] tracking-[0.2em] uppercase text-zinc-300 dark:text-zinc-700 mb-2.5">
                    {label}
                  </p>
                  <p className={`text-[22px] font-light tabular-nums leading-none ${
                    time ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-200 dark:text-zinc-800"
                  }`}>
                    {time ?? "--:--"}
                  </p>
                </div>
              ))}
            </div>

            {/* 次回出勤 */}
            {upcomingShifts && upcomingShifts.length > 0 && (
              <a href="/shifts"
                className="block rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden hover:border-zinc-200 dark:hover:border-zinc-700 active:scale-[0.99] transition-all">
                <p className="px-5 pt-4 pb-2 text-[9px] tracking-[0.2em] uppercase font-semibold text-zinc-400 dark:text-zinc-600">
                  次回出勤
                </p>
                {upcomingShifts.map((s, i) => (
                  <div key={s.date}>
                    {i > 0 && <div className="mx-5 border-t border-zinc-50 dark:border-zinc-800/60" />}
                    <div className="flex items-center justify-between px-5 py-3">
                      <span className="text-[14px] font-medium text-zinc-700 dark:text-zinc-300">
                        {fmtDate(s.date)}
                      </span>
                      <div className="flex items-center gap-2">
                        {s.name && (
                          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-500">{s.name}</span>
                        )}
                        {s.start && (
                          <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-600">
                            {s.start.slice(0,5)}–{s.end?.slice(0,5) ?? "--:--"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-end gap-1 px-5 py-2.5 border-t border-zinc-50 dark:border-zinc-800/60">
                  <span className="text-[11px] text-zinc-300 dark:text-zinc-700">シフト表</span>
                  <ChevronRightIcon className="w-3 h-3 text-zinc-300 dark:text-zinc-700" />
                </div>
              </a>
            )}

            {/* 欠勤・遅刻 */}
            {canReport && (
              <div className="flex items-center justify-center gap-6">
                {hasAbsenceReport ? (
                  <span className="text-xs text-zinc-300 dark:text-zinc-700">
                    欠勤報告済（{statusBadge(absenceStatus)}）
                  </span>
                ) : (
                  <button onClick={() => !isPending && setModal("absence")} disabled={isPending}
                    className="text-[13px] font-medium text-zinc-400 hover:text-red-500 disabled:opacity-40 transition-colors">
                    欠勤報告
                  </button>
                )}
                <span className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
                {hasLateReport ? (
                  <span className="text-xs text-zinc-300 dark:text-zinc-700">
                    遅刻報告済（{statusBadge(lateStatus)}）
                  </span>
                ) : (
                  <button onClick={() => !isPending && setModal("late")} disabled={isPending}
                    className="text-[13px] font-medium text-zinc-400 hover:text-amber-500 disabled:opacity-40 transition-colors">
                    遅刻報告
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════
            出発報告なし（Apple 時計スタイル）
        ═══════════════════════════════════════════════════ */}
        {!enableDeparture && (
          <div className="flex flex-col gap-8">

            {/* Hero：日付 + 時計 */}
            <div>
              <p className="text-[13px] text-zinc-400 dark:text-zinc-600 tabular-nums mb-1">
                {todayLabel}
              </p>
              <p className="text-[88px] font-thin tabular-nums leading-none tracking-tight text-zinc-900 dark:text-white">
                {liveTime}
              </p>
            </div>

            {/* シフト情報 */}
            {shift && !isHoliday && (
              <div className="flex items-baseline gap-3">
                <span className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">
                  {shift.name}
                </span>
                {shift.start && (
                  <span className="text-base tabular-nums font-light text-zinc-400 dark:text-zinc-500">
                    {shift.start.slice(0,5)}<span className="mx-1 text-zinc-200 dark:text-zinc-800">–</span>{shift.end?.slice(0,5) ?? "--:--"}
                  </span>
                )}
              </div>
            )}
            {shift && isHoliday && <p className="text-sm font-medium text-zinc-400">公休日</p>}
            {!shift && <p className="text-sm text-zinc-300 dark:text-zinc-700">シフト未登録</p>}

            {/* 出勤 / 退勤タイムスタンプ */}
            <div className="grid grid-cols-2 px-1">
              {[
                { label: "出勤", time: optClockIn },
                { label: "退勤", time: optClockOut },
              ].map(({ label, time }, i) => (
                <div key={label}
                  className={i === 1 ? "text-right border-l border-zinc-100 dark:border-zinc-800/60" : ""}>
                  <p className="text-[9px] tracking-[0.2em] uppercase text-zinc-300 dark:text-zinc-700 mb-2.5">
                    {label}
                  </p>
                  <p className={`text-[28px] font-light tabular-nums leading-none ${
                    time ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-200 dark:text-zinc-800"
                  }`}>
                    {time ?? "--:--"}
                  </p>
                </div>
              ))}
            </div>

            {/* 欠勤・遅刻 */}
            {canReport && (
              <div className="flex items-center justify-center gap-6">
                {hasAbsenceReport ? (
                  <span className="text-xs text-zinc-300 dark:text-zinc-700">
                    欠勤報告済（{statusBadge(absenceStatus)}）
                  </span>
                ) : (
                  <button onClick={() => !isPending && setModal("absence")} disabled={isPending}
                    className="text-[13px] font-medium text-zinc-400 hover:text-red-500 disabled:opacity-40 transition-colors">
                    欠勤報告
                  </button>
                )}
                <span className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
                {hasLateReport ? (
                  <span className="text-xs text-zinc-300 dark:text-zinc-700">
                    遅刻報告済（{statusBadge(lateStatus)}）
                  </span>
                ) : (
                  <button onClick={() => !isPending && setModal("late")} disabled={isPending}
                    className="text-[13px] font-medium text-zinc-400 hover:text-amber-500 disabled:opacity-40 transition-colors">
                    遅刻報告
                  </button>
                )}
              </div>
            )}

            {/* 次回出勤 */}
            {upcomingShifts && upcomingShifts.length > 0 && (
              <a href="/shifts"
                className="block rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden hover:border-zinc-200 dark:hover:border-zinc-700 active:scale-[0.99] transition-all">
                <p className="px-5 pt-4 pb-2 text-[9px] tracking-[0.2em] uppercase font-semibold text-zinc-400 dark:text-zinc-600">
                  次回出勤
                </p>
                {upcomingShifts.map((s, i) => (
                  <div key={s.date}>
                    {i > 0 && <div className="mx-5 border-t border-zinc-50 dark:border-zinc-800/60" />}
                    <div className="flex items-center justify-between px-5 py-3">
                      <span className="text-[14px] font-medium text-zinc-700 dark:text-zinc-300">
                        {fmtDate(s.date)}
                      </span>
                      <div className="flex items-center gap-2">
                        {s.name && (
                          <span className="text-xs font-semibold text-zinc-500">{s.name}</span>
                        )}
                        {s.start && (
                          <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-600">
                            {s.start.slice(0,5)}–{s.end?.slice(0,5) ?? "--:--"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-end gap-1 px-5 py-2.5 border-t border-zinc-50 dark:border-zinc-800/60">
                  <span className="text-[11px] text-zinc-300 dark:text-zinc-700">シフト表</span>
                  <ChevronRightIcon className="w-3 h-3 text-zinc-300 dark:text-zinc-700" />
                </div>
              </a>
            )}

          </div>
        )}

      </div>
    </main>

    {/* トースト */}
    {feedback && (
      <div className={[
        "fixed bottom-24 left-1/2 -translate-x-1/2 z-40 whitespace-nowrap",
        "px-5 py-3 rounded-2xl text-sm font-semibold shadow-lg",
        feedback.ok
          ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
          : "bg-red-500 text-white",
      ].join(" ")}>
        {feedback.msg}
      </div>
    )}

    {/* ════════════ MODALS ════════════ */}

    {modal === "departure" && (
      <ModalWrap onClose={closeModal}>
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">出発を報告する</h2>
        <p className="text-xs text-zinc-500 mb-5">到着予定を選んでください</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {ETA_OPTS.map(({ label, value }) => (
            <button key={value} onClick={() => setEtaDep(value)}
              className={`py-2.5 rounded-xl text-sm font-semibold active:scale-[0.96] transition-all ${
                etaDep === value
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              }`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={closeModal}
            className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500">
            キャンセル
          </button>
          <button onClick={handleDeparture} disabled={isPending}
            className="flex-1 py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform">
            報告する
          </button>
        </div>
      </ModalWrap>
    )}

    {modal === "absence" && (
      <ModalWrap onClose={closeModal}>
        {absStep === 1 && (<>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">欠勤を報告する</h2>
          <p className="text-xs text-zinc-500 mb-5">1 / 3</p>
          <textarea value={absReason} onChange={e => setAbsReason(e.target.value)}
            placeholder="欠勤の理由を入力..." rows={4}
            className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none mb-4 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
          <div className="flex gap-3">
            <button onClick={closeModal}
              className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500">
              キャンセル
            </button>
            <button onClick={() => setAbsStep(2)} disabled={!absReason.trim()}
              className="flex-1 py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50">
              次へ
            </button>
          </div>
        </>)}
        {absStep === 2 && (<>
          <p className="text-xs text-zinc-500 mb-2">2 / 3</p>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 leading-snug">明日は<br/>出勤できますか？</h2>
          <YesNo onYes={() => { setAbsNextDay(true); setAbsStep(3); }} onNo={() => { setAbsNextDay(false); setAbsStep(3); }} />
          <button onClick={() => setAbsStep(1)} className="mt-3 w-full py-2 text-xs text-zinc-400">戻る</button>
        </>)}
        {absStep === 3 && (<>
          <p className="text-xs text-zinc-500 mb-2">3 / 3</p>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 leading-snug">明後日は<br/>出勤できますか？</h2>
          <YesNo
            onYes={() => handleAbsence(absNextDay, true)}
            onNo={() => handleAbsence(absNextDay, false)}
            pending={isPending} />
          <button onClick={() => setAbsStep(2)} className="mt-3 w-full py-2 text-xs text-zinc-400">戻る</button>
        </>)}
      </ModalWrap>
    )}

    {modal === "late" && (
      <ModalWrap onClose={closeModal}>
        {lateStep === 1 && (<>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">遅刻を報告する</h2>
          <p className="text-xs text-zinc-500 mb-5">1 / 2</p>
          <textarea value={lateReason} onChange={e => setLateReason(e.target.value)}
            placeholder="遅刻の理由を入力..." rows={4}
            className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none mb-4 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
          <div className="flex gap-3">
            <button onClick={closeModal}
              className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500">
              キャンセル
            </button>
            <button onClick={() => setLateStep(2)} disabled={!lateReason.trim()}
              className="flex-1 py-3 rounded-2xl bg-amber-500 text-white text-sm font-bold disabled:opacity-50">
              次へ
            </button>
          </div>
        </>)}
        {lateStep === 2 && (<>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">到着予定</h2>
          <p className="text-xs text-zinc-500 mb-5">2 / 2</p>
          <div className="grid grid-cols-3 gap-2 mb-5">
            {ETA_OPTS.map(({ label, value }) => (
              <button key={value} onClick={() => setLateEta(value)}
                className={`py-2.5 rounded-xl text-sm font-semibold active:scale-[0.96] transition-all ${
                  lateEta === value
                    ? "bg-amber-500 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setLateStep(1)}
              className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500">
              戻る
            </button>
            <button onClick={handleLate} disabled={isPending}
              className="flex-1 py-3 rounded-2xl bg-amber-500 text-white text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform">
              {isPending ? "送信中..." : "報告する"}
            </button>
          </div>
        </>)}
      </ModalWrap>
    )}
    </>
  );
}
