"use client";

import { useState, useEffect } from "react";
import ShiftCalendar, { type ShiftChangeLog } from "./ShiftCalendar";
import HolidayTab from "./HolidayTab";
import { dotGothic, RPG_PAGE_BG, RPG_KEYFRAMES, RpgWindow, BlinkCursor } from "@/components/rpg-ui";

type ShiftData = {
  shift_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  note?: string | null;
};
type HolidayRequest  = { id: string; request_date: string; status: string; note: string | null };
type ShiftRequest    = { id: string; request_date: string; opening_id: string | null; preferred_start: string | null; preferred_end: string | null; reason: string | null; status: string; created_at: string };
type ShiftOpening    = { id: string; opening_date: string; shift_name: string; shift_start: string; shift_end: string; capacity: number; note: string | null };

type Props = {
  projectId: string;
  shifts: ShiftData[];
  changeLogs?: ShiftChangeLog[];
  todayStr: string;
  initialYear: number;
  initialMonth: number;
  minMonth: string;
  maxMonth: string;
  holidayRequests: HolidayRequest[];
  shiftRequests: ShiftRequest[];
  shiftOpenings: ShiftOpening[];
  holidayOpenDay?: number | null;
  holidayDeadlineDay?: number | null;
  holidayMaxDaysPerMonth?: number | null;
  holidayWeekendLimit?: number | null;
};


const WD_FULL = ["日曜日","月曜日","火曜日","水曜日","木曜日","金曜日","土曜日"];
const JP_HOLIDAYS: Record<string, string> = {
  "2025-01-01":"元日","2025-01-13":"成人の日","2025-02-11":"建国記念の日",
  "2025-02-23":"天皇誕生日","2025-03-20":"春分の日","2025-04-29":"昭和の日",
  "2025-05-03":"憲法記念日","2025-05-04":"みどりの日","2025-05-05":"こどもの日",
  "2025-07-21":"海の日","2025-08-11":"山の日","2025-09-15":"敬老の日",
  "2025-09-23":"秋分の日","2025-10-13":"スポーツの日","2025-11-03":"文化の日",
  "2025-11-23":"勤労感謝の日","2026-01-01":"元日","2026-01-12":"成人の日",
  "2026-02-11":"建国記念の日","2026-02-23":"天皇誕生日","2026-03-20":"春分の日",
  "2026-04-29":"昭和の日","2026-05-03":"憲法記念日","2026-05-04":"みどりの日",
  "2026-05-05":"こどもの日","2026-07-20":"海の日","2026-08-11":"山の日",
  "2026-09-21":"敬老の日","2026-09-23":"秋分の日","2026-10-12":"スポーツの日",
  "2026-11-03":"文化の日","2026-11-23":"勤労感謝の日",
};

const OFF_NAMES = ["公休","休","公休日","希望休","有休","特別休暇","代休","振替休日","欠勤","公募"];

function getShiftBadge(name: string | null) {
  if (!name) return null;
  if (["公休","休","公休日"].includes(name))
    return { bg: "bg-sky-500/20",     text: "text-sky-200",     border: "border border-sky-400/50" };
  if (["希望休","有休","特別休暇","代休","振替休日","公募"].includes(name))
    return { bg: "bg-purple-500/20",  text: "text-purple-200",  border: "border border-purple-400/50" };
  if (["欠勤"].includes(name))
    return { bg: "bg-red-500/25",     text: "text-red-200",     border: "border border-red-400/50" };
  if (name.includes("早番"))
    return { bg: "bg-emerald-500/20", text: "text-emerald-200", border: "border border-emerald-400/50" };
  if (name.includes("遅番"))
    return { bg: "bg-orange-500/20",  text: "text-orange-200",  border: "border border-orange-400/50" };
  return { bg: "bg-amber-400/20",     text: "text-amber-200",   border: "border border-amber-300/50" };
}

