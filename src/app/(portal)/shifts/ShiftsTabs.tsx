"use client";

import { useState, useEffect } from "react";
import ShiftCalendar, { type ShiftChangeLog } from "./ShiftCalendar";
import HolidayTab from "./HolidayTab";
import { ChevronRightIcon } from "@/components/icons";

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

function getShiftBadge(name: string | null) {
  if (!name) return null;
  if (["公休","休","公休日"].includes(name))
    return { bg: "bg-blue-100",    text: "text-blue-700",    border: "border border-blue-200" };
  if (["希望休","有休","特別休暇","代休","振替休日"].includes(name))
    return { bg: "bg-purple-100",  text: "text-purple-700",  border: "border border-purple-200" };
  if (["欠勤"].includes(name))
    return { bg: "bg-red-100",     text: "text-red-700",     border: "border border-red-200" };
  if (name.includes("早番"))
    return { bg: "bg-emerald-100", text: "text-emerald-800", border: "border border-emerald-200" };
  if (name.includes("遅番"))
    return { bg: "bg-orange-100",  text: "text-orange-800",  border: "border border-orange-200" };
  return { bg: "bg-sky-100",       text: "text-sky-800",     border: "border border-sky-200" };
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
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
    const dow = new Date(selectedDate + "T00:00:00+09:00").getDay();
    const holiday = JP_HOLIDAYS[selectedDate];
    return `${Number(mm)}月${Number(dd)}日（${WD_FULL[dow]}）${holiday ? `  ${holiday}` : ""}`;
  })();

  const badge = getShiftBadge(shiftForDate?.shift_name ?? null);

  return (
    <div className="flex-1 flex flex-col bg-[#f4f6fa] dark:bg-zinc-950 md:overflow-hidden min-h-0">
      {/* ── ページヘッダー ── */}
      <div className="flex-shrink-0 px-4 md:px-8 pt-4 pb-3 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-[20px] md:text-[22px] font-bold text-[#0d1b35] dark:text-white">
          勤務スケジュール
        </h1>
        <button
          type="button"
          onClick={() => setShowHoliday(true)}
          className="px-3.5 py-1.5 rounded-xl text-[13px] font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-colors shadow-sm"
        >
          希望休申請
        </button>
      </div>

      {/* ── コンテンツ：カレンダー常時表示 ── */}
      <div className="flex-1 min-h-0 px-4 md:px-8 pb-4 flex gap-4">

        <>
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
              <div className="hidden md:flex w-72 flex-shrink-0 flex-col bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">

                {/* パネルヘッダー */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
                  <p className="text-[13px] font-bold text-[#0d1b35] dark:text-white leading-snug">{panelDateLabel}</p>
                  <button onClick={() => setSelected(null)}
                    className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors">
                    <CloseIcon />
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">

                  {/* シフト情報 */}
                  {shiftForDate?.shift_name ? (
                    <div>
                      {badge && (
                        <div className={`inline-block px-3 py-1.5 rounded-xl text-[13px] font-bold mb-2 ${badge.bg} ${badge.text} ${badge.border}`}>
                          {shiftForDate.shift_name}
                        </div>
                      )}
                      {shiftForDate.shift_start && (
                        <p className="text-[28px] font-bold tabular-nums text-[#0d1b35] dark:text-white">
                          {shiftForDate.shift_start.slice(0, 5)}
                          <span className="text-zinc-300 dark:text-zinc-600 text-xl font-light mx-2">〜</span>
                          {shiftForDate.shift_end?.slice(0, 5) ?? "--:--"}
                        </p>
                      )}
                      {shiftForDate.note && (
                        <p className="text-[12px] text-zinc-500 mt-1">{shiftForDate.note}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[13px] text-zinc-400">シフト未登録</p>
                  )}

                  {/* 変更履歴 */}
                  {changeLogsForDate.length > 0 && (
                    <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl p-3 space-y-1.5">
                      <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />変更履歴
                      </p>
                      {changeLogsForDate.map((l, i) => (
                        <p key={i} className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug">
                          <span className="font-semibold">{l.changed_by_name}</span>
                          {" "}
                          {l.action === "delete" ? "削除"
                            : l.action === "create" ? "追加"
                            : `${l.before_shift_name ?? "なし"} → ${l.after_shift_name ?? "なし"}`}
                          <span className="text-zinc-400 ml-1">{fmtLogAt(l.changed_at)}</span>
                        </p>
                      ))}
                    </div>
                  )}

                  {/* メモ */}
                  <div className="flex flex-col gap-2 flex-1">
                    <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">メモ</p>
                    <textarea
                      value={memo}
                      onChange={e => setMemo(e.target.value)}
                      onBlur={saveMemo}
                      placeholder="メモを入力..."
                      className="flex-1 min-h-[100px] w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-[13px] text-zinc-700 dark:text-zinc-200 placeholder-zinc-300 dark:placeholder-zinc-600 resize-none focus:outline-none focus:ring-2 focus:ring-[#0d1b35]/20 dark:focus:ring-blue-500/20 transition"
                    />
                    <button
                      onClick={saveMemo}
                      className="w-full py-2 rounded-xl bg-[#0d1b35] text-white text-[13px] font-semibold hover:bg-[#162b50] transition-colors"
                    >
                      保存
                    </button>
                  </div>

                </div>
              </div>
            )}
          </>

      </div>

      {/* ── 希望休申請オーバーレイ ── */}
      {showHoliday && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50"
          onClick={() => setShowHoliday(false)}>
          <div
            className="w-full md:max-w-2xl md:mx-4 md:rounded-2xl rounded-t-2xl bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden max-h-[90dvh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0">
              <h2 className="text-[15px] font-bold text-[#0d1b35] dark:text-white">希望休申請</h2>
              <button onClick={() => setShowHoliday(false)} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400">
                <CloseIcon />
              </button>
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
      )}

      {/* モバイル用ボトムシート */}
      {selectedDate && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setSelected(null)}>
          <div className="w-full max-w-lg rounded-t-2xl bg-white dark:bg-zinc-900 shadow-xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
              <p className="text-[14px] font-bold text-[#0d1b35]">{panelDateLabel}</p>
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400">
                <CloseIcon />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {shiftForDate?.shift_name ? (
                <>
                  {badge && (
                    <span className={`inline-block px-3 py-1.5 rounded-xl text-[13px] font-bold ${badge.bg} ${badge.text}`}>
                      {shiftForDate.shift_name}
                    </span>
                  )}
                  {shiftForDate.shift_start && (
                    <p className="text-[32px] font-bold tabular-nums text-[#0d1b35]">
                      {shiftForDate.shift_start.slice(0, 5)}
                      <span className="text-zinc-300 text-2xl font-light mx-3">〜</span>
                      {shiftForDate.shift_end?.slice(0, 5) ?? "--:--"}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-zinc-400">シフト未登録</p>
              )}
              <textarea value={memo} onChange={e => setMemo(e.target.value)} onBlur={saveMemo}
                placeholder="メモを入力..." rows={3}
                className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-[13px] resize-none focus:outline-none" />
              <button onClick={() => { saveMemo(); setSelected(null); }}
                className="w-full py-2.5 rounded-xl bg-[#0d1b35] text-white text-[13px] font-semibold">
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

