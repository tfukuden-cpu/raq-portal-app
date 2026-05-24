"use client";

import { useState, useTransition, useEffect } from "react";
import {
  recordDepartureAction,
  submitAbsenceAction,
  submitLateAction,
} from "./actions";
import {
  BellIcon,
  CheckCircleIcon,
  ChevronRightIcon,
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
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
    </svg>
  );
}

function ClockInIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
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

// ── 共通モーダルラッパー ──────────────────────────────────────────
function ModalWrap({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ── はい/いいえ ボタン ───────────────────────────────────────────
function YesNoButtons({ onYes, onNo, yesPending }: { onYes: () => void; onNo: () => void; yesPending?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 mt-5">
      <button type="button" onClick={onYes} disabled={yesPending}
        className="py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.97] text-white font-bold text-base disabled:opacity-50 transition-all">
        できます
      </button>
      <button type="button" onClick={onNo} disabled={yesPending}
        className="py-4 rounded-2xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-[0.97] text-zinc-700 dark:text-zinc-200 font-bold text-base disabled:opacity-50 transition-all">
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

// ── 状態ごとのスタイル定義 ────────────────────────────────────────
type StateConfig = {
  label: string;
  sub: string;
  cardBg: string;
  iconBg: string;
  labelColor: string;
  Icon: ((p: { className?: string }) => React.JSX.Element) | null;
  clickable: boolean;
};
const STATE_CONFIG: Record<HomeState, StateConfig> = {
  pre_departure: {
    label: "出発報告",
    sub: "タップして出発を知らせる",
    cardBg: "bg-blue-600 hover:bg-blue-500 active:scale-[0.98]",
    iconBg: "bg-white/20",
    labelColor: "text-white",
    Icon: DepartureIcon,
    clickable: true,
  },
  pre_clock_in: {
    label: "出勤未打刻",
    sub: "現場端末で出勤打刻してください",
    cardBg: "bg-zinc-100 dark:bg-zinc-800/70",
    iconBg: "bg-zinc-200 dark:bg-zinc-700",
    labelColor: "text-zinc-700 dark:text-zinc-200",
    Icon: ClockInIcon,
    clickable: false,
  },
  working: {
    label: "勤務中",
    sub: "退勤は現場端末で打刻してください",
    cardBg: "bg-emerald-50 dark:bg-emerald-950/40",
    iconBg: "bg-emerald-100 dark:bg-emerald-900/60",
    labelColor: "text-emerald-700 dark:text-emerald-300",
    Icon: CheckCircleIcon,
    clickable: false,
  },
  clocked_out: {
    label: "退勤済み",
    sub: "お疲れ様でした！",
    cardBg: "bg-zinc-100 dark:bg-zinc-800/70",
    iconBg: "bg-zinc-200 dark:bg-zinc-700",
    labelColor: "text-zinc-500 dark:text-zinc-400",
    Icon: CheckCircleIcon,
    clickable: false,
  },
};

// ────────────────────────────────────────────────────────────────────
export default function HomeClient({
  displayName, projectName, hasMultipleProjects, todayLabel,
  shift, departureTime, clockInTime, clockOutTime,
  hasAbsenceReport, absenceStatus, hasLateReport, lateStatus, noticeCount,
  upcomingShifts, enableDeparture = true,
}: HomeClientProps) {
  const [modal, setModal]       = useState<ModalType>("none");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Optimistic timestamps
  const [optDeparture, setOptDeparture] = useState(departureTime);
  const optClockIn  = clockInTime;
  const optClockOut = clockOutTime;

  // Derived state
  const state: HomeState = optClockOut ? "clocked_out"
    : optClockIn ? "working"
    : (optDeparture || !enableDeparture) ? "pre_clock_in"
    : "pre_departure";

  const cfg = STATE_CONFIG[state];

  // 出発モーダル
  const [etaDep, setEtaDep] = useState(30);

  // 欠勤モーダル（3ステップ）
  const [absStep, setAbsStep]   = useState<1 | 2 | 3>(1);
  const [absReason, setAbsReason]   = useState("");
  const [absNextDay, setAbsNextDay] = useState(true);

  // 遅刻モーダル（2ステップ）
  const [lateStep, setLateStep]   = useState<1 | 2>(1);
  const [lateReason, setLateReason] = useState("");
  const [lateEta, setLateEta]     = useState(30);

  const closeModal = () => {
    setModal("none");
    setAbsStep(1); setAbsReason(""); setAbsNextDay(true);
    setLateStep(1); setLateReason(""); setLateEta(30);
  };

  // ── ハンドラ ──────────────────────────────────────────────────
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

  // ライブクロック（出発報告OFF時）
  const [liveTime, setLiveTime] = useState(nowJST);
  useEffect(() => {
    if (enableDeparture) return;
    const id = setInterval(() => setLiveTime(nowJST()), 10000);
    return () => clearInterval(id);
  }, [enableDeparture]);

  // 挨拶文
  const [greeting, setGreeting] = useState("");
  useEffect(() => {
    const h = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })).getHours();
    if (h < 10) setGreeting("おはようございます");
    else if (h < 17) setGreeting("こんにちは");
    else setGreeting("お疲れ様です");
  }, []);

  // フィードバック自動消去
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  return (
    <>
      <main className="min-h-screen bg-white dark:bg-zinc-950">
        <div className="max-w-lg mx-auto px-5 pt-12 pb-32 flex flex-col gap-6">

          {/* ── ヘッダー：挨拶 + 氏名 + 通知 ── */}
          <div className="flex items-start justify-between">
            <div>
              {greeting && (
                <p className="text-[13px] text-zinc-400 dark:text-zinc-500 mb-0.5">{greeting}</p>
              )}
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                {displayName}
              </h1>
            </div>
            <a href="/notices" className="relative mt-1 p-1.5 -mr-1.5">
              <BellIcon className="w-5 h-5 text-zinc-400 dark:text-zinc-500" />
              {noticeCount > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {noticeCount > 99 ? "99+" : noticeCount}
                </span>
              )}
            </a>
          </div>

          {/* ── 日付 ── */}
          <p className={`tabular-nums ${
            enableDeparture
              ? "text-[13px] text-zinc-400 dark:text-zinc-500 -mt-3"
              : "text-[13px] text-zinc-400 dark:text-zinc-500 -mt-3"
          }`}>
            {todayLabel}
          </p>

          {/* ════════════════════════════════════════
              出発報告 ON レイアウト
          ════════════════════════════════════════ */}
          {enableDeparture && (
            <>
              {/* シフト情報ピル */}
              <div className="-mt-2">
                {!shift && (
                  <p className="text-sm text-zinc-300 dark:text-zinc-700">シフト未登録</p>
                )}
                {shift && isHoliday && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-500">
                    公休日
                  </span>
                )}
                {shift && !isHoliday && (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/50 text-xs font-bold text-blue-600 dark:text-blue-400">
                      {shift.name}
                    </span>
                    {shift.start && (
                      <span className="text-sm tabular-nums text-zinc-400 dark:text-zinc-500">
                        {shift.start.slice(0, 5)}–{shift.end?.slice(0, 5) ?? "--:--"}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* ── ステータスカード ── */}
              <button
                type="button"
                onClick={() => !isPending && cfg.clickable && setModal("departure")}
                disabled={!cfg.clickable || isPending}
                className={[
                  "w-full rounded-3xl p-5 flex items-center gap-4 transition-all duration-200",
                  cfg.clickable ? "cursor-pointer" : "cursor-default",
                  cfg.cardBg,
                ].filter(Boolean).join(" ")}
              >
                {/* アイコンボックス */}
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${cfg.iconBg}`}>
                  {cfg.Icon && (
                    <cfg.Icon className={`w-6 h-6 ${cfg.labelColor}`} />
                  )}
                </div>
                {/* テキスト */}
                <div className="flex-1 text-left">
                  <p className={`text-[17px] font-bold leading-tight ${cfg.labelColor}`}>
                    {isPending ? "処理中..." : cfg.label}
                  </p>
                  <p className={`text-[12px] mt-0.5 opacity-70 ${cfg.labelColor}`}>
                    {cfg.sub}
                  </p>
                </div>
                {/* シェブロン（タップ可能な場合のみ） */}
                {cfg.clickable && (
                  <ChevronRightIcon className={`w-5 h-5 opacity-60 flex-shrink-0 ${cfg.labelColor}`} />
                )}
              </button>

              {/* ── タイムスタンプカード ── */}
              <div className="bg-zinc-50 dark:bg-zinc-900 rounded-2xl overflow-hidden">
                <div className="grid grid-cols-3">
                  {[
                    { label: "出発", time: optDeparture },
                    { label: "出勤", time: optClockIn },
                    { label: "退勤", time: optClockOut },
                  ].map(({ label, time }, i) => (
                    <div
                      key={label}
                      className={`px-4 py-4 ${i > 0 ? "border-l border-zinc-200 dark:border-zinc-800" : ""}`}
                    >
                      <p className="text-[9px] tracking-[0.18em] uppercase text-zinc-400 dark:text-zinc-600 mb-2">
                        {label}
                      </p>
                      <p className={`text-xl font-light tabular-nums leading-none ${
                        time ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-200 dark:text-zinc-800"
                      }`}>
                        {time ?? "--:--"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── 次回出勤 ── */}
              {upcomingShifts && upcomingShifts.length > 0 && (
                <a
                  href="/shifts"
                  className="block bg-zinc-50 dark:bg-zinc-900 rounded-2xl overflow-hidden hover:bg-zinc-100 dark:hover:bg-zinc-800/80 active:scale-[0.99] transition-all"
                >
                  <p className="px-5 pt-4 pb-2 text-[9px] tracking-[0.18em] uppercase font-semibold text-zinc-400 dark:text-zinc-600">
                    次回出勤
                  </p>
                  {upcomingShifts.map((s, i) => (
                    <div key={s.date}>
                      {i > 0 && <div className="mx-5 border-t border-zinc-100 dark:border-zinc-800" />}
                      <div className="flex items-center justify-between px-5 py-3">
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          {fmtUpcomingDate(s.date)}
                        </span>
                        <div className="flex items-center gap-2">
                          {s.name && (
                            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                              {s.name}
                            </span>
                          )}
                          {s.start && (
                            <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-600">
                              {s.start.slice(0, 5)}–{s.end?.slice(0, 5) ?? "--:--"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-end px-5 py-2.5">
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-600">シフト表を見る</span>
                    <ChevronRightIcon className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 ml-0.5" />
                  </div>
                </a>
              )}

              {/* ── 欠勤・遅刻ボタン ── */}
              {canReport && (
                <div className="flex items-center justify-center gap-6 pt-1">
                  {hasAbsenceReport ? (
                    <span className="text-xs text-zinc-300 dark:text-zinc-700">
                      欠勤報告済（{statusBadge(absenceStatus)}）
                    </span>
                  ) : (
                    <button type="button" onClick={() => !isPending && setModal("absence")} disabled={isPending}
                      className="text-[13px] font-medium text-zinc-400 hover:text-red-500 active:opacity-60 disabled:opacity-40 transition-colors">
                      欠勤報告
                    </button>
                  )}
                  <span className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
                  {hasLateReport ? (
                    <span className="text-xs text-zinc-300 dark:text-zinc-700">
                      遅刻報告済（{statusBadge(lateStatus)}）
                    </span>
                  ) : (
                    <button type="button" onClick={() => !isPending && setModal("late")} disabled={isPending}
                      className="text-[13px] font-medium text-zinc-400 hover:text-amber-500 active:opacity-60 disabled:opacity-40 transition-colors">
                      遅刻報告
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* ════════════════════════════════════════
              出発報告 OFF レイアウト（Apple スタイル）
          ════════════════════════════════════════ */}
          {!enableDeparture && (
            <>
              {/* Hero：現在時刻 */}
              <p className="text-[88px] font-thin tabular-nums leading-none tracking-tight text-zinc-900 dark:text-white -mt-1 -mb-2">
                {liveTime}
              </p>

              {/* シフト ＋ 打刻カード */}
              <div className="bg-zinc-50 dark:bg-zinc-900 rounded-2xl overflow-hidden">
                {/* シフト行 */}
                {!shift && (
                  <div className="px-5 py-4">
                    <p className="text-sm text-zinc-400 dark:text-zinc-600">シフト未登録</p>
                  </div>
                )}
                {shift && isHoliday && (
                  <div className="px-5 py-4">
                    <p className="text-sm font-medium text-zinc-500">公休日</p>
                  </div>
                )}
                {shift && !isHoliday && (
                  <div className="px-5 pt-4 pb-3.5 flex items-center justify-between">
                    <div>
                      <p className="text-[9px] tracking-[0.18em] uppercase font-semibold text-zinc-400 dark:text-zinc-600 mb-1">
                        本日のシフト
                      </p>
                      <p className="text-[17px] font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
                        {shift.name}
                      </p>
                    </div>
                    {shift.start && (
                      <p className="text-sm tabular-nums text-zinc-400 dark:text-zinc-500">
                        {shift.start.slice(0, 5)}<span className="mx-1 text-zinc-300 dark:text-zinc-700">–</span>{shift.end?.slice(0, 5) ?? "--:--"}
                      </p>
                    )}
                  </div>
                )}

                <div className="mx-5 border-t border-zinc-200 dark:border-zinc-800" />

                {/* 出勤 / 退勤 */}
                <div className="grid grid-cols-2 divide-x divide-zinc-200 dark:divide-zinc-800">
                  {[
                    { label: "出勤", time: optClockIn },
                    { label: "退勤", time: optClockOut },
                  ].map(({ label, time }) => (
                    <div key={label} className="px-5 py-4">
                      <p className="text-[9px] tracking-[0.18em] uppercase font-semibold text-zinc-400 dark:text-zinc-600 mb-2">
                        {label}
                      </p>
                      <p className={`text-3xl font-light tabular-nums tracking-tight leading-none ${
                        time ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-200 dark:text-zinc-800"
                      }`}>
                        {time ?? "--:--"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 欠勤・遅刻 */}
              {canReport && (
                <div className="flex items-center justify-center gap-6">
                  {hasAbsenceReport ? (
                    <span className="text-xs text-zinc-300 dark:text-zinc-700">
                      欠勤報告済（{statusBadge(absenceStatus)}）
                    </span>
                  ) : (
                    <button type="button" onClick={() => !isPending && setModal("absence")} disabled={isPending}
                      className="text-[13px] font-medium text-zinc-400 hover:text-red-500 active:opacity-60 disabled:opacity-40 transition-colors">
                      欠勤報告
                    </button>
                  )}
                  <span className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
                  {hasLateReport ? (
                    <span className="text-xs text-zinc-300 dark:text-zinc-700">
                      遅刻報告済（{statusBadge(lateStatus)}）
                    </span>
                  ) : (
                    <button type="button" onClick={() => !isPending && setModal("late")} disabled={isPending}
                      className="text-[13px] font-medium text-zinc-400 hover:text-amber-500 active:opacity-60 disabled:opacity-40 transition-colors">
                      遅刻報告
                    </button>
                  )}
                </div>
              )}

              {/* 次回出勤カード */}
              {upcomingShifts && upcomingShifts.length > 0 && (
                <a
                  href="/shifts"
                  className="block bg-zinc-50 dark:bg-zinc-900 rounded-2xl overflow-hidden hover:bg-zinc-100 dark:hover:bg-zinc-800/80 active:scale-[0.99] transition-all"
                >
                  <p className="px-5 pt-4 pb-2 text-[9px] tracking-[0.18em] uppercase font-semibold text-zinc-400 dark:text-zinc-600">
                    次回出勤
                  </p>
                  {upcomingShifts.map((s, i) => (
                    <div key={s.date}>
                      {i > 0 && <div className="mx-5 border-t border-zinc-100 dark:border-zinc-800/60" />}
                      <div className="flex items-center justify-between px-5 py-3">
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          {fmtUpcomingDate(s.date)}
                        </span>
                        <div className="flex items-center gap-2">
                          {s.name && (
                            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                              {s.name}
                            </span>
                          )}
                          {s.start && (
                            <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-600">
                              {s.start.slice(0, 5)}–{s.end?.slice(0, 5) ?? "--:--"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-end px-5 py-2.5">
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-600">シフト表を見る</span>
                    <ChevronRightIcon className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 ml-0.5" />
                  </div>
                </a>
              )}
            </>
          )}

        </div>
      </main>

      {/* ── トーストフィードバック ─────────────────────────────────── */}
      {feedback && (
        <div className={[
          "fixed bottom-24 left-1/2 -translate-x-1/2 z-40",
          "px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold",
          "animate-in fade-in slide-in-from-bottom-2 duration-200",
          feedback.ok
            ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
            : "bg-red-500 text-white",
        ].join(" ")}>
          {feedback.msg}
        </div>
      )}

      {/* ════════════════════════ MODALS ════════════════════════ */}

      {/* 出発報告 */}
      {modal === "departure" && (
        <ModalWrap onClose={closeModal}>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">出発を報告する</h2>
          <p className="text-xs text-zinc-500 mb-5">到着予定を選んでください</p>
          <div className="grid grid-cols-3 gap-2 mb-5">
            {ETA_OPTS.map(({ label, value }) => (
              <button key={value} type="button" onClick={() => setEtaDep(value)}
                className={`py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.97] ${
                  etaDep === value
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={closeModal}
              className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
              キャンセル
            </button>
            <button type="button" onClick={handleDeparture} disabled={isPending}
              className="flex-1 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-sm font-bold disabled:opacity-50 transition-all">
              報告する
            </button>
          </div>
        </ModalWrap>
      )}

      {/* 欠勤報告（3ステップ） */}
      {modal === "absence" && (
        <ModalWrap onClose={closeModal}>
          {absStep === 1 && (
            <>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">欠勤を報告する</h2>
              <p className="text-xs text-zinc-500 mb-5">管理者に通知が届きます（1 / 3）</p>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">
                理由 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={absReason}
                onChange={(e) => setAbsReason(e.target.value)}
                placeholder="欠勤の理由を入力..."
                rows={4}
                className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none mb-4 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
              <div className="flex gap-3">
                <button type="button" onClick={closeModal}
                  className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                  キャンセル
                </button>
                <button type="button" onClick={() => setAbsStep(2)} disabled={!absReason.trim()}
                  className="flex-1 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-sm font-bold disabled:opacity-50 transition-all">
                  次へ
                </button>
              </div>
            </>
          )}

          {absStep === 2 && (
            <>
              <p className="text-xs text-zinc-500 mb-2">翌日の出勤確認（2 / 3）</p>
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 leading-snug">
                明日は<br />出勤できますか？
              </h2>
              <YesNoButtons
                onYes={() => { setAbsNextDay(true); setAbsStep(3); }}
                onNo={() => { setAbsNextDay(false); setAbsStep(3); }}
              />
              <button type="button" onClick={() => setAbsStep(1)}
                className="mt-3 w-full py-2 text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
                戻る
              </button>
            </>
          )}

          {absStep === 3 && (
            <>
              <p className="text-xs text-zinc-500 mb-2">翌々日の出勤確認（3 / 3）</p>
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 leading-snug">
                明後日は<br />出勤できますか？
              </h2>
              <div className="grid grid-cols-2 gap-3 mt-5">
                <button type="button" onClick={() => handleAbsence(absNextDay, true)} disabled={isPending}
                  className="py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.97] text-white font-bold text-base disabled:opacity-50 transition-all">
                  できます
                </button>
                <button type="button" onClick={() => handleAbsence(absNextDay, false)} disabled={isPending}
                  className="py-4 rounded-2xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-[0.97] text-zinc-700 dark:text-zinc-200 font-bold text-base disabled:opacity-50 transition-all">
                  できません
                </button>
              </div>
              <button type="button" onClick={() => setAbsStep(2)}
                className="mt-3 w-full py-2 text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
                戻る
              </button>
            </>
          )}
        </ModalWrap>
      )}

      {/* 遅刻報告（2ステップ） */}
      {modal === "late" && (
        <ModalWrap onClose={closeModal}>
          {lateStep === 1 && (
            <>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">遅刻を報告する</h2>
              <p className="text-xs text-zinc-500 mb-5">管理者に通知が届きます（1 / 2）</p>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">
                理由 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={lateReason}
                onChange={(e) => setLateReason(e.target.value)}
                placeholder="遅刻の理由を入力..."
                rows={4}
                className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none mb-4 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
              <div className="flex gap-3">
                <button type="button" onClick={closeModal}
                  className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                  キャンセル
                </button>
                <button type="button" onClick={() => setLateStep(2)} disabled={!lateReason.trim()}
                  className="flex-1 py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white text-sm font-bold disabled:opacity-50 transition-all">
                  次へ
                </button>
              </div>
            </>
          )}

          {lateStep === 2 && (
            <>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">到着予定（2 / 2）</h2>
              <p className="text-xs text-zinc-500 mb-5">何分後に到着しますか？</p>
              <div className="grid grid-cols-3 gap-2 mb-5">
                {ETA_OPTS.map(({ label, value }) => (
                  <button key={value} type="button" onClick={() => setLateEta(value)}
                    className={`py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.97] ${
                      lateEta === value
                        ? "bg-amber-500 text-white shadow-sm"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setLateStep(1)}
                  className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                  戻る
                </button>
                <button type="button" onClick={handleLate} disabled={isPending}
                  className="flex-1 py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white text-sm font-bold disabled:opacity-50 transition-all">
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