function fmtLogAt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ShiftsTabs({
  projectId, shifts, changeLogs = [], todayStr, initialYear, initialMonth, minMonth, maxMonth,
  holidayRequests, shiftRequests, shiftOpenings,
  holidayOpenDay = null, holidayDeadlineDay = null, holidayMaxDaysPerMonth = null, holidayWeekendLimit = null,
}: Props) {
  const [showHoliday, setShowHoliday] = useState(false);
  const [year, setYear]             = useState(initialYear);
  const [month, setMonth]           = useState(initialMonth);
  const [selectedDate, setSelected] = useState<string | null>(todayStr);
  const [memo, setMemo]             = useState("");


  const goMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear()); setMonth(d.getMonth() + 1);
  };

  // メモをlocalStorageから読み込み
  useEffect(() => {
    if (!selectedDate) return;
    const saved = localStorage.getItem(`shift-memo-${selectedDate}`) ?? "";
    setMemo(saved);
  }, [selectedDate]);

  const saveMemo = () => {
    if (!selectedDate) return;
    if (memo) localStorage.setItem(`shift-memo-${selectedDate}`, memo);
    else localStorage.removeItem(`shift-memo-${selectedDate}`);
  };

  // 選択日のシフト情報
  const shiftForDate = selectedDate ? shifts.find(s => s.shift_date === selectedDate) ?? null : null;
  const changeLogsForDate = selectedDate ? changeLogs.filter(l => l.shift_date === selectedDate) : [];

  const panelDateLabel = (() => {
    if (!selectedDate) return "";
    const [, mm, dd] = selectedDate.split("-");
    // UTC固定で曜日を算出（ローカルTZ依存だとSSR(UTC)とクライアント(JST)で曜日がずれ、
    // hydration mismatch=React #418 になる）
    const dow = new Date(selectedDate + "T00:00:00Z").getUTCDay();
    const holiday = JP_HOLIDAYS[selectedDate];
    return `${Number(mm)}月${Number(dd)}日（${WD_FULL[dow]}）${holiday ? `  ${holiday}` : ""}`;
  })();

  const badge = getShiftBadge(shiftForDate?.shift_name ?? null);
  const isOffDay = OFF_NAMES.includes(shiftForDate?.shift_name ?? "");

  // 選択日のシフト詳細（PC・モバイル共用）
  const renderShiftDetail = () => (
    <>
      {shiftForDate?.shift_name ? (
        <div>
          {badge && (
            <div className={`inline-block px-3 py-1.5 rounded-lg text-[13px] font-bold mb-2 ${badge.bg} ${badge.text} ${badge.border}`}>
              {shiftForDate.shift_name}
            </div>
          )}
          {shiftForDate.shift_start && !isOffDay ? (
            <p className="text-[28px] font-bold tabular-nums text-white leading-tight">
              {shiftForDate.shift_start.slice(0, 5)}
              <span className="text-white/30 text-xl font-light mx-2">〜</span>
              {shiftForDate.shift_end?.slice(0, 5) ?? "--:--"}
            </p>
          ) : isOffDay ? (
            <p className="text-[15px] text-white/60 mt-1">きょうは ゆっくり やすもう。</p>
          ) : null}
          {shiftForDate.note && (
            <p className="text-[12px] text-white/50 mt-2">{shiftForDate.note}</p>
          )}
        </div>
      ) : (
        <p className="text-[14px] text-white/50">＊「この日の クエストは まだ ない。」<BlinkCursor /></p>
      )}

      {/* 変更履歴 */}
      {changeLogsForDate.length > 0 && (
        <div className="rounded-lg border border-amber-300/40 bg-amber-300/5 p-3 space-y-1.5">
          <p className="text-[11px] font-semibold text-amber-300 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-300 inline-block" />へんこう りれき
          </p>
          {changeLogsForDate.map((l, i) => (
            <p key={i} className="text-[11px] text-white/70 leading-snug">
              <span className="font-semibold text-white">{l.changed_by_name}</span>
              {" "}
              {l.action === "delete" ? "さくじょ"
                : l.action === "create" ? "ついか"
                : `${l.before_shift_name ?? "なし"} → ${l.after_shift_name ?? "なし"}`}
              <span className="text-white/40 ml-1">{fmtLogAt(l.changed_at)}</span>
            </p>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className={`flex flex-col min-h-[100dvh] md:min-h-0 md:flex-1 ${dotGothic.className}`} style={{ background: RPG_PAGE_BG, backgroundAttachment: "fixed" }}>
      <style>{RPG_KEYFRAMES}</style>

      {/* ── ページヘッダー ── */}
      <div className="flex-shrink-0 px-4 md:px-8 pt-4 pb-3 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-[20px] md:text-[22px] font-bold text-white">
          <span className="text-amber-300 mr-1.5">★</span>クエストカレンダー
        </h1>
        <button
          type="button"
          onClick={() => setShowHoliday(true)}
          className="text-[13px] text-white border-2 border-white rounded-lg px-4 py-1.5 hover:bg-white/10 active:scale-95 transition"
        >
          <span className="text-amber-300 mr-1">▶</span>きゅうか きぼう
        </button>
      </div>

      {/* ── コンテンツ：カレンダー常時表示 ── */}
      {/* pb-36(=9rem): モバイルの固定ボトムナビ(最大pb-safe-xl=9rem)の高さ分だけダーク背景を確保し、
          下部にレイアウト由来の白帯(#f4f6fa)が見えないようにする */}
      <div className="flex-1 min-h-0 px-4 md:px-8 pb-36 md:pb-4 flex gap-4">

        {/* カレンダー（常時表示） */}
        <ShiftCalendar
          shifts={shifts} changeLogs={changeLogs}
          holidayRequests={holidayRequests}
          todayStr={todayStr} initialYear={initialYear} initialMonth={initialMonth}
          minMonth={minMonth} maxMonth={maxMonth}
          controlledYear={year} controlledMonth={month} onGoMonth={goMonth}
          selectedDate={selectedDate} onSelectDate={setSelected}
          className="flex-1 min-w-0 h-full"
        />

        {/* サイドパネル（PC） */}
        {selectedDate && (
          <div className="hidden md:block w-72 flex-shrink-0">
            <RpgWindow title="クエストの ないよう" className="h-full">
              <div className="flex flex-col h-full">
                {/* パネルヘッダー */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/20">
                  <p className="text-[13px] font-bold text-amber-300 leading-snug">{panelDateLabel}</p>
                  <button onClick={() => setSelected(null)}
                    className="text-white/50 hover:text-white transition-colors text-lg leading-none px-1">
                    ✕
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
                  {renderShiftDetail()}

                  {/* メモ */}
                  <div className="flex flex-col gap-2 flex-1">
                    <p className="text-[11px] font-semibold text-cyan-300">▼ メモ（じぶんようの おぼえがき）</p>
                    <textarea
                      value={memo}
                      onChange={e => setMemo(e.target.value)}
                      onBlur={saveMemo}
                      placeholder="メモを入力..."
                      className="flex-1 min-h-[100px] w-full px-3 py-2.5 rounded-lg border border-white/30 bg-[#02040f]/60 text-[13px] text-white placeholder-white/30 resize-none focus:outline-none focus:border-amber-300/70 transition"
                    />
                    <button
                      onClick={saveMemo}
                      className="w-full py-2 rounded-lg border-2 border-white text-white text-[13px] hover:bg-white/10 active:scale-[0.98] transition"
                    >
                      ▶ ほぞん
                    </button>
                  </div>
                </div>
              </div>
            </RpgWindow>
          </div>
        )}
      </div>

      {/* ── 希望休申請オーバーレイ ── */}
      {showHoliday && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 px-0 md:px-4"
          onClick={() => setShowHoliday(false)}>
          <div className="w-full md:max-w-2xl max-h-[90dvh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="rounded-lg border-2 border-white bg-[#000846] p-[3px] flex flex-col overflow-hidden max-h-[90dvh]">
              <div className="rounded-md border border-white/80 bg-[#000846] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/20 flex-shrink-0">
                  <div>
                    <h2 className="text-[15px] text-white">きゅうか きぼうを もうしでる</h2>
                    <p className="text-[11px] text-white/50 mt-0.5">やすみたい ひを えらんでね</p>
                  </div>
                  <button onClick={() => setShowHoliday(false)} className="text-white/50 hover:text-white text-lg px-2">✕</button>
                </div>
                <div className="overflow-y-auto flex-1">
                  <HolidayTab
                    projectId={projectId} holidayRequests={holidayRequests}
                    initialYear={year} initialMonth={month}
                    openDay={holidayOpenDay} deadlineDay={holidayDeadlineDay}
                    maxDaysPerMonth={holidayMaxDaysPerMonth} weekendLimit={holidayWeekendLimit}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* モバイル用ボトムシート */}
      {selectedDate && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={() => setSelected(null)}>
          <div className="w-full max-w-lg p-3" onClick={e => e.stopPropagation()}>
            <RpgWindow>
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/20">
                <p className="text-[14px] font-bold text-amber-300">{panelDateLabel}</p>
                <button onClick={() => setSelected(null)} className="text-white/50 hover:text-white text-lg px-1">✕</button>
              </div>
              <div className="px-5 py-4 space-y-3 max-h-[60dvh] overflow-y-auto">
                {renderShiftDetail()}
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] font-semibold text-cyan-300">▼ メモ</p>
                  <textarea value={memo} onChange={e => setMemo(e.target.value)} onBlur={saveMemo}
                    placeholder="メモを入力..." rows={3}
                    className="w-full px-3 py-2.5 rounded-lg border border-white/30 bg-[#02040f]/60 text-[13px] text-white placeholder-white/30 resize-none focus:outline-none focus:border-amber-300/70" />
                </div>
                <button onClick={() => { saveMemo(); setSelected(null); }}
                  className="w-full py-2.5 rounded-lg border-2 border-white text-white text-[13px] hover:bg-white/10 active:scale-[0.98] transition">
                  ▶ とじる
                </button>
              </div>
            </RpgWindow>
          </div>
        </div>
      )}
    </div>
  );
}
