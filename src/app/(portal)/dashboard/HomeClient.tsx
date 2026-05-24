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

// ── SVG アイコン ──────────────────────────────────────────────────────────
function DepartureIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className}>
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
function AbsenceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="10" cy="8" r="3.5"/>
      <path d="M3 20c0-3.5 3.1-6 7-6"/>
      <line x1="17" y1="14" x2="22" y2="19"/>
      <line x1="22" y1="14" x2="17" y2="19"/>
    </svg>
  );
}
function LateIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3 2"/>
    </svg>
  );
}
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="18" height="18" rx="3"/>
      <path d="M16 2v4M8 2v4M3 10h18"/>
    </svg>
  );
}

// ── ETA ───────────────────────────────────────────────────────────────────
const ETA_OPTS = [
  { label: "すぐ着く", value: 5 },
  { label: "10分",     value: 10 },
  { label: "20分",     value: 20 },
  { label: "30分",     value: 30 },
  { label: "45分",     value: 45 },
  { label: "1時間以上", value: 60 },
];

// ── モーダル ──────────────────────────────────────────────────────────────
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
        className="py-4 rounded-2xl bg-blue-600 text-white font-bold active:opacity-70 disabled:opacity-50">できます</button>
      <button onClick={onNo} disabled={pending}
        className="py-4 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-bold active:opacity-70 disabled:opacity-50">できません</button>
    </div>
  );
}

