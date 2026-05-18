"use client";

import { useState, useTransition } from "react";
import {
  recordDepartureAction,
  submitAbsenceAction,
  submitLateAction,
} from "./actions";
import {
  BellIcon,
  CheckCircleIcon,
} from "@/components/icons";

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
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function statusBadge(status: string | null): string {
  if (status === "approved") return "承認済";
  if (status === "rejected") return "却下";
  return "審査中";
}

function DepartureIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24}
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24}
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  );
}

const ETA_OPTS = [
  { label: "すぐ着く", value: 5 },
  { label: "10分", value: 10 },
  { label: "20分", value: 20 },
  { label: "30分", value: 30 },
  { label: "45分", value: 45 },
  { label: "1時間以上", value: 60 },
];

// ── 共通モーダルラッパー ──
function ModalWrap({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-6 shadow-2xl shadow-black/20"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ── Yes/No ステップボタン ──
function YesNoButtons({
  onYes, onNo, yesPending,
}: { onYes: () => void; onNo: () => void; yesPending?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 mt-5">
      <button type="button" onClick={onYes} disabled={yesPending}
        className="py-5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg disabled:opacity-50 transition-colors">
        できます
      </button>
      <button type="button" onClick={onNo} disabled={yesPending}
        className="py-5 rounded-2xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold text-lg disabled:opacity-50 transition-colors">
        できません
      </button>
    </div>
  );
}

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
function fmtUpcomingDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAY_JP[d.getDay()]}）`;
}

export default function HomeClient({
  displayName, projectName, hasMultipleProjects, todayLabel,
  shift, departureTime, clockInTime, clockOutTime,
  hasAbsenceReport, absenceStatus, hasLateReport, lateStatus, noticeCount,
  upcomingShifts, enableDeparture = true,
}: HomeClientProps) {
  const [modal, setModal] = useState<ModalType>("none");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Optimistic timestamps
  const [optDeparture, setOptDeparture] = useState(departureTime);
  const optClockIn  = clockInTime;
  const optClockOut = clockOutTime;

  // Derived state（出発報告OFFの場合は pre_departure をスキップ）
  const state: HomeState = optClockOut ? "clocked_out"
    : optClockIn ? "working"
    : (optDeparture || !enableDeparture) ? "pre_clock_in"
    : "pre_departure";

  // 出発モーダル
  const [etaDep, setEtaDep] = useState(30);

  // 欠勤モーダル（3ステップ）
  const [absStep, setAbsStep] = useState<1 | 2 | 3>(1);
  const [absReason, setAbsReason] = useState("");
  const [absNextDay, setAbsNextDay] = useState(true);

  // 遅刻モーダル（2ステップ）
  const [lateStep, setLateStep] = useState<1 | 2>(1);
  const [lateReason, setLateReason] = useState("");
  const [lateEta, setLateEta] = useState(30);

  const closeModal = () => {
    setModal("none");
    setAbsStep(1); setAbsReason(""); setAbsNextDay(true);
    setLateStep(1); setLateReason(""); setLateEta(30);
  };

  // ── ハンドラ ──
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
    fd.set("reason", absReason);
    fd.set("nextDay", String(nextDay));
    fd.set("dayAfter", String(dayAfter));
    closeModal();
    startTransition(async () => {
      const r = await submitAbsenceAction(fd);
      setFeedback({ ok: r.success, msg: r.message ?? "" });
    });
  };

  const handleLate = () => {
    const fd = new FormData();
    fd.set("reason", lateReason);
    fd.set("expectedArrival", "");
    fd.set("etaMinutes", String(lateEta));
    closeModal();
    startTransition(async () => {
      const r = await submitLateAction(fd);
      setFeedback({ ok: r.success, msg: r.message ?? "" });
    });
  };

  const canReport = state === "pre_departure" || state === "pre_clock_in";
  const isHoliday = shift?.name === "公休" || shift?.name === "休" || shift?.name === "公休日";

  // ── 丸ボタン設定 ──
  type BtnDef = {
    label: string;
    sub: string;
    bg: string;
    Icon: ((p: { className?: string }) => React.JSX.Element) | null;
    pulse: boolean;
    onClick: (() => void) | null;
  };
  const BTN: Record<HomeState, BtnDef> = {
    pre_departure: {
      label: "出発報告", sub: "タップして出発を知らせる",
      bg: "bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-white",
      Icon: DepartureIcon, pulse: false, onClick: () => setModal("departure"),
    },
    pre_clock_in: {
      label: "出勤未打刻", sub: "現場端末で出勤打刻してください",
      bg: "bg-zinc-700/60 text-zinc-400",
      Icon: ClockIcon, pulse: false, onClick: null,
    },
    working: {
      label: "勤務中", sub: "退勤は現場端末で打刻してください",
      bg: "bg-emerald-900/40 text-emerald-400",
      Icon: CheckCircleIcon, pulse: false, onClick: null,
    },
    clocked_out: {
      label: "退勤済み", sub: "お疲れ様でした！",
      bg: "bg-zinc-700/60 text-zinc-500",
      Icon: CheckCircleIcon, pulse: false, onClick: null,
    },
  };
  const btn = BTN[state];

  return (
    <>
      <main className="min-h-screen bg-white dark:bg-zinc-950">
        <div className="max-w-sm mx-auto px-7 pt-10 pb-32 flex flex-col">

          {/* 氏名 + 通知 */}
          <div className="flex justify-between items-center mb-10">
            <p className="text-[13px] text-zinc-400">{displayName}</p>
            <a href="/notices" className="relative">
              <BellIcon className="w-5 h-5 text-zinc-300 dark:text-zinc-600" />
              {noticeCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {noticeCount > 99 ? "99+" : noticeCount}
                </span>
              )}
            </a>
          </div>

          {/* 日付：ページの主役 */}
          <h1 className="text-5xl font-bold tracking-tighter text-zinc-900 dark:text-white leading-[1.05] mb-3">
            {todayLabel}
          </h1>

          {/* シフト情報：小さなタグ */}
          <div className="mb-16">
            {!shift && (
              <p className="text-sm text-zinc-300 dark:text-zinc-700">シフト未登録</p>
            )}
            {shift && isHoliday && (
              <p className="text-sm text-zinc-400">公休日</p>
            )}
            {shift && !isHoliday && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{shift.name}</span>
                {shift.start && (
                  <span className="text-sm font-mono tabular-nums text-zinc-400">
                    {shift.start.slice(0, 5)}–{shift.end?.slice(0, 5) ?? "--:--"}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 状態ボタン */}
          <div className="flex flex-col items-center gap-4 mb-12">
            <button
              type="button"
              onClick={() => !isPending && btn.onClick?.()}
              disabled={!btn.onClick || isPending}
              className={[
                "w-32 h-32 rounded-full flex flex-col items-center justify-center gap-2",
                "font-semibold text-[15px] transition-transform duration-150 select-none",
                btn.onClick ? "active:scale-95" : "cursor-default",
                btn.bg,
              ].filter(Boolean).join(" ")}
            >
              {btn.Icon && <btn.Icon className="w-6 h-6" />}
              <span>{isPending ? "処理中..." : btn.label}</span>
            </button>
            <p className="text-[12px] text-zinc-400 text-center">{btn.sub}</p>
          </div>

          {/* タイムスタンプ */}
          {enableDeparture ? (
            <div className="grid grid-cols-3 mb-10">
              {[
                { label: "出発", time: optDeparture },
                { label: "出勤", time: optClockIn },
                { label: "退勤", time: optClockOut },
              ].map(({ label, time }, i) => (
                <div key={label} className={`${i === 1 ? "text-center" : i === 2 ? "text-right" : ""}`}>
                  <p className="text-[9px] tracking-[0.15em] text-zinc-300 dark:text-zinc-700 uppercase mb-2">{label}</p>
                  <p className={`text-xl font-light tabular-nums ${
                    time ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-200 dark:text-zinc-800"
                  }`}>
                    {time ?? "--:--"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 mb-10">
              {[
                { label: "出勤", time: optClockIn },
                { label: "退勤", time: optClockOut },
              ].map(({ label, time }, i) => (
                <div key={label} className={i === 1 ? "text-right" : ""}>
                  <p className="text-[9px] tracking-[0.15em] text-zinc-300 dark:text-zinc-700 uppercase mb-2">{label}</p>
                  <p className={`text-xl font-light tabular-nums ${
                    time ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-200 dark:text-zinc-800"
                  }`}>
                    {time ?? "--:--"}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* 次回出勤 */}
          {upcomingShifts && upcomingShifts.length > 0 && (
            <div className="mb-10">
              <p className="text-[9px] tracking-[0.15em] text-zinc-300 dark:text-zinc-700 uppercase mb-3">次回出勤</p>
              <div className="flex flex-col gap-2">
                {upcomingShifts.map((s) => (
                  <div key={s.date} className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500">{fmtUpcomingDate(s.date)}</span>
                    <div className="flex items-center gap-2">
                      {s.name && <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{s.name}</span>}
                      {s.start && (
                        <span className="text-xs font-mono tabular-nums text-zinc-400">
                          {s.start.slice(0, 5)}–{s.end?.slice(0, 5) ?? "--:--"}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 欠勤・遅刻：テキストリンクのみ */}
          {canReport && (
            <div className="flex items-center justify-center gap-8">
              {hasAbsenceReport ? (
                <span className="text-xs text-zinc-300 dark:text-zinc-700">
                  欠勤報告済（{statusBadge(absenceStatus)}）
                </span>
              ) : (
                <button type="button" onClick={() => !isPending && setModal("absence")} disabled={isPending}
                  className="text-sm text-zinc-400 hover:text-red-500 disabled:opacity-40 transition-colors">
                  欠勤報告
                </button>
              )}
              <span className="text-zinc-200 dark:text-zinc-800">|</span>
              {hasLateReport ? (
                <span className="text-xs text-zinc-300 dark:text-zinc-700">
                  遅刻報告済（{statusBadge(lateStatus)}）
                </span>
              ) : (
                <button type="button" onClick={() => !isPending && setModal("late")} disabled={isPending}
                  className="text-sm text-zinc-400 hover:text-amber-500 disabled:opacity-40 transition-colors">
                  遅刻報告
                </button>
              )}
            </div>
          )}

          {/* フィードバック */}
          {feedback && (
            <div className={`mt-8 text-sm text-center font-medium ${
              feedback.ok ? "text-emerald-500" : "text-red-500"
            }`}>
              {feedback.msg}
            </div>
          )}
        </div>
      </main>

      {/* ════════════════════════════ MODALS ════════════════════════════ */}

      {/* 出発報告 */}
      {modal === "departure" && (
        <ModalWrap onClose={closeModal}>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">出発を報告する</h2>
          <p className="text-xs text-zinc-500 mb-4">到着予定を選んでください</p>
          <div className="grid grid-cols-3 gap-2 mb-5">
            {ETA_OPTS.map(({ label, value }) => (
              <button key={value} type="button" onClick={() => setEtaDep(value)}
                className={`py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  etaDep === value ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={closeModal} className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500">キャンセル</button>
            <button type="button" onClick={handleDeparture} disabled={isPending} className="flex-1 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-50">報告する</button>
          </div>
        </ModalWrap>
      )}

      {/* 欠勤報告（3ステップ） */}
      {modal === "absence" && (
        <ModalWrap onClose={closeModal}>
          {/* Step 1: 理由 */}
          {absStep === 1 && (
            <>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">欠勤を報告する</h2>
              <p className="text-xs text-zinc-500 mb-4">管理者に通知が届きます（1/3）</p>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                理由 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={absReason}
                onChange={(e) => setAbsReason(e.target.value)}
                placeholder="欠勤の理由を入力..."
                rows={4}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none mb-4 text-zinc-900 dark:text-zinc-100"
              />
              <div className="flex gap-3">
                <button type="button" onClick={closeModal} className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500">キャンセル</button>
                <button type="button" onClick={() => setAbsStep(2)} disabled={!absReason.trim()}
                  className="flex-1 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-50">
                  次へ
                </button>
              </div>
            </>
          )}

          {/* Step 2: 翌日確認 */}
          {absStep === 2 && (
            <>
              <p className="text-xs text-zinc-500 mb-2">翌日の出勤確認（2/3）</p>
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 leading-tight">
                明日は<br />出勤できますか？
              </h2>
              <YesNoButtons
                onYes={() => { setAbsNextDay(true); setAbsStep(3); }}
                onNo={() => { setAbsNextDay(false); setAbsStep(3); }}
              />
              <div className="mt-3">
                <button type="button" onClick={() => setAbsStep(1)}
                  className="w-full py-2 text-xs text-zinc-400 hover:text-zinc-600">
                  戻る
                </button>
              </div>
            </>
          )}

          {/* Step 3: 翌々日確認 + 送信 */}
          {absStep === 3 && (
            <>
              <p className="text-xs text-zinc-500 mb-2">翌々日の出勤確認（3/3）</p>
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 leading-tight">
                明後日は<br />出勤できますか？
              </h2>
              <div className="grid grid-cols-2 gap-3 mt-5">
                <button type="button" onClick={() => handleAbsence(absNextDay, true)} disabled={isPending}
                  className="py-5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg disabled:opacity-50">
                  できます
                </button>
                <button type="button" onClick={() => handleAbsence(absNextDay, false)} disabled={isPending}
                  className="py-5 rounded-2xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold text-lg disabled:opacity-50">
                  できません
                </button>
              </div>
              <div className="mt-3">
                <button type="button" onClick={() => setAbsStep(2)}
                  className="w-full py-2 text-xs text-zinc-400 hover:text-zinc-600">
                  戻る
                </button>
              </div>
            </>
          )}
        </ModalWrap>
      )}

      {/* 遅刻報告（2ステップ） */}
      {modal === "late" && (
        <ModalWrap onClose={closeModal}>
          {/* Step 1: 理由 */}
          {lateStep === 1 && (
            <>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">遅刻を報告する</h2>
              <p className="text-xs text-zinc-500 mb-4">管理者に通知が届きます（1/2）</p>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                理由 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={lateReason}
                onChange={(e) => setLateReason(e.target.value)}
                placeholder="遅刻の理由を入力..."
                rows={4}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none mb-4 text-zinc-900 dark:text-zinc-100"
              />
              <div className="flex gap-3">
                <button type="button" onClick={closeModal} className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500">キャンセル</button>
                <button type="button" onClick={() => setLateStep(2)} disabled={!lateReason.trim()}
                  className="flex-1 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-50">
                  次へ
                </button>
              </div>
            </>
          )}

          {/* Step 2: 〇分後選択 + 送信 */}
          {lateStep === 2 && (
            <>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">到着予定（2/2）</h2>
              <p className="text-xs text-zinc-500 mb-4">何分後に到着しますか？</p>
              <div className="grid grid-cols-3 gap-2 mb-5">
                {ETA_OPTS.map(({ label, value }) => (
                  <button key={value} type="button" onClick={() => setLateEta(value)}
                    className={`py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                      lateEta === value ? "bg-amber-500 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setLateStep(1)}
                  className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500">
                  戻る
                </button>
                <button type="button" onClick={handleLate} disabled={isPending}
                  className="flex-1 py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold disabled:opacity-50">
                  {isPending ? "送信中..." : "報告する"}
                </button>
              </div>
            </>
          )}
        </ModalWrap>
      )}
    </>
  );
}
