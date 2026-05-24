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

// iOS システムカラー
const C = {
  blue:      "#007AFF",
  green:     "#34C759",
  red:       "#FF3B30",
  orange:    "#FF9500",
  gray:      "#8E8E93",
  sep:       "#E5E5EA",
  sepDark:   "#38383A",
  groupBg:   "#F2F2F7",
  cardBg:    "#FFFFFF",
  cardDark:  "#1C1C1E",
};

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

// ── アイコン ──────────────────────────────────────────────────────────────
function DepartureIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>
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
        className="py-4 rounded-2xl text-white font-semibold text-[17px] active:opacity-70 disabled:opacity-50"
        style={{ backgroundColor: C.blue }}>できます</button>
      <button onClick={onNo} disabled={pending}
        className="py-4 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-semibold text-[17px] active:opacity-70 disabled:opacity-50">できません</button>
    </div>
  );
}

const WD = ["日","月","火","水","木","金","土"];
function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）`;
}

// ── iOS グループコンポーネント ─────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pt-7 pb-1.5 text-[13px] uppercase tracking-wide"
      style={{ color: C.gray }}>
      {children}
    </p>
  );
}

// グループラッパー（白丸角）
function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-4 rounded-2xl overflow-hidden"
      style={{ backgroundColor: C.cardBg }}>
      {children}
    </div>
  );
}

// 標準行（インセット区切り線）
function Row({
  label, value, sub, color, chevron, onPress, disabled, last = false,
}: {
  label: string;
  value?: React.ReactNode;
  sub?: string;
  color?: string;
  chevron?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const content = (
    <div className="flex items-center px-4 min-h-[44px] py-2 relative">
      <div className="flex-1 min-w-0">
        <p className="text-[17px] leading-tight" style={{ color: color ?? "#000000" }}>{label}</p>
        {sub && <p className="text-[13px] mt-0.5" style={{ color: C.gray }}>{sub}</p>}
      </div>
      {value !== undefined && (
        <div className="ml-3 flex-shrink-0 flex items-center gap-1">
          <span className="text-[17px]" style={{ color: C.gray }}>{value}</span>
          {chevron && <ChevronRightIcon className="w-[18px] h-[18px] opacity-30 ml-0.5" />}
        </div>
      )}
      {chevron && value === undefined && (
        <ChevronRightIcon className="w-[18px] h-[18px] opacity-30 ml-3" />
      )}
      {/* インセット区切り線（最終行以外） */}
      {!last && (
        <div className="absolute bottom-0 left-4 right-0 h-px" style={{ backgroundColor: C.sep }} />
      )}
    </div>
  );

  if (onPress) {
    return (
      <button onClick={onPress} disabled={disabled}
        className="w-full text-left active:opacity-50 disabled:opacity-40 transition-opacity">
        {content}
      </button>
    );
  }
  return <div>{content}</div>;
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
    {/* iOS systemGroupedBackground */}
    <main className="min-h-screen" style={{ backgroundColor: C.groupBg }}>
      <div className="max-w-md mx-auto pb-32">

        {/* ── Large Title ヘッダー ─────────────────────────────── */}
        <div className="px-4 pt-14 pb-2 flex items-start justify-between">
          <div>
            {greeting && (
              <p className="text-[13px] mb-0.5" style={{ color: C.gray }}>{greeting}</p>
            )}
            <h1 className="text-[28px] font-bold tracking-tight text-black dark:text-white leading-tight">
              {displayName}
            </h1>
            {hasMultipleProjects && (
              <p className="text-[13px] mt-0.5" style={{ color: C.gray }}>{projectName}</p>
            )}
          </div>
          <a href="/notices" className="relative mt-2">
            <BellIcon className="w-[22px] h-[22px]" style={{ color: C.gray } as React.CSSProperties} />
            {noticeCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-white text-[9px] font-bold flex items-center justify-center"
                style={{ backgroundColor: C.red }}>
                {noticeCount > 99 ? "99+" : noticeCount}
              </span>
            )}
          </a>
        </div>

        {/* ════════════════════════ 出発報告あり ════════════════════════ */}
        {enableDeparture && (<>

          {/* 今日のシフト */}
          <SectionHeader>今日 · {todayLabel}</SectionHeader>
          <Group>
            {!shift && (
              <Row label="シフト未登録" value={<span style={{ color: C.gray }}>—</span>} last />
            )}
            {shift && isHoliday && (
              <Row label="公休日" last />
            )}
            {shift && !isHoliday && (<>
              <Row
                label={shift.name ?? "シフト"}
                value={shift.start
                  ? `${shift.start.slice(0,5)}–${shift.end?.slice(0,5) ?? "--:--"}`
                  : undefined}
                last={state === "working" || state === "clocked_out" ? false : true}
              />
              {state === "working" && (
                <Row
                  label="勤務中"
                  color={C.green}
                  value={
                    <span className="flex items-center gap-1.5">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                          style={{ backgroundColor: C.green }}/>
                        <span className="relative inline-flex h-2 w-2 rounded-full"
                          style={{ backgroundColor: C.green }}/>
                      </span>
                    </span>
                  }
                  last
                />
              )}
              {state === "clocked_out" && (
                <Row label="退勤済み · お疲れ様でした" color={C.gray} last />
              )}
              {state === "pre_clock_in" && optDeparture && (
                <Row label="出発済み · 現場で打刻を" color={C.gray} last />
              )}
            </>)}
          </Group>

          {/* 出発報告ボタン */}
          {state === "pre_departure" && (
            <div className="mx-4 mt-3">
              <button
                onClick={() => !isPending && setModal("departure")}
                disabled={isPending}
                className="w-full h-[50px] rounded-2xl text-white text-[17px] font-semibold active:opacity-75 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
                style={{ backgroundColor: C.blue }}
              >
                <DepartureIcon className="w-[18px] h-[18px]" />
                {isPending ? "処理中..." : "出発報告する"}
              </button>
            </div>
          )}

          {/* 打刻 */}
          <SectionHeader>打刻</SectionHeader>
          <Group>
            <Row label="出発" value={
              <span className={optDeparture ? "text-black dark:text-white" : undefined}
                style={optDeparture ? { color: "#000", fontVariantNumeric: "tabular-nums" } : {}}>
                {optDeparture ?? "—"}
              </span>
            } />
            <Row label="出勤" value={
              <span style={optClockIn ? { color: "#000", fontVariantNumeric: "tabular-nums" } : {}}>
                {optClockIn ?? "—"}
              </span>
            } />
            <Row label="退勤" value={
              <span style={optClockOut ? { color: "#000", fontVariantNumeric: "tabular-nums" } : {}}>
                {optClockOut ?? "—"}
              </span>
            } last />
          </Group>

          {/* 欠勤・遅刻報告 */}
          {canReport && (<>
            <SectionHeader>報告</SectionHeader>
            <Group>
              {hasAbsenceReport ? (
                <Row
                  label="欠勤"
                  value={<span className="text-[13px] px-2 py-0.5 rounded-full bg-zinc-100"
                    style={{ color: C.gray }}>報告済 · {statusBadge(absenceStatus)}</span>}
                />
              ) : (
                <Row
                  label="欠勤報告"
                  color={C.red}
                  chevron
                  onPress={() => !isPending && setModal("absence")}
                  disabled={isPending}
                />
              )}
              {hasLateReport ? (
                <Row
                  label="遅刻"
                  value={<span className="text-[13px] px-2 py-0.5 rounded-full bg-zinc-100"
                    style={{ color: C.gray }}>報告済 · {statusBadge(lateStatus)}</span>}
                  last
                />
              ) : (
                <Row
                  label="遅刻報告"
                  color={C.orange}
                  chevron
                  onPress={() => !isPending && setModal("late")}
                  disabled={isPending}
                  last
                />
              )}
            </Group>
          </>)}

          {/* 次回出勤 */}
          {upcomingShifts && upcomingShifts.length > 0 && (<>
            <SectionHeader>次回出勤</SectionHeader>
            <Group>
              {upcomingShifts.map((s, i) => (
                <Row
                  key={s.date}
                  label={fmtDate(s.date)}
                  value={
                    <span className="flex items-center gap-1.5">
                      {s.name && <span className="font-semibold text-[15px]" style={{ color: "#000" }}>{s.name}</span>}
                      {s.start && (
                        <span className="text-[14px]" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {s.start.slice(0,5)}–{s.end?.slice(0,5) ?? "--:--"}
                        </span>
                      )}
                    </span>
                  }
                  chevron
                  onPress={() => { window.location.href = "/shifts"; }}
                  last={i === upcomingShifts.length - 1}
                />
              ))}
            </Group>
          </>)}

        </>)}

        {/* ════════════════════════ 出発報告なし ════════════════════════ */}
        {!enableDeparture && (<>

          {/* ライブクロック */}
          <div className="px-4 pt-4 pb-2">
            <p className="text-[13px] mb-2" style={{ color: C.gray }}>{todayLabel}</p>
            <p className="text-[72px] font-thin tabular-nums leading-none tracking-tight text-black dark:text-white">
              {liveTime}
            </p>
          </div>

          {/* 今日のシフト */}
          <SectionHeader>今日のシフト</SectionHeader>
          <Group>
            {!shift && <Row label="シフト未登録" last />}
            {shift && isHoliday && <Row label="公休日" last />}
            {shift && !isHoliday && (
              <Row
                label={shift.name ?? "シフト"}
                value={shift.start ? `${shift.start.slice(0,5)}–${shift.end?.slice(0,5) ?? "--:--"}` : undefined}
                last
              />
            )}
          </Group>

          {/* 打刻 */}
          <SectionHeader>打刻</SectionHeader>
          <Group>
            <Row label="出勤" value={
              <span style={optClockIn ? { color: "#000", fontVariantNumeric: "tabular-nums" } : {}}>
                {optClockIn ?? "—"}
              </span>
            } />
            <Row label="退勤" value={
              <span style={optClockOut ? { color: "#000", fontVariantNumeric: "tabular-nums" } : {}}>
                {optClockOut ?? "—"}
              </span>
            } last />
          </Group>

          {/* 報告 */}
          {canReport && (<>
            <SectionHeader>報告</SectionHeader>
            <Group>
              {hasAbsenceReport ? (
                <Row label="欠勤" value={<span className="text-[13px] px-2 py-0.5 rounded-full bg-zinc-100" style={{ color: C.gray }}>報告済 · {statusBadge(absenceStatus)}</span>} />
              ) : (
                <Row label="欠勤報告" color={C.red} chevron onPress={() => !isPending && setModal("absence")} disabled={isPending} />
              )}
              {hasLateReport ? (
                <Row label="遅刻" value={<span className="text-[13px] px-2 py-0.5 rounded-full bg-zinc-100" style={{ color: C.gray }}>報告済 · {statusBadge(lateStatus)}</span>} last />
              ) : (
                <Row label="遅刻報告" color={C.orange} chevron onPress={() => !isPending && setModal("late")} disabled={isPending} last />
              )}
            </Group>
          </>)}

          {/* 次回出勤 */}
          {upcomingShifts && upcomingShifts.length > 0 && (<>
            <SectionHeader>次回出勤</SectionHeader>
            <Group>
              {upcomingShifts.map((s, i) => (
                <Row key={s.date}
                  label={fmtDate(s.date)}
                  value={
                    <span className="flex items-center gap-1.5">
                      {s.name && <span className="font-semibold text-[15px]" style={{ color: "#000" }}>{s.name}</span>}
                      {s.start && <span style={{ fontVariantNumeric: "tabular-nums" }}>{s.start.slice(0,5)}–{s.end?.slice(0,5) ?? "--:--"}</span>}
                    </span>
                  }
                  chevron
                  onPress={() => { window.location.href = "/shifts"; }}
                  last={i === upcomingShifts.length - 1}
                />
              ))}
            </Group>
          </>)}

        </>)}

        <div className="h-8" />
      </div>
    </main>

    {/* トースト */}
    {feedback && (
      <div className={[
        "fixed bottom-24 left-1/2 -translate-x-1/2 z-40 whitespace-nowrap",
        "px-5 py-3 rounded-2xl text-[14px] font-semibold shadow-xl",
        feedback.ok ? "bg-zinc-900 text-white" : "text-white",
      ].join(" ")}
        style={!feedback.ok ? { backgroundColor: C.red } : {}}>
        {feedback.msg}
      </div>
    )}

    {/* ════════════ MODALS ════════════ */}
    {modal === "departure" && (
      <ModalWrap onClose={closeModal}>
        <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">出発を報告する</h2>
        <p className="text-[13px] mb-5" style={{ color: C.gray }}>到着予定を選んでください</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {ETA_OPTS.map(({ label, value }) => (
            <button key={value} onClick={() => setEtaDep(value)}
              className="py-2.5 rounded-xl text-[15px] font-semibold active:opacity-70"
              style={{ backgroundColor: etaDep === value ? C.blue : "#F2F2F7", color: etaDep === value ? "#fff" : "#000" }}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={closeModal} className="flex-1 py-3 rounded-2xl text-[17px] font-semibold"
            style={{ backgroundColor: "#F2F2F7", color: C.blue }}>キャンセル</button>
          <button onClick={handleDeparture} disabled={isPending} className="flex-1 py-3 rounded-2xl text-white text-[17px] font-semibold disabled:opacity-50"
            style={{ backgroundColor: C.blue }}>報告する</button>
        </div>
      </ModalWrap>
    )}

    {modal === "absence" && (
      <ModalWrap onClose={closeModal}>
        {absStep === 1 && (<>
          <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">欠勤を報告する</h2>
          <p className="text-[13px] mb-5" style={{ color: C.gray }}>1 / 3</p>
          <textarea value={absReason} onChange={e => setAbsReason(e.target.value)}
            placeholder="欠勤の理由を入力..." rows={4}
            className="w-full px-3 py-2.5 rounded-xl border text-[16px] resize-none mb-4 focus:outline-none"
            style={{ borderColor: C.sep }} />
          <div className="flex gap-3">
            <button onClick={closeModal} className="flex-1 py-3 rounded-2xl text-[17px] font-semibold"
              style={{ backgroundColor: "#F2F2F7", color: C.blue }}>キャンセル</button>
            <button onClick={() => setAbsStep(2)} disabled={!absReason.trim()} className="flex-1 py-3 rounded-2xl text-white text-[17px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: C.blue }}>次へ</button>
          </div>
        </>)}
        {absStep === 2 && (<>
          <p className="text-[13px] mb-2" style={{ color: C.gray }}>2 / 3</p>
          <h2 className="text-[24px] font-bold text-zinc-900 dark:text-zinc-50 leading-snug">明日は<br/>出勤できますか？</h2>
          <YesNo onYes={() => { setAbsNextDay(true); setAbsStep(3); }} onNo={() => { setAbsNextDay(false); setAbsStep(3); }} />
          <button onClick={() => setAbsStep(1)} className="mt-3 w-full py-2 text-[15px]" style={{ color: C.blue }}>戻る</button>
        </>)}
        {absStep === 3 && (<>
          <p className="text-[13px] mb-2" style={{ color: C.gray }}>3 / 3</p>
          <h2 className="text-[24px] font-bold text-zinc-900 dark:text-zinc-50 leading-snug">明後日は<br/>出勤できますか？</h2>
          <YesNo onYes={() => handleAbsence(absNextDay, true)} onNo={() => handleAbsence(absNextDay, false)} pending={isPending} />
          <button onClick={() => setAbsStep(2)} className="mt-3 w-full py-2 text-[15px]" style={{ color: C.blue }}>戻る</button>
        </>)}
      </ModalWrap>
    )}

    {modal === "late" && (
      <ModalWrap onClose={closeModal}>
        {lateStep === 1 && (<>
          <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">遅刻を報告する</h2>
          <p className="text-[13px] mb-5" style={{ color: C.gray }}>1 / 2</p>
          <textarea value={lateReason} onChange={e => setLateReason(e.target.value)}
            placeholder="遅刻の理由を入力..." rows={4}
            className="w-full px-3 py-2.5 rounded-xl border text-[16px] resize-none mb-4 focus:outline-none"
            style={{ borderColor: C.sep }} />
          <div className="flex gap-3">
            <button onClick={closeModal} className="flex-1 py-3 rounded-2xl text-[17px] font-semibold"
              style={{ backgroundColor: "#F2F2F7", color: C.blue }}>キャンセル</button>
            <button onClick={() => setLateStep(2)} disabled={!lateReason.trim()} className="flex-1 py-3 rounded-2xl text-white text-[17px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: C.orange }}>次へ</button>
          </div>
        </>)}
        {lateStep === 2 && (<>
          <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50 mb-0.5">到着予定</h2>
          <p className="text-[13px] mb-5" style={{ color: C.gray }}>2 / 2</p>
          <div className="grid grid-cols-3 gap-2 mb-5">
            {ETA_OPTS.map(({ label, value }) => (
              <button key={value} onClick={() => setLateEta(value)}
                className="py-2.5 rounded-xl text-[15px] font-semibold active:opacity-70"
                style={{ backgroundColor: lateEta === value ? C.orange : "#F2F2F7", color: lateEta === value ? "#fff" : "#000" }}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setLateStep(1)} className="flex-1 py-3 rounded-2xl text-[17px] font-semibold"
              style={{ backgroundColor: "#F2F2F7", color: C.blue }}>戻る</button>
            <button onClick={handleLate} disabled={isPending} className="flex-1 py-3 rounded-2xl text-white text-[17px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: C.orange }}>{isPending ? "送信中..." : "報告する"}</button>
          </div>
        </>)}
      </ModalWrap>
    )}
    </>
  );
}
