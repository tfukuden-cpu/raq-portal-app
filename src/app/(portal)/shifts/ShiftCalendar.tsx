"use client";

import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

type ShiftData = {
  shift_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  note?: string | null;
};

export type ShiftChangeLog = {
  shift_date: string;
  action: string;
  before_shift_name: string | null;
  after_shift_name: string | null;
  changed_by_name: string;
  changed_at: string;
};

type Props = {
  shifts: ShiftData[];
  changeLogs?: ShiftChangeLog[];
  todayStr: string;
  initialYear: number;
  initialMonth: number;
  minMonth: string;
  maxMonth: string;
  controlledYear?: number;
  controlledMonth?: number;
  onGoMonth?: (delta: number) => void;
};

const WEEKDAY_SHORT = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAY_FULL  = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

// ── シフト色定義（管理ビューと統一） ─────────────────────────────
const SECTION_COLORS: Record<string, { early: string; late: string; def: string; text: string }> = {
  "SV":       { early: "bg-blue-100 dark:bg-blue-900/60",     late: "bg-blue-300 dark:bg-blue-700/80",     def: "bg-blue-200 dark:bg-blue-800/70",    text: "text-blue-900 dark:text-blue-100" },
  "査定":     { early: "bg-emerald-100 dark:bg-emerald-900/60", late: "bg-emerald-300 dark:bg-emerald-700/80", def: "bg-emerald-200 dark:bg-emerald-800/70", text: "text-emerald-900 dark:text-emerald-100" },
  "販売":     { early: "bg-orange-100 dark:bg-orange-900/60",  late: "bg-orange-300 dark:bg-orange-700/80",  def: "bg-orange-200 dark:bg-orange-800/70",   text: "text-orange-900 dark:text-orange-100" },
  "MOTA":     { early: "bg-red-100 dark:bg-red-900/60",       late: "bg-red-300 dark:bg-red-700/80",       def: "bg-red-200 dark:bg-red-800/70",         text: "text-red-900 dark:text-red-100" },
  "リメイク": { early: "bg-pink-100 dark:bg-pink-900/60",     late: "bg-pink-300 dark:bg-pink-700/80",     def: "bg-pink-200 dark:bg-pink-800/70",       text: "text-pink-900 dark:text-pink-100" },
  "ローン":   { early: "bg-violet-100 dark:bg-violet-900/60", late: "bg-violet-300 dark:bg-violet-700/80", def: "bg-violet-200 dark:bg-violet-800/70",   text: "text-violet-900 dark:text-violet-100" },
};
const FALLBACK = { early: "bg-sky-100 dark:bg-sky-900/60", late: "bg-sky-300 dark:bg-sky-700/80", def: "bg-sky-200 dark:bg-sky-800/70", text: "text-sky-900 dark:text-sky-100" };

type ShiftKind = "work" | "off" | "dayoff" | "none";

function classifyShift(name: string | null): ShiftKind {
  if (!name) return "none";
  if (name === "公休") return "off";
  if (name === "希望休" || name === "有休" || name === "特別休暇") return "dayoff";
  return "work";
}

function detectSection(name: string): string | null {
  for (const sec of ["SV", "MOTA", "リメイク", "ローン", "査定", "販売"]) {
    if (name.startsWith(sec)) return sec;
  }
  return null;
}

/** セル背景色と文字色を返す */
function getShiftColors(name: string | null): { bg: string; text: string } | null {
  const kind = classifyShift(name);
  if (kind === "none") return null;
  if (kind === "off")   return { bg: "bg-zinc-200 dark:bg-zinc-700",  text: "text-zinc-500 dark:text-zinc-400" };
  if (kind === "dayoff") return { bg: "bg-zinc-700 dark:bg-zinc-700", text: "text-white" };
  // work
  const sec = detectSection(name!);
  const cols = SECTION_COLORS[sec ?? ""] ?? FALLBACK;
  if (name!.includes("早番")) return { bg: cols.early, text: cols.text };
  if (name!.includes("遅番")) return { bg: cols.late,  text: cols.text };
  return { bg: cols.def, text: cols.text };
}

/** カレンダーセル内の略称（3文字以内） */
function shiftAbbr(name: string): string {
  if (name === "公休")    return "公休";
  if (name === "希望休")  return "希望休";
  if (name === "有休")    return "有休";
  if (name === "特別休暇") return "特休";
  if (name.includes("早番")) return name.replace("早番", "早").slice(0, 3);
  if (name.includes("遅番")) return name.replace("遅番", "遅").slice(0, 3);
  return name.slice(0, 3);
}

function isHoliday(name: string | null) {
  return name === "公休" || name === "休" || name === "公休日";
}

