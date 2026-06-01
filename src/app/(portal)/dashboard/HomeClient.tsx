"use client";

import { useState, useTransition, useEffect } from "react";
import {
  recordDepartureAction,
  submitAbsenceAction,
  submitLateAction,
} from "./actions";
import { ChevronRightIcon } from "@/components/icons";
import { DepartureModal } from "./DepartureModal";
import { AbsenceModal } from "./AbsenceModal";
import { LateModal } from "./LateModal";
import type { Symptoms } from "@/components/SymptomRow";

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
  recentNotices?: { id: string; title: string; createdAt: string }[];
  weekSchedule?: { date: string; name: string | null; start: string | null; end: string | null }[];
  upcomingShifts?: { date: string; name: string | null; start: string | null; end: string | null }[];
  enableDeparture?: boolean;
  hasPrevAbsence?: boolean;
  nextDayHasShift?: boolean;
}

const WD        = ["日","月","火","水","木","金","土"];
const OFF_NAMES = new Set(["公休","休","公休日","欠勤","有休","振替休日","特別休暇","代休","休暇"]);

function nowHHMM(): string {
  return new Date().toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtMD(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

function dayOfWeek(dateStr: string): string {
  return WD[new Date(dateStr + "T00:00:00").getDay()];
}

function isSunday(dateStr: string)   { return new Date(dateStr + "T00:00:00").getDay() === 0; }
function isSaturday(dateStr: string) { return new Date(dateStr + "T00:00:00").getDay() === 6; }

// ── アイコン ──────────────────────────────────────────────────────────────────

function DepartureIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>
    </svg>
  );
}
function AbsenceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}
function LateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

// ── ステータスバッジ ───────────────────────────────────────────────────────────

