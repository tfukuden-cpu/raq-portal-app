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
  tasksWidget?: React.ReactNode;
}

const NAVY    = "#0d1b35";
const WD      = ["日","月","火","水","木","金","土"];
const OFF_NAMES = new Set(["公休","休","公休日","欠勤","有休","振替休日","特別休暇","代休","休暇"]);

function nowHHMM(): string {
  return new Date().toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

const GREETINGS = {
  morning: [
    "おはようございます！\nいい朝ですね。今日も一日始まりました。",
    "おはようございます！\n朝の空気って気持ちいいですよね。",
    "おはようございます！\nコーヒーの香りで目が覚める朝、最高ですよね。",
    "おはようございます！\n今日もいい一日になりそうですね。",
    "おはようございます！\n朝ごはんをちゃんと食べると、なんか調子いいですよね。",
    "おはようございます！\n今日はどんな出来事が待っているのかな。",
    "おはようございます！\nゆっくり始めましょう、焦らなくて大丈夫ですよ。",
    "おはようございます！\n昨日の疲れが取れた朝って、なんか得した気分ですよね。",
  ],
  afternoon: [
    "こんにちは！\nお昼ごはんって、なんか一日の楽しみですよね。",
    "こんにちは！\n午後の時間ってなんか早く感じませんか。",
    "こんにちは！\n甘いものをちょっとつまみたくなる時間ですよね。",
    "こんにちは！\nたまには違うお店でランチするのも気分転換になりますよね。",
    "こんにちは！\nコーヒー一杯でリフレッシュできる瞬間って好きです。",
    "こんにちは！\n晴れた日のお昼って、なんかテンション上がりますよね。",
    "こんにちは！\n気づいたらもうこんな時間。時間が経つのは早いですね。",
    "こんにちは！\nランチ後のちょっとした眠気、あるあるですよね。",
  ],
  evening: [
    "こんばんは！\n今日も一日、よく乗り越えましたね。",
    "こんばんは！\n夜ご飯って一日の締めくくり感がありますよね。",
    "こんばんは！\n今夜はゆっくり好きなことをする時間にしてほしいですね。",
    "こんばんは！\n夜風って涼しくて気持ちいいですよね。",
    "こんばんは！\nお風呂上がりのビールとか、最高ですよね。",
    "こんばんは！\n週末が近づいてくると、なんかワクワクしますよね。",
    "こんばんは！\n夜中のラーメンって、なぜかいつもより美味しく感じますよね。",
    "こんばんは！\n好きなドラマや動画、ゆっくり楽しんでくださいね。",
  ],
};

function getGreetingMessage(): { word: string; message: string } {
  const h = parseInt(
    new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour: "numeric", hour12: false })
  );
  let word: string;
  let pool: string[];
  if (h >= 5 && h < 11) {
    word = "おはようございます"; pool = GREETINGS.morning;
  } else if (h >= 11 && h < 18) {
    word = "こんにちは"; pool = GREETINGS.afternoon;
  } else {
    word = "こんばんは"; pool = GREETINGS.evening;
  }
  const message = pool[Math.floor(Math.random() * pool.length)];
  return { word, message };
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

// ── アイコン ───────────────────────────────────────────────────────────────────

function DepartureIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>
    </svg>
  );
}

function AbsenceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <line x1="9" y1="15" x2="15" y2="15"/>
    </svg>
  );
}

function LateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

// ── ステータス円バッジ ─────────────────────────────────────────────────────────

const STATE_CONFIG: Record<HomeState, { label: string; border: string; text: string; bg: string }> = {
  pre_departure: {
    label: "未出発",
    border: "border-amber-400",
    text:   "text-amber-500",
    bg:     "",
  },
  pre_clock_in: {
    label: "出勤前",
    border: `border-[${NAVY}]`,
    text:   `text-[${NAVY}]`,
    bg:     "",
  },
  working: {
    label: "出勤中",
    border: "border-emerald-500",
    text:   "text-emerald-600",
    bg:     "",
  },
  clocked_out: {
    label: "退勤済",
    border: "border-zinc-300",
    text:   "text-zinc-400",
    bg:     "",
  },
};