function fmtLogAt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export default function ShiftCalendar({
  shifts, changeLogs = [], todayStr, initialYear, initialMonth, minMonth, maxMonth,
  controlledYear, controlledMonth, onGoMonth,
}: Props) {
  const [internalYear, setInternalYear]   = useState(initialYear);
  const [internalMonth, setInternalMonth] = useState(initialMonth);
  const [selected, setSelected]           = useState<string | null>(todayStr);

  const isControlled = controlledYear !== undefined;
  const year  = isControlled ? controlledYear!  : internalYear;
  const month = isControlled ? controlledMonth! : internalMonth;

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const canPrev  = monthStr > minMonth;
  const canNext  = monthStr < maxMonth;

  const goMonth = (delta: number) => {
    if (isControlled && onGoMonth) {
      onGoMonth(delta);
    } else {
      const d = new Date(year, month - 1 + delta, 1);
      setInternalYear(d.getFullYear());
      setInternalMonth(d.getMonth() + 1);
    }
    setSelected(null);
  };

  const shiftMap = new Map<string, ShiftData>();
  for (const s of shifts) {
    if (s.shift_date.startsWith(monthStr)) shiftMap.set(s.shift_date, s);
  }

  const logMap = new Map<string, ShiftChangeLog[]>();
  for (const l of changeLogs) {
    const arr = logMap.get(l.shift_date) ?? [];
    arr.push(l);
    logMap.set(l.shift_date, arr);
  }

  const firstDow    = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const trailing    = 42 - firstDow - daysInMonth;

  let workCount = 0, holidayCount = 0;
  for (let i = 1; i <= daysInMonth; i++) {
    const s = shiftMap.get(`${monthStr}-${String(i).padStart(2, "0")}`);
    if (!s) continue;
    isHoliday(s.shift_name) ? holidayCount++ : workCount++;
  }

  const selShift   = selected ? (shiftMap.get(selected) ?? null) : null;
  const selDow     = selected ? new Date(selected + "T00:00:00+09:00").getDay() : null;
  const [, selMM, selDD] = selected?.split("-") ?? [];
  const selLabel   = selected
    ? `${Number(selMM)}月${Number(selDD)}日（${WEEKDAY_FULL[selDow!]}）`
    : null;
  const selKind    = classifyShift(selShift?.shift_name ?? null);
  const selColors  = getShiftColors(selShift?.shift_name ?? null);

  return (
    <div className="flex flex-col gap-2 h-full">

      {/* 月ナビ（非制御モード） */}
      {!isControlled && (
        <div className="flex items-center justify-between flex-shrink-0">
          <button type="button" onClick={() => goMonth(-1)} disabled={!canPrev}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors">
            <ChevronLeftIcon className="w-4 h-4 text-zinc-500" />
          </button>
          <div className="text-center">
            <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">{year}年 {month}月</p>
            {(workCount > 0 || holidayCount > 0) && (
              <p className="text-[10px] text-zinc-400">出勤 {workCount}日　公休 {holidayCount}日</p>
            )}
          </div>
          <button type="button" onClick={() => goMonth(1)} disabled={!canNext}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors">
            <ChevronRightIcon className="w-4 h-4 text-zinc-500" />
          </button>
        </div>
      )}
      {/* 制御モード：出勤/公休カウント */}
      {isControlled && (workCount > 0 || holidayCount > 0) && (
        <p className="text-[11px] text-zinc-400 text-center flex-shrink-0">
          出勤 {workCount}日　公休 {holidayCount}日
        </p>
      )}

      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7 flex-shrink-0">
        {WEEKDAY_SHORT.map((w, i) => (
          <div key={w} className={cx(
            "text-center text-[11px] font-semibold py-0.5",
            i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-400",
          )}>{w}</div>
        ))}
      </div>

      {/* カレンダーグリッド（常に6行 = 42マス） */}
      <div
        className="flex-1 min-h-0 grid grid-cols-7 gap-0.5"
        style={{ gridAutoRows: "1fr" }}
      >
        {Array.from({ length: firstDow }).map((_, i) => <div key={`pre${i}`} />)}

        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
          const ds      = `${monthStr}-${String(d).padStart(2, "0")}`;
          const s       = shiftMap.get(ds);
          const isToday = ds === todayStr;
          const isSel   = ds === selected;
          const dow     = new Date(year, month - 1, d).getDay();
          const kind    = classifyShift(s?.shift_name ?? null);
          const colors  = getShiftColors(s?.shift_name ?? null);
          const hasLog  = logMap.has(ds);

          // セル背景
          const cellBg = isSel
            ? kind === "dayoff" ? "bg-zinc-800 dark:bg-zinc-700 ring-2 ring-inset ring-zinc-500"
            : kind === "off"    ? "bg-zinc-400 dark:bg-zinc-500 ring-2 ring-inset ring-zinc-500"
            : colors            ? cx(colors.bg, "ring-2 ring-inset ring-zinc-400 dark:ring-zinc-500")
                                : "bg-zinc-200 dark:bg-zinc-700 ring-2 ring-inset ring-zinc-400"
            : kind === "dayoff" ? "bg-zinc-700 dark:bg-zinc-700 hover:bg-zinc-600"
            : kind === "off"    ? "bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600"
            : colors            ? cx(colors.bg, "hover:brightness-95")
                                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60";

          // 日付数字の色
          const numCls = isToday && !isSel
            ? "bg-blue-600 text-white rounded-full w-6 h-6"
            : isSel
            ? kind === "dayoff" || kind === "off" ? "text-white font-bold"
            : colors ? cx(colors.text, "font-bold") : "text-zinc-900 dark:text-zinc-50 font-bold"
            : dow === 0 ? "text-red-500 dark:text-red-400"
            : dow === 6 ? "text-blue-500 dark:text-blue-400"
            : kind === "dayoff" ? "text-white font-semibold"
            : colors ? cx(colors.text, "font-semibold") : "text-zinc-700 dark:text-zinc-300";

          // シフト名テキストの色
          const nameCls =
            kind === "dayoff" ? "text-zinc-300"
            : isSel ? (colors ? cx(colors.text, "opacity-80") : "text-zinc-600 dark:text-zinc-400")
            : colors ? colors.text : "text-zinc-500";

          return (
            <button
              key={ds}
              type="button"
              onClick={() => setSelected(isSel ? null : ds)}
              className={cx(
                "flex flex-col items-center justify-center gap-0 rounded-xl transition-colors relative overflow-hidden",
                cellBg,
              )}
            >
              {/* 日付数字 */}
              <span className={cx("text-sm flex items-center justify-center leading-none", numCls)}>
                {d}
              </span>

              {/* シフト名 */}
              {s?.shift_name && (
                <span className={cx(
                  "text-[8px] leading-none font-bold mt-0.5 px-0.5 text-center",
                  nameCls,
                )}>
                  {shiftAbbr(s.shift_name)}
                </span>
              )}

              {/* 変更ログインジケーター */}
              {hasLog && !isSel && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
            </button>
          );
        })}

        {Array.from({ length: trailing }).map((_, i) => <div key={`post${i}`} />)}
      </div>

      {/* ── 選択日の詳細パネル ── */}
      <div className={cx(
        "flex-shrink-0 rounded-2xl px-4 py-3 min-h-[80px] flex flex-col justify-center",
        selColors ? cx(selColors.bg, "bg-opacity-30") : "bg-zinc-50 dark:bg-zinc-900",
      )}>
        {!selected && (
          <p className="text-xs text-zinc-400 text-center">日付を選択してください</p>
        )}

        {selected && !selShift && (
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{selLabel}</p>
            <span className="text-xs text-zinc-400">シフト未登録</span>
          </div>
        )}

        {selected && selShift && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{selLabel}</p>
              {/* シフト名バッジ */}
              <span className={cx(
                "text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0",
                selKind === "dayoff" ? "bg-zinc-700 text-white"
                : selKind === "off"  ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-300"
                : selColors          ? cx(selColors.bg, selColors.text)
                                     : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300",
              )}>
                {selShift.shift_name}
              </span>
            </div>

            {/* 時刻（出勤のみ） */}
            {selKind === "work" && (selShift.shift_start || selShift.shift_end) && (
              <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50 leading-tight">
                {selShift.shift_start?.slice(0, 5) ?? "--:--"}
                <span className="text-zinc-300 dark:text-zinc-600 text-lg font-light mx-2">〜</span>
                {selShift.shift_end?.slice(0, 5) ?? "--:--"}
              </p>
            )}

            {selShift.note && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{selShift.note}</p>
            )}
          </div>
        )}

        {/* 変更履歴 */}
        {selected && (logMap.get(selected) ?? []).length > 0 && (
          <div className={cx(
            "pt-1 border-t border-zinc-200 dark:border-zinc-700",
            selShift ? "mt-1.5" : "mt-0",
          )}>
            <p className="text-[10px] text-zinc-400 mb-1 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
              変更履歴
            </p>
            <div className="space-y-0.5 max-h-24 overflow-y-auto">
              {(logMap.get(selected) ?? []).map((l, i) => (
                <p key={i} className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-snug">
                  <span className="font-semibold text-zinc-600 dark:text-zinc-300">{l.changed_by_name}</span>
                  {" が "}
                  {l.action === "delete" ? "削除"
                    : l.action === "create" ? "追加"
                    : `${l.before_shift_name ?? "（なし）"} → ${l.after_shift_name ?? "（なし）"}`}
                  <span className="ml-1 text-zinc-400">{fmtLogAt(l.changed_at)}</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