function StatusBadge({ state }: { state: HomeState }) {
  const map: Record<HomeState, { label: string; cls: string }> = {
    pre_departure: { label: "未出発", cls: "bg-amber-500 text-white" },
    pre_clock_in:  { label: "未出勤", cls: "bg-zinc-500 text-white" },
    working:       { label: "出勤中", cls: "bg-[#1e2d4f] text-white" },
    clocked_out:   { label: "退勤済", cls: "bg-zinc-400 text-white" },
  };
  const c = map[state];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-semibold ${c.cls}`}>
      {state === "working" && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
      )}
      {c.label}
    </span>
  );
}

// ── タイムスタンプ表示 ────────────────────────────────────────────────────────

function TimeStamp({ time, label }: { time: string | null; label: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">{label}</p>
      {time
        ? <p className="text-[22px] font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">{time}</p>
        : <p className="text-[22px] font-light text-zinc-200 dark:text-zinc-700">—</p>
      }
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function HomeClient({
  displayName, todayLabel,
  shift, departureTime, clockInTime, clockOutTime,
  hasAbsenceReport, absenceStatus, hasLateReport, lateStatus,
  noticeCount,
  recentNotices = [],
  weekSchedule  = [],
  enableDeparture  = true,
  hasPrevAbsence   = false,
  nextDayHasShift  = false,
}: HomeClientProps) {

  const [modal,       setModal]       = useState<ModalType>("none");
  const [isPending,   startTransition] = useTransition();
  const [feedback,    setFeedback]    = useState<{ ok: boolean; msg: string } | null>(null);
  const [optDeparture, setOptDeparture] = useState(departureTime);
  const [liveTime,    setLiveTime]    = useState(nowHHMM);

  // 1分ごとに時刻を更新
  useEffect(() => {
    setLiveTime(nowHHMM());
    const id = setInterval(() => setLiveTime(nowHHMM()), 15000);
    return () => clearInterval(id);
  }, []);

  const state: HomeState =
    clockOutTime     ? "clocked_out"
    : clockInTime    ? "working"
    : (optDeparture || !enableDeparture) ? "pre_clock_in"
    : "pre_departure";

  const closeModal = () => setModal("none");

  const handleDeparture = (etaMinutes: number) => {
    closeModal();
    startTransition(async () => {
      const fd = new FormData();
      fd.set("etaMinutes", String(etaMinutes));
      const r = await recordDepartureAction(fd);
      if (r.success) { setOptDeparture(nowHHMM()); setFeedback({ ok: true,  msg: r.message ?? "出発報告しました" }); }
      else             setFeedback({ ok: false, msg: r.message ?? "エラー" });
    });
  };

  const handleAbsence = (data: { reason: string; symptoms: Symptoms; recoveryStatus: string | null; hasConsultation: boolean }) => {
    closeModal();
    startTransition(async () => {
      const fd = new FormData();
      fd.set("reason",         data.reason);
      fd.set("symptomsJson",   JSON.stringify(data.symptoms));
      fd.set("hasConsultation", String(data.hasConsultation));
      fd.set("nextDayHasShift", String(nextDayHasShift));
      if (data.recoveryStatus) fd.set("recoveryStatus", data.recoveryStatus);
      const r = await submitAbsenceAction(fd);
      setFeedback({ ok: r.success, msg: r.message ?? "欠勤報告しました" });
    });
  };

  const handleLate = (reason: string, etaMinutes: number) => {
    closeModal();
    startTransition(async () => {
      const fd = new FormData();
      fd.set("reason",     reason);
      fd.set("etaMinutes", String(etaMinutes));
      const r = await submitLateAction(fd);
      setFeedback({ ok: r.success, msg: r.message ?? "遅刻報告しました" });
    });
  };

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  const isHoliday = !!(shift?.name && OFF_NAMES.has(shift.name));
  const hasShift  = shift && !isHoliday;

  const showAbsenceBtn = !hasAbsenceReport && state !== "clocked_out";
  const showLateBtn    = !hasLateReport && state !== "clocked_out";
  const showActions    = (enableDeparture && state === "pre_departure") || showAbsenceBtn || showLateBtn || hasAbsenceReport || hasLateReport;

  const todayDateStr = weekSchedule[0]?.date ?? "";

  return (
    <>
      <main className="min-h-screen bg-[#F5F7FA] dark:bg-zinc-950">
        <div className="max-w-2xl mx-auto px-4 pt-8 pb-32 flex flex-col gap-4">

          {/* ── 日付 + ライブクロック ── */}
          <div className="px-1 mb-1">
            <p className="text-[13px] text-zinc-400 mb-0.5">{todayLabel}</p>
            <p className="text-[52px] font-bold tabular-nums leading-none tracking-tight text-zinc-900 dark:text-white">
              {liveTime}
            </p>
          </div>

          {/* ── 勤怠カード ── */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm overflow-hidden">

            {/* 上段: シフト + ステータス */}
            <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">本日のシフト</p>
                {hasShift ? (
                  <>
                    <p className="text-[20px] font-bold text-zinc-800 dark:text-zinc-100 leading-tight">{shift.name}</p>
                    {shift.start && (
                      <p className="text-[13px] text-zinc-400 tabular-nums mt-0.5">
                        {shift.start.slice(0,5)} - {shift.end?.slice(0,5) ?? "--:--"}
                      </p>
                    )}
                  </>
                ) : isHoliday ? (
                  <p className="text-[18px] font-medium text-zinc-400">休日</p>
                ) : (
                  <p className="text-[15px] text-zinc-300 dark:text-zinc-600">シフト未登録</p>
                )}
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">勤怠ステータス</p>
                <StatusBadge state={state} />
              </div>
            </div>

            {/* 仕切り */}
            <div className="border-t border-zinc-100 dark:border-zinc-800" />

            {/* 打刻時間 */}
            <div className="px-5 py-4 flex gap-8">
              {enableDeparture && <TimeStamp time={optDeparture} label="出発" />}
              <TimeStamp time={clockInTime}  label="打刻時間" />
              <TimeStamp time={clockOutTime} label="退勤時間" />
            </div>

            {/* アクションボタン */}
            {showActions && (
              <>
                <div className="border-t border-zinc-100 dark:border-zinc-800" />
                <div className="px-5 py-4 flex flex-wrap gap-2">
                  {enableDeparture && state === "pre_departure" && (
                    <button
                      onClick={() => !isPending && setModal("departure")}
                      disabled={isPending}
                      className="flex-1 min-w-[110px] h-10 rounded-lg bg-blue-600 text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 active:bg-blue-700 transition-colors"
                    >
                      <DepartureIcon />出発報告
                    </button>
                  )}
                  {showAbsenceBtn ? (
                    <button
                      onClick={() => !isPending && setModal("absence")}
                      disabled={isPending}
                      className="flex-1 min-w-[100px] h-10 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[13px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center justify-center gap-1.5 disabled:opacity-50 active:bg-zinc-50 dark:active:bg-zinc-800 transition-colors"
                    >
                      <AbsenceIcon />欠勤報告
                    </button>
                  ) : hasAbsenceReport ? (
                    <a
                      href="/absence-followup"
                      className="flex-1 min-w-[100px] h-10 rounded-lg border border-blue-200 dark:border-blue-800 text-[13px] font-medium text-blue-600 dark:text-blue-400 flex items-center justify-center gap-1.5 active:bg-blue-50 transition-colors"
                    >
                      <AbsenceIcon />経過報告
                    </a>
                  ) : null}
                  {showLateBtn ? (
                    <button
                      onClick={() => !isPending && setModal("late")}
                      disabled={isPending}
                      className="flex-1 min-w-[100px] h-10 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[13px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center justify-center gap-1.5 disabled:opacity-50 active:bg-zinc-50 dark:active:bg-zinc-800 transition-colors"
                    >
                      <LateIcon />遅刻報告
                    </button>
                  ) : hasLateReport ? (
                    <div className="flex-1 min-w-[100px] h-10 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 flex items-center justify-center">
                      <span className="text-[12px] text-zinc-400">遅刻済み</span>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>

          {/* ── お知らせタイムライン ── */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-100">お知らせタイムライン</h2>
              <a href="/notices" className="flex items-center gap-0.5 text-[12px] text-blue-500 dark:text-blue-400 font-medium">
                すべて見る
                <ChevronRightIcon className="w-3.5 h-3.5" />
                {noticeCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold tabular-nums">
                    {noticeCount > 99 ? "99+" : noticeCount}
                  </span>
                )}
              </a>
            </div>
            {recentNotices.length > 0 ? (
              recentNotices.map((n, i) => (
                <a
                  key={n.id}
                  href="/notices"
                  className={`flex items-start gap-3 px-5 py-3.5 ${i > 0 ? "border-t border-zinc-50 dark:border-zinc-800/60" : "border-t border-zinc-100 dark:border-zinc-800"} active:bg-zinc-50 dark:active:bg-zinc-800/50 transition-colors`}
                >
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-zinc-400 tabular-nums mb-0.5">{n.createdAt}</p>
                    <p className="text-[14px] text-zinc-700 dark:text-zinc-200 truncate">{n.title}</p>
                  </div>
                </a>
              ))
            ) : (
              <p className="px-5 pb-5 pt-2 text-[13px] text-zinc-400">お知らせはありません</p>
            )}
          </div>

          {/* ── 今後のスケジュール（7日） ── */}
          {weekSchedule.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm overflow-hidden">
              <div className="px-5 pt-5 pb-4">
                <h2 className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-100 mb-4">今後のスケジュール</h2>
                <div className="grid grid-cols-7 gap-1">
                  {weekSchedule.map(day => {
                    const isToday = day.date === todayDateStr;
                    const isOff   = !day.name || OFF_NAMES.has(day.name);
                    const sun     = isSunday(day.date);
                    const sat     = isSaturday(day.date);
                    return (
                      <div
                        key={day.date}
                        className={`flex flex-col items-center gap-0.5 py-2.5 px-1 rounded-xl ${
                          isToday ? "bg-[#1e2d4f]" : ""
                        }`}
                      >
                        <p className={`text-[11px] font-semibold tabular-nums ${isToday ? "text-white/70" : "text-zinc-400"}`}>
                          {fmtMD(day.date)}
                        </p>
                        <p className={`text-[10px] ${isToday ? "text-white/50" : sun ? "text-red-400" : sat ? "text-blue-400" : "text-zinc-400"}`}>
                          ({dayOfWeek(day.date)})
                        </p>
                        <p className={`text-[11px] font-semibold mt-0.5 text-center leading-tight ${
                          isToday ? "text-white" : isOff ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-700 dark:text-zinc-200"
                        }`}>
                          {isOff ? (day.name ? "休み" : "-") : (day.name ?? "-")}
                        </p>
                        {!isOff && day.start && (
                          <p className={`text-[9px] tabular-nums ${isToday ? "text-white/50" : "text-zinc-400"}`}>
                            {day.start.slice(0,5)}-{day.end?.slice(0,5) ?? "--"}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="border-t border-zinc-50 dark:border-zinc-800 px-5 py-3.5">
                <a href="/shifts" className="flex items-center justify-center gap-1 text-[13px] text-blue-500 dark:text-blue-400 font-medium">
                  スケジュールをすべて見る
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ── トースト ── */}
      {feedback && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap px-5 py-3 rounded-2xl text-[14px] font-semibold shadow-2xl ${
          feedback.ok ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-red-500 text-white"
        }`}>
          {feedback.msg}
        </div>
      )}

      {/* ── モーダル ── */}
      {modal === "departure" && (
        <DepartureModal onClose={closeModal} onSubmit={handleDeparture} isPending={isPending} />
      )}
      {modal === "absence" && (
        <AbsenceModal
          onClose={closeModal} onSubmit={handleAbsence} isPending={isPending}
          hasPrevAbsence={hasPrevAbsence} nextDayHasShift={nextDayHasShift}
          todayLabel={todayLabel} displayName={displayName}
        />
      )}
      {modal === "late" && (
        <LateModal onClose={closeModal} onSubmit={handleLate} isPending={isPending} />
      )}
    </>
  );
}