const WD = ["日","月","火","水","木","金","土"];
function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）`;
}

// ── デザインパーツ ────────────────────────────────────────────────────────

// iOS Settings スタイルのアイコンボックス
function IconBox({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className={`w-[34px] h-[34px] rounded-[9px] flex items-center justify-center flex-shrink-0 ${color}`}>
      {children}
    </div>
  );
}

// セクションヘッダー（グループ見出し）
function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/60 px-5 h-9 flex items-end pb-1.5">
      <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">{children}</span>
    </div>
  );
}

// リスト行（インセット区切り線）
function ListRow({
  icon, label, value, sub, chevron = false, onPress, disabled, color,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: React.ReactNode;
  sub?: string;
  chevron?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  color?: string;
}) {
  const inner = (
    <div className="flex items-center gap-3.5 h-[54px]">
      {icon && icon}
      <div className="flex-1 flex items-center justify-between min-w-0"
        style={{ borderBottom: "1px solid rgb(240 240 240)" }}
        // 区切り線はアイコンの右から（インセット）
      >
        <div className="min-w-0">
          <p className={`text-[16px] leading-tight ${color ?? "text-zinc-900 dark:text-zinc-100"}`}>{label}</p>
          {sub && <p className="text-[12px] text-zinc-400 mt-0.5">{sub}</p>}
        </div>
        <div className="flex items-center gap-1.5 ml-3 flex-shrink-0">
          {value && <span className="text-[15px] text-zinc-400 dark:text-zinc-500 tabular-nums">{value}</span>}
          {chevron && <ChevronRightIcon className="w-4 h-4 text-zinc-300 dark:text-zinc-600" />}
        </div>
      </div>
    </div>
  );

  if (onPress) {
    return (
      <button onClick={onPress} disabled={disabled}
        className="w-full px-5 active:bg-zinc-100 dark:active:bg-zinc-800/60 disabled:opacity-40 transition-colors text-left">
        {inner}
      </button>
    );
  }
  return <div className="px-5">{inner}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function HomeClient({
  displayName, projectName, hasMultipleProjects, todayLabel,
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

  const [liveTime, setLiveTime] = useState(nowJST);
  useEffect(() => {
    if (enableDeparture) return;
    const id = setInterval(() => setLiveTime(nowJST()), 10000);
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

  return (
    <>
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-md mx-auto pb-32">

        {/* ══════════════════════════════════════════
            ヘッダー
        ══════════════════════════════════════════ */}
        <div className="bg-white dark:bg-zinc-900/0 px-5 pt-14 pb-6 flex items-start justify-between">
          <div>
            {greeting && (
              <p className="text-[12px] text-zinc-400 dark:text-zinc-600 mb-0.5 tracking-wide">{greeting}</p>
            )}
            <h1 className="text-[22px] font-bold tracking-tight text-zinc-900 dark:text-zinc-50 leading-tight">
              {displayName}
            </h1>
            {hasMultipleProjects && (
              <p className="text-[12px] text-zinc-400 dark:text-zinc-600 mt-0.5">{projectName}</p>
            )}
          </div>
          <a href="/notices" className="relative mt-1">
            <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <BellIcon className="w-[18px] h-[18px] text-zinc-500 dark:text-zinc-400" />
            </div>
            {noticeCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                {noticeCount > 99 ? "99+" : noticeCount}
              </span>
            )}
          </a>
        </div>

        {/* ══════════════════════════════════════════
            出発報告あり
        ══════════════════════════════════════════ */}
        {enableDeparture && (<>

          {/* 今日のシフト */}
          <div className="mt-6">
            <GroupHeader>今日</GroupHeader>
            <div className="bg-white dark:bg-zinc-900">
              {/* 日付 */}
              <ListRow
                icon={<IconBox color="bg-blue-500"><CalendarIcon className="w-4 h-4 text-white" /></IconBox>}
                label={todayLabel}
                value={
                  !shift ? "シフト未登録" :
                  isHoliday ? "公休日" :
                  shift.start ? `${shift.start.slice(0,5)}–${shift.end?.slice(0,5) ?? "--:--"}` : undefined
                }
              />
              {/* シフト名（あれば） */}
              {shift && !isHoliday && shift.name && (
                <ListRow
                  icon={<IconBox color="bg-indigo-500"><DepartureIcon className="w-4 h-4 text-white" /></IconBox>}
                  label={shift.name}
                  value={
                    state === "working" ? (
                      <span className="flex items-center gap-1.5 text-emerald-500 text-[13px] font-semibold">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/>
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"/>
                        </span>
                        勤務中
                      </span>
                    ) : state === "clocked_out" ? (
                      <span className="text-[13px] text-zinc-400">退勤済み</span>
                    ) : undefined
                  }
                />
              )}
            </div>
          </div>

          {/* 出発報告ボタン */}
          {state === "pre_departure" && (
            <div className="px-4 py-4">
              <button
                onClick={() => !isPending && setModal("departure")}
                disabled={isPending}
                className="w-full h-[52px] rounded-2xl bg-blue-600 active:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2.5 shadow-sm shadow-blue-600/30"
              >
                <DepartureIcon className="w-[18px] h-[18px] text-white" />
                <span className="text-[16px] font-bold text-white">
                  {isPending ? "処理中..." : "出発報告する"}
                </span>
              </button>
            </div>
          )}

          {/* 打刻 */}
          <div className="mt-6">
            <GroupHeader>打刻</GroupHeader>
            <div className="bg-white dark:bg-zinc-900">
              <ListRow
                icon={<IconBox color="bg-sky-500"><DepartureIcon className="w-4 h-4 text-white" /></IconBox>}
                label="出発"
                value={optDeparture ?? <span className="text-zinc-200 dark:text-zinc-700">--:--</span>}
              />
              <ListRow
                icon={<IconBox color="bg-emerald-500"><CheckCircleIcon className="w-4 h-4 text-white" /></IconBox>}
                label="出勤"
                value={optClockIn ?? <span className="text-zinc-200 dark:text-zinc-700">--:--</span>}
              />
              <ListRow
                icon={<IconBox color="bg-violet-500"><ClockIcon className="w-4 h-4 text-white" /></IconBox>}
                label="退勤"
                value={optClockOut ?? <span className="text-zinc-200 dark:text-zinc-700">--:--</span>}
              />
            </div>
          </div>

          {/* 欠勤・遅刻報告 */}
          {canReport && (
            <div className="mt-6">
              <GroupHeader>報告</GroupHeader>
              <div className="bg-white dark:bg-zinc-900">
                {hasAbsenceReport ? (
                  <ListRow
                    icon={<IconBox color="bg-zinc-300 dark:bg-zinc-700"><AbsenceIcon className="w-4 h-4 text-white" /></IconBox>}
                    label="欠勤"
                    value={<span className="text-[12px] bg-zinc-100 dark:bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">報告済 · {statusBadge(absenceStatus)}</span>}
                  />
                ) : (
                  <ListRow
                    icon={<IconBox color="bg-red-500"><AbsenceIcon className="w-4 h-4 text-white" /></IconBox>}
                    label="欠勤報告"
                    color="text-red-500"
                    chevron
                    onPress={() => !isPending && setModal("absence")}
                    disabled={isPending}
                  />
                )}
                {hasLateReport ? (
                  <ListRow
                    icon={<IconBox color="bg-zinc-300 dark:bg-zinc-700"><LateIcon className="w-4 h-4 text-white" /></IconBox>}
                    label="遅刻"
                    value={<span className="text-[12px] bg-zinc-100 dark:bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">報告済 · {statusBadge(lateStatus)}</span>}
                  />
                ) : (
                  <ListRow
                    icon={<IconBox color="bg-amber-500"><LateIcon className="w-4 h-4 text-white" /></IconBox>}
                    label="遅刻報告"
                    color="text-amber-500"
                    chevron
                    onPress={() => !isPending && setModal("late")}
                    disabled={isPending}
                  />
                )}
              </div>
            </div>
          )}

          {/* 次回出勤 */}
          {upcomingShifts && upcomingShifts.length > 0 && (
            <div className="mt-6">
              <GroupHeader>次回出勤</GroupHeader>
              <div className="bg-white dark:bg-zinc-900">
                {upcomingShifts.map((s) => (
                  <ListRow
                    key={s.date}
                    icon={<IconBox color="bg-zinc-400 dark:bg-zinc-600"><CalendarIcon className="w-4 h-4 text-white" /></IconBox>}
                    label={fmtDate(s.date)}
                    value={
                      <span className="flex items-center gap-1.5">
                        {s.name && <span className="font-semibold text-zinc-600 dark:text-zinc-400">{s.name}</span>}
                        {s.start && <span className="tabular-nums">{s.start.slice(0,5)}–{s.end?.slice(0,5) ?? "--:--"}</span>}
                      </span>
                    }
                    chevron
                    onPress={() => { window.location.href = "/shifts"; }}
                  />
                ))}
              </div>
            </div>
          )}

        </>)}

        {/* ══════════════════════════════════════════
            出発報告なし
        ══════════════════════════════════════════ */}
        {!enableDeparture && (<>

          {/* ライブクロック */}
          <div className="bg-white dark:bg-zinc-900 px-5 pt-2 pb-6 mb-6">
            <p className="text-[12px] text-zinc-400 tabular-nums mb-2">{todayLabel}</p>
            <p className="text-[72px] font-thin tabular-nums leading-none tracking-tight text-zinc-900 dark:text-white">
              {liveTime}
            </p>
          </div>

          {/* 今日のシフト */}
          <GroupHeader>今日</GroupHeader>
          <div className="bg-white dark:bg-zinc-900">
            <ListRow
              icon={<IconBox color="bg-indigo-500"><DepartureIcon className="w-4 h-4 text-white" /></IconBox>}
              label={!shift ? "シフト未登録" : isHoliday ? "公休日" : shift.name ?? "シフト未登録"}
              value={shift && !isHoliday && shift.start
                ? `${shift.start.slice(0,5)}–${shift.end?.slice(0,5) ?? "--:--"}`
                : undefined}
            />
          </div>

          {/* 打刻 */}
          <div className="mt-6">
            <GroupHeader>打刻</GroupHeader>
            <div className="bg-white dark:bg-zinc-900">
              <ListRow
                icon={<IconBox color="bg-emerald-500"><CheckCircleIcon className="w-4 h-4 text-white" /></IconBox>}
                label="出勤"
                value={optClockIn ?? <span className="text-zinc-200 dark:text-zinc-700">--:--</span>}
              />
              <ListRow
                icon={<IconBox color="bg-violet-500"><ClockIcon className="w-4 h-4 text-white" /></IconBox>}
                label="退勤"
                value={optClockOut ?? <span className="text-zinc-200 dark:text-zinc-700">--:--</span>}
              />
            </div>
          </div>

          {/* 欠勤・遅刻 */}
          {canReport && (
            <div className="mt-6">
              <GroupHeader>報告</GroupHeader>
              <div className="bg-white dark:bg-zinc-900">
                {hasAbsenceReport ? (
                  <ListRow
                    icon={<IconBox color="bg-zinc-300 dark:bg-zinc-700"><AbsenceIcon className="w-4 h-4 text-white" /></IconBox>}
                    label="欠勤"
                    value={<span className="text-[12px] bg-zinc-100 dark:bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">報告済 · {statusBadge(absenceStatus)}</span>}
                  />
                ) : (
                  <ListRow
                    icon={<IconBox color="bg-red-500"><AbsenceIcon className="w-4 h-4 text-white" /></IconBox>}
                    label="欠勤報告"
                    color="text-red-500"
                    chevron
                    onPress={() => !isPending && setModal("absence")}
                    disabled={isPending}
                  />
                )}
                {hasLateReport ? (
                  <ListRow
                    icon={<IconBox color="bg-zinc-300 dark:bg-zinc-700"><LateIcon className="w-4 h-4 text-white" /></IconBox>}
                    label="遅刻"
                    value={<span className="text-[12px] bg-zinc-100 dark:bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">報告済 · {statusBadge(lateStatus)}</span>}
                  />
                ) : (
                  <ListRow
                    icon={<IconBox color="bg-amber-500"><LateIcon className="w-4 h-4 text-white" /></IconBox>}
                    label="遅刻報告"
                    color="text-amber-500"
                    chevron
                    onPress={() => !isPending && setModal("late")}
                    disabled={isPending}
                  />
                )}
              </div>
            </div>
          )}

          {/* 次回出勤 */}
          {upcomingShifts && upcomingShifts.length > 0 && (
            <div className="mt-6">
              <GroupHeader>次回出勤</GroupHeader>
              <div className="bg-white dark:bg-zinc-900">
                {upcomingShifts.map((s) => (
                  <ListRow
                    key={s.date}
                    icon={<IconBox color="bg-zinc-400 dark:bg-zinc-600"><CalendarIcon className="w-4 h-4 text-white" /></IconBox>}
                    label={fmtDate(s.date)}
                    value={
                      <span className="flex items-center gap-1.5">
                        {s.name && <span className="font-semibold text-zinc-600 dark:text-zinc-400">{s.name}</span>}
                        {s.start && <span className="tabular-nums">{s.start.slice(0,5)}–{s.end?.slice(0,5) ?? "--:--"}</span>}
                      </span>
                    }
                    chevron
                    onPress={() => { window.location.href = "/shifts"; }}
                  />
                ))}
              </div>
            </div>
          )}

        </>)}

        <div className="h-6" />
      </div>
    </main>

    {/* トースト */}
    {feedback && (
      <div className={[
        "fixed bottom-24 left-1/2 -translate-x-1/2 z-40 whitespace-nowrap",
        "px-5 py-3 rounded-2xl text-sm font-semibold shadow-xl",
        feedback.ok ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-red-500 text-white",
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
              className={`py-2.5 rounded-xl text-sm font-semibold active:opacity-70 ${
                etaDep === value ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              }`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={closeModal} className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500">キャンセル</button>
          <button onClick={handleDeparture} disabled={isPending} className="flex-1 py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50">報告する</button>
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
            <button onClick={closeModal} className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500">キャンセル</button>
            <button onClick={() => setAbsStep(2)} disabled={!absReason.trim()} className="flex-1 py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50">次へ</button>
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
          <YesNo onYes={() => handleAbsence(absNextDay, true)} onNo={() => handleAbsence(absNextDay, false)} pending={isPending} />
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
            <button onClick={closeModal} className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500">キャンセル</button>
            <button onClick={() => setLateStep(2)} disabled={!lateReason.trim()} className="flex-1 py-3 rounded-2xl bg-amber-500 text-white text-sm font-bold disabled:opacity-50">次へ</button>
          </div>
        </>)}
        {lateStep === 2 && (<>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">到着予定</h2>
          <p className="text-xs text-zinc-500 mb-5">2 / 2</p>
          <div className="grid grid-cols-3 gap-2 mb-5">
            {ETA_OPTS.map(({ label, value }) => (
              <button key={value} onClick={() => setLateEta(value)}
                className={`py-2.5 rounded-xl text-sm font-semibold active:opacity-70 ${
                  lateEta === value ? "bg-amber-500 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setLateStep(1)} className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500">戻る</button>
            <button onClick={handleLate} disabled={isPending} className="flex-1 py-3 rounded-2xl bg-amber-500 text-white text-sm font-bold disabled:opacity-50">{isPending ? "送信中..." : "報告する"}</button>
          </div>
        </>)}
      </ModalWrap>
    )}
    </>
  );
}