function StatusCircle({ state }: { state: HomeState }) {
  const cfg = STATE_CONFIG[state];
  return (
    <div className={`w-[88px] h-[88px] rounded-full border-[3px] ${cfg.border} flex flex-col items-center justify-center gap-0.5 flex-shrink-0`}>
      {state === "working" && (
        <span className="relative flex h-1.5 w-1.5 mb-0.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
      )}
      <span className={`text-[14px] font-bold leading-none ${cfg.text}`}>{cfg.label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function HomeClient({
  displayName, todayLabel,
  shift, departureTime, clockInTime, clockOutTime,
  hasAbsenceReport, hasLateReport,
  noticeCount,
  recentNotices = [],
  weekSchedule  = [],
  enableDeparture  = true,
  hasPrevAbsence   = false,
  nextDayHasShift  = false,
  tasksWidget,
}: HomeClientProps) {

  const [modal,        setModal]        = useState<ModalType>("none");
  const [isPending,    startTransition] = useTransition();
  const [feedback,     setFeedback]     = useState<{ ok: boolean; msg: string } | null>(null);
  const [optDeparture, setOptDeparture] = useState(departureTime);
  const [liveTime,  setLiveTime]  = useState(nowHHMM);
  const [greetMsg,  setGreetMsg]  = useState(getGreetingMessage);

  useEffect(() => {
    setLiveTime(nowHHMM());
    setGreetMsg(getGreetingMessage());
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
      if (r.success) { setOptDeparture(nowHHMM()); setFeedback({ ok: true, msg: r.message ?? "出発報告しました" }); }
      else             setFeedback({ ok: false, msg: r.message ?? "エラー" });
    });
  };

  const handleAbsence = (data: { reason: string; symptoms: Symptoms; recoveryStatus: string | null; hasConsultation: boolean }) => {
    closeModal();
    startTransition(async () => {
      const fd = new FormData();
      fd.set("reason",          data.reason);
      fd.set("symptomsJson",    JSON.stringify(data.symptoms));
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
  const todayDateStr   = weekSchedule[0]?.date ?? "";

  return (
    <>
      <main className="min-h-screen bg-[#f4f6fa] dark:bg-zinc-950">

        {/* モバイル用ヘッダー（PCではAppNavのヘッダーが担当） */}
        <div className="md:hidden px-5 pt-6 pb-4 bg-white border-b border-zinc-100 dark:bg-zinc-900 dark:border-zinc-800">
          <p className="text-[12px] text-zinc-400 mb-0.5">{todayLabel}</p>
          <p className="text-[40px] font-bold tabular-nums leading-none text-zinc-900 dark:text-white">{liveTime}</p>
        </div>

        <div className="max-w-6xl mx-auto px-4 md:px-8 pt-5 md:pt-6 pb-32 md:pb-12 space-y-4">

          {/* ── 挨拶カード ── */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-6 py-5">
            {/* アイコン + 名前 */}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[20px] font-bold flex-shrink-0 shadow-sm">
                {displayName.charAt(0)}
              </div>
              <p className="text-[24px] md:text-[28px] font-bold text-[#0d1b35] dark:text-white leading-none">
                {displayName}<span className="text-[16px] font-medium text-zinc-400 ml-1.5">さん</span>
              </p>
            </div>
            {/* メッセージ */}
            <p className="text-[15px] md:text-[16px] text-zinc-500 dark:text-zinc-400 leading-relaxed whitespace-pre-line pl-1">
              {greetMsg.message}
            </p>
          </div>

          {/* ── 上段 3カラム ── */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">

            {/* LEFT: 本日のシフト */}
            <div className="md:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
              <p className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 mb-5">本日のシフト</p>
              {hasShift ? (
                <>
                  <p className="text-[11px] text-zinc-400 mb-1">シフトネーム</p>
                  <p className="text-[26px] font-bold text-[#0d1b35] dark:text-white leading-tight mb-4">{shift.name}</p>
                  <p className="text-[11px] text-zinc-400 mb-1">シフト時間</p>
                  <p className="text-[16px] font-medium text-[#0d1b35] dark:text-zinc-200 tabular-nums">
                    {shift.start?.slice(0,5) ?? "--:--"} - {shift.end?.slice(0,5) ?? "--:--"}
                  </p>
                </>
              ) : isHoliday ? (
                <>
                  <p className="text-[11px] text-zinc-400 mb-1">シフトネーム</p>
                  <p className="text-[26px] font-bold text-zinc-400 leading-tight">休日</p>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-zinc-400 mb-1">シフトネーム</p>
                  <p className="text-[18px] text-zinc-300 dark:text-zinc-600">シフト未登録</p>
                </>
              )}

              {/* 出発報告ボタン（出発前のみ） */}
              {enableDeparture && state === "pre_departure" && (
                <button
                  onClick={() => !isPending && setModal("departure")}
                  disabled={isPending}
                  className="mt-6 w-full h-10 rounded-xl bg-[#0d1b35] text-white text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-[#162b50] transition-colors"
                >
                  <DepartureIcon />出発報告
                </button>
              )}
            </div>

            {/* MIDDLE: 勤怠ステータス */}
            <div className="md:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
              <p className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 mb-5">勤怠ステータス</p>
              <div className="flex items-center gap-6">
                <StatusCircle state={state} />
                <div className="flex flex-col gap-5 flex-1">
                  <div>
                    <p className="text-[11px] text-zinc-400 mb-1">打刻時間</p>
                    <p className="text-[22px] font-bold tabular-nums text-[#0d1b35] dark:text-white">
                      {clockInTime ?? "--:--"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-zinc-400 mb-1">退勤時間</p>
                    <p className="text-[22px] font-bold tabular-nums text-[#0d1b35] dark:text-white">
                      {clockOutTime ?? "--:--"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: アクションカード */}
            <div className="md:col-span-1 flex flex-row md:flex-col gap-3">

              {/* 欠勤報告 */}
              {showAbsenceBtn ? (
                <button
                  onClick={() => !isPending && setModal("absence")}
                  disabled={isPending}
                  className="flex-1 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-4 py-4 flex items-center justify-between gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-[#0d1b35] dark:text-zinc-300"><AbsenceIcon /></span>
                    <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">欠勤報告</span>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                </button>
              ) : hasAbsenceReport ? (
                <a
                  href="/absence-followup"
                  className="flex-1 bg-blue-50 dark:bg-blue-950/30 rounded-2xl border border-blue-100 dark:border-blue-800 px-4 py-4 flex items-center justify-between gap-2 hover:bg-blue-100/50 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-blue-500"><AbsenceIcon /></span>
                    <span className="text-[13px] font-medium text-blue-600 dark:text-blue-400">経過報告</span>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-blue-300 flex-shrink-0" />
                </a>
              ) : (
                <div className="flex-1 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-4 py-4 flex items-center gap-2.5 opacity-40">
                  <span className="text-zinc-400"><AbsenceIcon /></span>
                  <span className="text-[13px] font-medium text-zinc-400">欠勤報告済</span>
                </div>
              )}

              {/* 遅刻報告 */}
              {showLateBtn ? (
                <button
                  onClick={() => !isPending && setModal("late")}
                  disabled={isPending}
                  className="flex-1 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-4 py-4 flex items-center justify-between gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-[#0d1b35] dark:text-zinc-300"><LateIcon /></span>
                    <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">遅刻報告</span>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                </button>
              ) : (
                <div className="flex-1 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-4 py-4 flex items-center gap-2.5 opacity-40">
                  <span className="text-zinc-400"><LateIcon /></span>
                  <span className="text-[13px] font-medium text-zinc-400">
                    {hasLateReport ? "遅刻済み" : "退勤済"}
                  </span>
                </div>
              )}

            </div>
          </div>

          {/* ── お知らせタイムライン ── */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
            <div className="px-6 pt-5 pb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">お知らせタイムライン</h2>
              <a href="/notices" className="flex items-center gap-0.5 text-[12px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
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
              <div>
                {recentNotices.map((n, i) => (
                  <a
                    key={n.id}
                    href="/notices"
                    className={`flex items-center gap-4 px-6 py-3.5 border-t border-zinc-50 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${i === 0 ? "border-zinc-100 dark:border-zinc-800" : ""}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-[#0d1b35] dark:bg-blue-400 flex-shrink-0" />
                    <span className="text-[11px] text-zinc-400 tabular-nums w-36 flex-shrink-0">{n.createdAt}</span>
                    <span className="text-[13px] text-zinc-700 dark:text-zinc-300 truncate">{n.title}</span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="px-6 pb-5 pt-2 text-[13px] text-zinc-400">お知らせはありません</p>
            )}
          </div>

          {/* ── 1週間カレンダーカード ── */}
          {weekSchedule.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
              <div className="px-6 pt-5 pb-5">
                <h2 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 mb-5">1週間カレンダーカード</h2>
                <div className="grid grid-cols-7 gap-2">
                  {weekSchedule.map(day => {
                    const isToday = day.date === todayDateStr;
                    const isOff   = !day.name || OFF_NAMES.has(day.name);
                    const sun     = isSunday(day.date);
                    const sat     = isSaturday(day.date);
                    return (
                      <div key={day.date} className="flex flex-col items-center gap-1">
                        {/* 日付円 */}
                        <div className={`w-10 h-10 rounded-full flex flex-col items-center justify-center ${
                          isToday ? "bg-[#0d1b35]" : ""
                        }`}>
                          <p className={`text-[12px] font-bold tabular-nums leading-none ${
                            isToday ? "text-white" : sun ? "text-red-500" : sat ? "text-blue-500" : "text-zinc-700 dark:text-zinc-300"
                          }`}>
                            {fmtMD(day.date)}
                          </p>
                          <p className={`text-[9px] leading-none mt-0.5 ${
                            isToday ? "text-white/60" : sun ? "text-red-400" : sat ? "text-blue-400" : "text-zinc-400"
                          }`}>
                            ({dayOfWeek(day.date)})
                          </p>
                        </div>
                        {/* シフト名 */}
                        <p className={`text-[12px] font-semibold text-center leading-tight ${
                          isOff ? "text-zinc-300 dark:text-zinc-600"
                          : isToday ? "text-[#0d1b35] dark:text-blue-300"
                          : "text-zinc-700 dark:text-zinc-200"
                        }`}>
                          {isOff ? (day.name ? "公休" : "-") : (day.name ?? "-")}
                        </p>
                        {/* 時間 */}
                        {!isOff && day.start && (
                          <p className="text-[9px] text-zinc-400 tabular-nums text-center leading-tight">
                            {day.start.slice(0,5)}-{day.end?.slice(0,5) ?? "--"}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="border-t border-zinc-50 dark:border-zinc-800 px-6 py-3">
                <a href="/shifts" className="flex items-center justify-center gap-1 text-[12px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
                  スケジュールをすべて見る
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}

          {/* ── 今日のタスク（管理者のみ） ── */}
          {tasksWidget}

        </div>
      </main>

      {/* ── トースト ── */}
      {feedback && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap px-5 py-3 rounded-2xl text-[14px] font-semibold shadow-2xl ${
          feedback.ok ? "bg-[#0d1b35] text-white" : "bg-red-500 text-white"
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
