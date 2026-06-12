"use client";

import { useState, useTransition, useEffect, type ReactNode, type CSSProperties } from "react";
import { DotGothic16 } from "next/font/google";
import {
  recordDepartureAction,
  submitAbsenceAction,
  submitLateAction,
  setMyRpgCharacterAction,
} from "./actions";
import { BREAK_ROOM_MAP_URL } from "@/lib/break-room-info";
import {
  leaveMyBreakRoomAction,
  enterMyBreakRoomAction,
  setBreakRoomOpenAction,
  getBreakRoomStateAction,
  type BreakRoomState,
} from "../seating/break-room-actions";
import { RPG_CHARS, rpgCharFor, rpgCharImg } from "@/lib/rpg-chars";
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
  breakRoomUse?: { boxNumber: number; enteredAt: string } | null;
  breakRoomState?: BreakRoomState | null;
  projectId?: string;
  myStaffId?: string;
  myRpgCharId?: number | null;
}

const NAVY    = "#0d1b35";
const WD      = ["日","月","火","水","木","金","土"];
const OFF_NAMES = new Set(["公休","休","公休日","欠勤","有休","振替休日","特別休暇","代休","休暇"]);

// ── RPGテーマ（打刻端末・休憩室と共通の世界観） ───────────────────────────────
const dotGothic = DotGothic16({ weight: "400", subsets: ["latin"], preload: false });

const RPG_PAGE_BG = "linear-gradient(180deg, #02040f 0%, #050a24 45%, #0a1340 100%)";

const RPG_HOME_KEYFRAMES = `
@keyframes rpgTwinkle { 0%,100% { opacity: .2; } 50% { opacity: 1; } }
@keyframes rpgBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes rpgCursor { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes rpgZzz {
  0%   { opacity: 0; transform: translate(0, 3px) scale(.8); }
  25%  { opacity: 1; }
  100% { opacity: 0; transform: translate(9px, -16px) scale(1.2); }
}
@keyframes rpgFlicker {
  0%,100% { opacity: .45; transform: scale(1); }
  30%     { opacity: .85; transform: scale(1.15); }
  60%     { opacity: .55; transform: scale(.92); }
  80%     { opacity: .75; transform: scale(1.08); }
}
@keyframes rpgSpark {
  0%   { opacity: 0; transform: translate(0, 0); }
  15%  { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--sx, 0px), -38px); }
}
`;

const RPG_STARS: { l: number; t: number; d: number; s: number }[] = [
  { l: 5, t: 14, d: 0,   s: 2 }, { l: 12, t: 42, d: 1.3, s: 3 }, { l: 19, t: 22, d: 0.6, s: 2 },
  { l: 27, t: 55, d: 2.0, s: 2 }, { l: 34, t: 18, d: 0.9, s: 3 }, { l: 42, t: 38, d: 1.6, s: 2 },
  { l: 58, t: 35, d: 0.4, s: 2 }, { l: 66, t: 16, d: 1.9, s: 3 }, { l: 73, t: 48, d: 1.1, s: 2 },
  { l: 81, t: 24, d: 0.2, s: 2 }, { l: 88, t: 52, d: 1.5, s: 3 }, { l: 95, t: 18, d: 0.8, s: 2 },
];

/** ドラクエ風ウィンドウ（紺背景＋白二重枠）。title を渡すと枠上にラベルを重ねる */
function RpgWindow({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <div className="rounded-lg border-2 border-white bg-[#000846] p-[3px]">
        <div className="rounded-md border border-white/80 bg-[#000846] w-full h-full">
          {children}
        </div>
      </div>
      {title && (
        <p className="absolute -top-[11px] left-4 bg-[#000846] border border-white rounded px-2.5 py-0.5 text-[12px] leading-none text-white select-none">
          {title}
        </p>
      )}
    </div>
  );
}

/** メッセージ末尾の点滅▼カーソル */
function BlinkCursor() {
  return <span className="inline-block text-white ml-1" style={{ animation: "rpgCursor 1s steps(1) infinite" }}>▼</span>;
}

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

// ── 勤怠ステータス表示設定 ─────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────

export default function HomeClient({
  isAdmin = false,
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
  breakRoomUse     = null,
  breakRoomState   = null,
  projectId        = "",
  myStaffId        = "",
  myRpgCharId      = null,
}: HomeClientProps) {

  const [modal,        setModal]        = useState<ModalType>("none");
  const [isPending,    startTransition] = useTransition();
  const [feedback,     setFeedback]     = useState<{ ok: boolean; msg: string } | null>(null);
  const [optDeparture, setOptDeparture] = useState(departureTime);
  const [optBreakRoom, setOptBreakRoom] = useState(breakRoomUse);
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

  // ── マイキャラクター選択 ──────────────────────────────────
  const [optCharId, setOptCharId] = useState<number | null>(myRpgCharId);
  const [charPickerOpen, setCharPickerOpen] = useState(false);
  const myChar = rpgCharFor(myStaffId, optCharId);

  const handlePickChar = (charId: number) => {
    startTransition(async () => {
      const r = await setMyRpgCharacterAction(charId);
      if (r.success) {
        setOptCharId(charId);
        setCharPickerOpen(false);
        setFeedback({ ok: true, msg: "キャラクターを変更しました" });
      } else {
        setFeedback({ ok: false, msg: r.message ?? "変更に失敗しました" });
      }
    });
  };

  // ── 休憩室（空き状況・入退室・開閉） ─────────────────────
  const [roomState, setRoomState] = useState<BreakRoomState | null>(breakRoomState);
  const [roomHelpOpen, setRoomHelpOpen] = useState(false);

  const refreshRoom = async () => {
    if (!projectId) return;
    try { setRoomState(await getBreakRoomStateAction(projectId)); } catch { /* ignore */ }
  };

  const fmtHM = (iso: string) =>
    new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });

  const handleLeaveBreakRoom = () => {
    if (!window.confirm("休憩室から退室しますか？")) return;
    startTransition(async () => {
      const r = await leaveMyBreakRoomAction();
      if (r.ok) {
        setOptBreakRoom(null);
        setFeedback({ ok: true, msg: "休憩室から退室しました" });
      } else {
        setFeedback({ ok: false, msg: r.error ?? "退室に失敗しました" });
      }
      await refreshRoom();
    });
  };

  // 先頭の空き箱に入室する（ホームは箱を選ばないコンパクト表示）
  const handleEnterBreakRoom = () => {
    if (!roomState) return;
    const usedBoxes = new Set(roomState.uses.map(u => u.boxNumber));
    let boxNumber = 0;
    for (let i = 1; i <= roomState.capacity; i++) {
      if (!usedBoxes.has(i)) { boxNumber = i; break; }
    }
    if (boxNumber === 0) {
      setFeedback({ ok: false, msg: "空き枠がありません" });
      return;
    }
    if (!window.confirm("休憩室に入室しますか？\n（休憩打刻中のみ入室できます）")) return;
    startTransition(async () => {
      const r = await enterMyBreakRoomAction(boxNumber);
      if (r.ok) {
        setOptBreakRoom({ boxNumber, enteredAt: nowHHMM() });
        setFeedback({ ok: true, msg: "休憩室に入室しました" });
      } else {
        setFeedback({ ok: false, msg: r.error ?? "入室に失敗しました" });
      }
      await refreshRoom();
    });
  };

  const handleToggleRoomOpen = () => {
    if (!roomState || !projectId) return;
    const next = !roomState.isOpen;
    if (!window.confirm(next ? "休憩室を開放しますか？" : "休憩室を閉鎖しますか？\n（スタッフは入室できなくなります）")) return;
    startTransition(async () => {
      const r = await setBreakRoomOpenAction(projectId, next);
      if (r.ok) setFeedback({ ok: true, msg: next ? "休憩室を開放しました" : "休憩室を閉鎖しました" });
      else      setFeedback({ ok: false, msg: r.error ?? "切り替えに失敗しました" });
      await refreshRoom();
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
      <main className={`min-h-screen ${dotGothic.className}`} style={{ background: RPG_PAGE_BG, backgroundAttachment: "fixed" }}>
        <style>{RPG_HOME_KEYFRAMES}</style>

        <div className="max-w-6xl mx-auto px-4 md:px-8 pb-32 md:pb-12">

          {/* ── ヒーローバナー（固定・スクロールしても残る） ── */}
          <div
            className="sticky top-0 md:top-14 z-20 -mx-4 md:-mx-8 px-4 md:px-8 pt-5 md:pt-6 pb-3"
            style={{ background: RPG_PAGE_BG, backgroundAttachment: "fixed" }}
          >
          <RpgWindow>
            <div className="relative overflow-hidden rounded-md h-44 md:h-56">
              {/* 背景: AI生成の夜の城下町。読み込めない間は夜空グラデ＋星 */}
              <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, #02040f 0%, #0a1340 70%, #14275c 100%)" }} />
              {RPG_STARS.map((s, i) => (
                <span
                  key={i}
                  className="absolute rounded-full bg-white"
                  style={{
                    left: `${s.l}%`, top: `${s.t}%`, width: s.s, height: s.s,
                    animation: `rpgTwinkle ${2 + (i % 3)}s ease-in-out ${s.d}s infinite`,
                  }}
                />
              ))}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/rpg/home-hero.png"
                alt=""
                draggable={false}
                className="absolute inset-0 w-full h-full object-cover object-bottom select-none"
                style={{ imageRendering: "pixelated" }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#02040f]/70 via-transparent to-[#02040f]/40" />

              {/* 日付・時刻 */}
              <div className="absolute top-2.5 left-3 right-3 flex items-center justify-between">
                <span className="text-[11px] text-white/90 bg-[#000846]/80 border border-white/60 rounded px-2 py-0.5">{todayLabel}</span>
                <span className="text-[20px] font-bold tabular-nums leading-none text-white bg-[#000846]/80 border border-white/60 rounded px-2.5 py-1">{liveTime}</span>
              </div>

              {/* マイキャラクター（タップで変更） */}
              <button
                onClick={() => setCharPickerOpen(true)}
                className="absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center active:scale-95 transition-transform"
              >
                <div style={{ animation: "rpgBob 1.4s steps(2) infinite" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={rpgCharImg(myChar.id)} alt="" draggable={false} className="h-20 md:h-24 w-auto select-none" style={{ imageRendering: "pixelated" }} />
                </div>
                <span className="mt-1 text-[11px] text-white bg-[#000846]/85 border border-white/70 rounded px-2 py-0.5 whitespace-nowrap">
                  {displayName}（{myChar.label}）
                </span>
              </button>
            </div>
          </RpgWindow>
          </div>

          <div className="space-y-5 relative z-0 pt-1">

          {/* ── メッセージウィンドウ（挨拶） ── */}
          <RpgWindow>
            <div className="px-4 py-3.5 md:px-5">
              {greetMsg.message.split("\n").map((line, i) => (
                <p key={i} className="text-[14px] md:text-[15px] text-white leading-relaxed">
                  {i === 0 ? `＊「${line}` : `　　${line}`}
                  {i === greetMsg.message.split("\n").length - 1 && <>」<BlinkCursor /></>}
                </p>
              ))}
            </div>
          </RpgWindow>

          {/* ── 休憩室 入室中ウィンドウ ── */}
          {optBreakRoom && (
            <RpgWindow title="きゅうけいちゅう">
              <div className="px-4 py-3.5 md:px-5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] text-amber-300">休憩室に入室中</p>
                  <p className="text-[11px] text-white/60 mt-1 tabular-nums">
                    No.{optBreakRoom.boxNumber}・{optBreakRoom.enteredAt}〜　休憩戻り打刻でも自動退室されます
                  </p>
                </div>
                <button
                  onClick={handleLeaveBreakRoom}
                  disabled={isPending}
                  className="shrink-0 text-[13px] text-white border-2 border-white rounded-lg px-4 py-2 hover:bg-white/10 active:scale-95 transition disabled:opacity-50"
                >
                  ▶ 退室する
                </button>
              </div>
            </RpgWindow>
          )}

          {/* ── きょうのクエスト＋ステータス ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1.5">

            {/* きょうのクエスト（本日のシフト） */}
            <RpgWindow title="きょうのクエスト">
              <div className="px-4 py-4 md:px-5">
                {hasShift ? (
                  <>
                    <p className="text-[11px] text-white/50 mb-1">シフトネーム</p>
                    <p className="text-[24px] text-amber-300 leading-tight mb-3">{shift.name}</p>
                    <p className="text-[11px] text-white/50 mb-1">シフト時間</p>
                    <p className="text-[16px] text-white tabular-nums">
                      {shift.start?.slice(0,5) ?? "--:--"} - {shift.end?.slice(0,5) ?? "--:--"}
                    </p>
                  </>
                ) : isHoliday ? (
                  <p className="text-[18px] text-white/70 py-3">きょうは おやすみだ。ゆっくり やすもう。</p>
                ) : (
                  <p className="text-[15px] text-white/40 py-3">クエストは ない（シフト未登録）</p>
                )}

                {/* 出発報告（出発前のみ） */}
                {enableDeparture && state === "pre_departure" && (
                  <button
                    onClick={() => !isPending && setModal("departure")}
                    disabled={isPending}
                    className="mt-4 w-full h-11 rounded-lg border-2 border-white text-white text-[14px] flex items-center justify-center gap-2 hover:bg-white/10 active:scale-[0.98] transition disabled:opacity-50"
                  >
                    ▶ しゅっぱつ ほうこく
                  </button>
                )}
              </div>
            </RpgWindow>

            {/* ステータス（勤怠） */}
            <RpgWindow title="ステータス">
              <div className="px-4 py-4 md:px-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] text-white/60">じょうたい</span>
                  <span className={`text-[16px] ${
                    state === "working"       ? "text-emerald-300"
                    : state === "clocked_out" ? "text-white/40"
                    : state === "pre_departure" ? "text-amber-300"
                    : "text-white"
                  }`}>
                    {state === "working" && (
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-300 mr-1.5 align-middle" style={{ animation: "rpgCursor 1.2s steps(1) infinite" }} />
                    )}
                    {STATE_CONFIG[state].label}
                  </span>
                </div>
                <div className="border-t border-white/20 pt-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-white/60">しゅっきん</span>
                    <span className="text-[20px] text-white tabular-nums">{clockInTime ?? "--:--"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-white/60">たいきん</span>
                    <span className="text-[20px] text-white tabular-nums">{clockOutTime ?? "--:--"}</span>
                  </div>
                </div>
              </div>
            </RpgWindow>
          </div>

          {/* ── コマンド（報告メニュー） ── */}
          <RpgWindow title="コマンド" className="mt-1.5">
            <div className="px-3 py-3 md:px-4 grid grid-cols-2 gap-2">

              {/* 欠勤報告 */}
              {showAbsenceBtn ? (
                <button
                  onClick={() => !isPending && setModal("absence")}
                  disabled={isPending}
                  className="flex items-center gap-2 px-3 py-3 rounded-lg text-left text-[14px] text-white hover:bg-white/10 active:scale-[0.98] transition disabled:opacity-50"
                >
                  <span className="text-amber-300">▶</span>欠勤報告
                </button>
              ) : hasAbsenceReport ? (
                <a
                  href="/absence-followup"
                  className="flex items-center gap-2 px-3 py-3 rounded-lg text-[14px] text-sky-300 hover:bg-white/10 transition"
                >
                  <span>▶</span>経過報告
                </a>
              ) : (
                <div className="flex items-center gap-2 px-3 py-3 text-[14px] text-white/30">
                  <span>▶</span>欠勤報告済
                </div>
              )}

              {/* 遅刻報告 */}
              {showLateBtn ? (
                <button
                  onClick={() => !isPending && setModal("late")}
                  disabled={isPending}
                  className="flex items-center gap-2 px-3 py-3 rounded-lg text-left text-[14px] text-white hover:bg-white/10 active:scale-[0.98] transition disabled:opacity-50"
                >
                  <span className="text-amber-300">▶</span>遅刻報告
                </button>
              ) : (
                <div className="flex items-center gap-2 px-3 py-3 text-[14px] text-white/30">
                  <span>▶</span>{hasLateReport ? "遅刻報告済" : "退勤済"}
                </div>
              )}

            </div>
          </RpgWindow>

          {/* ── きゅうけいキャンプ（打刻端末と同スタイル） ── */}
          {roomState && (
            <div
              className="relative rounded-2xl overflow-hidden border-2 border-[#2a3a8c] pb-5 mt-1.5"
              style={{
                background: "url(/rpg/camp-bg-v2.png) center / cover no-repeat, linear-gradient(180deg, #050a24 0%, #0a1340 55%, #14275c 100%)",
              }}
            >
              {/* 可読性のための暗めオーバーレイ */}
              <div className="absolute inset-0 bg-[#020617]/35 pointer-events-none" />

              {/* 焚き火のゆらめき */}
              <div className="absolute left-1/2 top-[64%] -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <div
                  className="w-28 h-20 rounded-full bg-orange-500/30 blur-xl"
                  style={{ animation: "rpgFlicker 1.7s ease-in-out infinite" }}
                />
                <div
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-9 rounded-full bg-amber-300/35 blur-md"
                  style={{ animation: "rpgFlicker 1.1s ease-in-out .3s infinite" }}
                />
                {[
                  { sx: "-8px", d: 0 },
                  { sx: "5px",  d: 0.6 },
                  { sx: "12px", d: 1.2 },
                  { sx: "-3px", d: 1.7 },
                ].map((sp, i) => (
                  <span
                    key={i}
                    className="absolute left-1/2 top-1/2 w-[3px] h-[3px] bg-amber-300 rounded-full"
                    style={{
                      "--sx": sp.sx,
                      animation: `rpgSpark 2.1s ease-out ${sp.d}s infinite`,
                    } as CSSProperties}
                  />
                ))}
              </div>

              <div className="relative px-4 pt-4">
                {/* メッセージウィンドウ＋なかまカウント */}
                <RpgWindow className="mb-3 shadow-xl shadow-black/50">
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-white text-sm leading-relaxed">
                        {!roomState.isOpen ? (
                          <>＊「きゅうけいキャンプは いま<br />
                          　 とざされている……。</>
                        ) : (
                          <>＊「ここは きゅうけいキャンプ。<br />
                          　 なかまと ひとやすみ していこう。</>
                        )}
                      </p>
                      <div className="text-right shrink-0">
                        <p className="text-cyan-300 text-[10px]">なかま</p>
                        <p className="text-white text-xl font-bold tabular-nums">
                          {roomState.uses.length}<span className="text-cyan-300 text-xs">／{roomState.capacity}にん</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-1.5 mt-2 flex-wrap">
                      <button
                        onClick={() => setRoomHelpOpen(true)}
                        className="text-[11px] text-white border border-white/50 rounded-md px-2.5 py-1.5 hover:bg-white/10 active:scale-95 transition-all"
                      >
                        <span className="text-amber-300 mr-1">▶</span>つかいかた
                      </button>
                      <a
                        href={BREAK_ROOM_MAP_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-white border border-white/50 rounded-md px-2.5 py-1.5 hover:bg-white/10 active:scale-95 transition-all"
                      >
                        <span className="text-amber-300 mr-1">▶</span>ちずをみる
                      </a>
                      {isAdmin && (
                        <button
                          onClick={handleToggleRoomOpen}
                          disabled={isPending}
                          className={`text-[11px] border rounded-md px-2.5 py-1.5 hover:bg-white/10 active:scale-95 transition disabled:opacity-50 ${
                            roomState.isOpen ? "text-red-300 border-red-400/60" : "text-emerald-300 border-emerald-400/60"
                          }`}
                        >
                          ▶ {roomState.isOpen ? "閉鎖する" : "開放する"}
                        </button>
                      )}
                    </div>
                  </div>
                </RpgWindow>

                {/* 1枠のみのコンパクト表示 */}
                <div className="flex justify-center">
                  {(() => {
                    const myUse = roomState.uses.find(u => u.staffId === myStaffId);
                    const isFull = roomState.uses.length >= roomState.capacity;

                    // 閉鎖中
                    if (!roomState.isOpen) {
                      return (
                        <div className="w-32 flex flex-col items-center justify-center pt-2 pb-1.5 px-1 rounded-xl border border-dashed border-[#3a4a9c]/50 opacity-60">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={rpgCharImg(RPG_CHARS[0].id)} alt="" draggable={false}
                            className="h-16 w-auto select-none opacity-40"
                            style={{ filter: "brightness(0) saturate(0)" }}
                          />
                          <p className="text-red-400 text-[10px] mt-1 font-bold">ヘイサちゅう</p>
                        </div>
                      );
                    }

                    // 自分が入室中
                    if (myUse) {
                      const cls = rpgCharFor(myUse.staffId, myUse.rpgCharId);
                      return (
                        <div className="w-32 flex flex-col items-center pt-2 pb-1.5 px-1 rounded-xl bg-[#000846]/40 border border-amber-300">
                          <div className="relative">
                            <div style={{ animation: "rpgBob 1.3s steps(2) infinite" }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={rpgCharImg(cls.id)} alt="" draggable={false} className="h-16 w-auto select-none" />
                            </div>
                            <span
                              className="absolute -top-1.5 -right-4 text-amber-300 text-[11px]"
                              style={{ animation: "rpgZzz 2.4s ease-out infinite" }}
                            >
                              Zzz
                            </span>
                          </div>
                          <p className="text-amber-300 text-[11px] font-bold mt-1">きゅうけいちゅう</p>
                          <p className="text-[9px] text-white/40 tabular-nums">{fmtHM(myUse.enteredAt)}〜</p>
                        </div>
                      );
                    }

                    // 満員
                    if (isFull) {
                      return (
                        <div className="w-32 flex flex-col items-center justify-center pt-2 pb-1.5 px-1 rounded-xl border border-dashed border-[#3a4a9c]/60 opacity-70">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={rpgCharImg(RPG_CHARS[0].id)} alt="" draggable={false}
                            className="h-16 w-auto select-none opacity-40"
                            style={{ filter: "brightness(0) saturate(0)" }}
                          />
                          <p className="text-red-300 text-[10px] mt-1 font-bold">あきわく なし</p>
                        </div>
                      );
                    }

                    // 空きあり → 募集中
                    return (
                      <button
                        onClick={handleEnterBreakRoom}
                        disabled={isPending}
                        className="w-32 flex flex-col items-center justify-center pt-2 pb-1.5 px-1 rounded-xl border border-dashed border-[#3a4a9c] hover:border-white/60 active:scale-95 transition-all disabled:opacity-60"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={rpgCharImg(RPG_CHARS[0].id)} alt="" draggable={false}
                          className="h-16 w-auto select-none opacity-50"
                          style={{ filter: "brightness(0) saturate(0)" }}
                        />
                        <p className="text-[#5a6abc] text-[9px] mt-1">ぼしゅうちゅう</p>
                        <p className="text-white/80 text-[10px] leading-tight">
                          <span className="text-amber-300 animate-pulse mr-0.5">▶</span>くわわる
                        </p>
                      </button>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* ── おしらせ（ギルドけいじばん） ── */}
          <RpgWindow title="おしらせ" className="mt-1.5">
            <div className="px-4 pt-4 pb-2 md:px-5 flex items-center justify-between">
              <span className="text-[12px] text-white/50">ギルドけいじばん</span>
              <a href="/notices" className="flex items-center gap-1 text-[12px] text-sky-300 hover:text-sky-200 transition-colors">
                すべて見る ▶
                {noticeCount > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold tabular-nums">
                    {noticeCount > 99 ? "99+" : noticeCount}
                  </span>
                )}
              </a>
            </div>
            {recentNotices.length > 0 ? (
              <div className="pb-2">
                {recentNotices.map(n => (
                  <a
                    key={n.id}
                    href="/notices"
                    className="flex items-center gap-3 px-4 md:px-5 py-2.5 border-t border-white/10 hover:bg-white/5 transition-colors"
                  >
                    <span className="text-amber-300 text-[11px] flex-shrink-0">★</span>
                    <span className="text-[11px] text-white/40 tabular-nums w-32 md:w-36 flex-shrink-0">{n.createdAt}</span>
                    <span className="text-[13px] text-white truncate">{n.title}</span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="px-4 md:px-5 pb-4 pt-1 text-[13px] text-white/40">おしらせは ない</p>
            )}
          </RpgWindow>

          {/* ── こんしゅうの ぼうけん（1週間カレンダー） ── */}
          {weekSchedule.length > 0 && (
            <RpgWindow title="こんしゅうの よてい" className="mt-1.5">
              <div className="px-3 pt-4 pb-3 md:px-5">
                <div className="grid grid-cols-7 gap-1.5 md:gap-2">
                  {weekSchedule.map(day => {
                    const isToday = day.date === todayDateStr;
                    const isOff   = !day.name || OFF_NAMES.has(day.name);
                    const sun     = isSunday(day.date);
                    const sat     = isSaturday(day.date);
                    return (
                      <div
                        key={day.date}
                        className={`flex flex-col items-center gap-1 rounded-md py-2 ${
                          isToday ? "bg-white" : ""
                        }`}
                      >
                        <p className={`text-[12px] tabular-nums leading-none ${
                          isToday ? "text-[#000846] font-bold" : sun ? "text-red-300" : sat ? "text-sky-300" : "text-white"
                        }`}>
                          {fmtMD(day.date)}
                        </p>
                        <p className={`text-[9px] leading-none ${
                          isToday ? "text-[#000846]/60" : sun ? "text-red-300/70" : sat ? "text-sky-300/70" : "text-white/40"
                        }`}>
                          ({dayOfWeek(day.date)})
                        </p>
                        <p className={`text-[11px] text-center leading-tight mt-0.5 ${
                          isToday ? (isOff ? "text-[#000846]/40" : "text-[#000846] font-bold")
                          : isOff ? "text-white/30"
                          : "text-amber-300"
                        }`}>
                          {isOff ? (day.name ? "公休" : "-") : (day.name ?? "-")}
                        </p>
                        {!isOff && day.start && (
                          <p className={`text-[9px] tabular-nums text-center leading-tight ${isToday ? "text-[#000846]/60" : "text-white/40"}`}>
                            {day.start.slice(0,5)}-{day.end?.slice(0,5) ?? "--"}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="border-t border-white/15 px-4 py-2.5">
                <a href="/shifts" className="flex items-center justify-center gap-1 text-[12px] text-sky-300 hover:text-sky-200 transition-colors">
                  スケジュールを すべて見る ▶
                </a>
              </div>
            </RpgWindow>
          )}

          {/* ── 今日のタスク（管理者のみ） ── */}
          {tasksWidget}

          </div>
        </div>
      </main>

      {/* ── トースト ── */}
      {feedback && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap px-5 py-3 rounded-lg border-2 text-[14px] shadow-2xl ${dotGothic.className} ${
          feedback.ok ? "bg-[#000846] border-white text-white" : "bg-red-700 border-white text-white"
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

      {/* ── 休憩室つかいかたモーダル（RPG風） ── */}
      {roomHelpOpen && (
        <div className={`fixed inset-0 z-[200] bg-black/80 flex items-center justify-center px-6 ${dotGothic.className}`} onClick={() => setRoomHelpOpen(false)}>
          <div className="w-full max-w-md max-h-[85dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <RpgWindow>
              <div className="px-5 py-4">
                <p className="text-amber-300 text-sm mb-3">【きゅうけいしつの つかいかた】</p>

                <div className="space-y-3 text-white text-[13px] leading-relaxed">
                  <div>
                    <p className="text-cyan-300 text-[11px] mb-0.5">▼ はいるとき</p>
                    <p>１．きゅうけいの だこくを する</p>
                    <p>２．「▶くわわる」を おす</p>
                  </div>
                  <div>
                    <p className="text-cyan-300 text-[11px] mb-0.5">▼ でるとき</p>
                    <p>・「きゅうけいちゅう」ウィンドウの<br />　「▶退室する」を おす</p>
                    <p>・きゅうけいもどり / たいきんの だこくでも<br />　じどうで パーティーから ぬけます</p>
                  </div>
                  <div>
                    <p className="text-cyan-300 text-[11px] mb-0.5">▼ ちゅうい</p>
                    <p>・きゅうけいちゅうの ひとだけ はいれます</p>
                    <p>・「あきわく なし」の ときは あきを まってね</p>
                    <p>・「ヘイサちゅう」の ときは つかえません</p>
                    <p>・ばしょは「▶ちずをみる」で かくにん（とほ５ふん）</p>
                  </div>
                </div>

                <button
                  onClick={() => setRoomHelpOpen(false)}
                  className="mt-4 w-full h-11 rounded-lg border-2 border-white text-white text-[14px] hover:bg-white/10 active:scale-[0.98] transition"
                >
                  ▶ とじる
                </button>
              </div>
            </RpgWindow>
          </div>
        </div>
      )}

      {/* ── マイキャラクター選択モーダル ── */}
      {charPickerOpen && (
        <div className={`fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4 ${dotGothic.className}`} onClick={() => setCharPickerOpen(false)}>
          <div
            className="rounded-lg border-2 border-white bg-[#000846] p-[3px] w-full max-w-2xl max-h-[85dvh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="rounded-md border border-white/80 bg-[#000846] flex flex-col overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/20 flex items-center justify-between shrink-0">
                <div>
                  <p className="text-[15px] text-white">キャラクターを えらぶ</p>
                  <p className="text-[11px] text-white/50 mt-0.5">あなたの ぶんしんに なる（全{RPG_CHARS.length}体）</p>
                </div>
                <button onClick={() => setCharPickerOpen(false)} className="text-white/50 hover:text-white text-lg px-2">✕</button>
              </div>
              <div className="overflow-y-auto overscroll-contain p-4">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {RPG_CHARS.map(c => {
                    const isCurrent = c.id === myChar.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => handlePickChar(c.id)}
                        disabled={isPending}
                        className={[
                          "flex flex-col items-center pt-2 pb-1.5 px-1 rounded-lg border transition-all active:scale-95 disabled:opacity-50",
                          isCurrent
                            ? "border-amber-300 bg-amber-300/10 ring-1 ring-amber-300"
                            : "border-white/25 hover:border-white/70 hover:bg-white/5",
                        ].join(" ")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={rpgCharImg(c.id)} alt="" draggable={false} loading="lazy" className="h-14 max-w-full object-contain select-none" />
                        <p className={`text-[10px] mt-1 w-full truncate text-center ${isCurrent ? "text-amber-300" : "text-white/80"}`}>{c.label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
