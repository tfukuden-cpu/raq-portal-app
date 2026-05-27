"use client";

import { useState, useTransition } from "react";
import {
  addHolidayRequestForStaffAction,
  removeHolidayRequestForStaffAction,
  type HolidayRequestEntry,
} from "@/app/(portal)/admin/[projectId]/settings/holiday-request-actions";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

export type { HolidayRequestEntry };

interface Props {
  staffId: string;
  projectId: string;
  initialEntries: HolidayRequestEntry[];
  onDatesAdded?: (dates: string[]) => void;
}

const DOW_JP = ["日", "月", "火", "水", "木", "金", "土"];

const STATUS_CONFIG: Record<string, { label: string; chip: string }> = {
  pending:   { label: "申請中", chip: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  approved:  { label: "承認",   chip: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" },
  rejected:  { label: "却下",   chip: "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800" },
  cancelled: { label: "取消",   chip: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700" },
};

function toYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${y}年${parseInt(m)}月`;
}

function nowJST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export default function HolidayRequestSection({ staffId, projectId, initialEntries, onDatesAdded }: Props) {
  const now     = new Date();
  const todayStr = nowJST();
  const curMon  = todayStr.slice(0, 7);

  const [entries, setEntries]     = useState<HolidayRequestEntry[]>(initialEntries);
  const [panelOpen, setPanelOpen] = useState(false);

  // 月別折りたたみ（デフォルト：過去月は折りたたみ・今月以降は展開）
  const initCollapsed = () => {
    const s = new Set<string>();
    const keys = [...new Set(initialEntries.map(e => monthKey(e.request_date)))];
    for (const k of keys) { if (k < curMon) s.add(k); }
    return s;
  };
  const [collapsed, setCollapsed] = useState<Set<string>>(initCollapsed);

  // カレンダー state
  const [viewYear, setViewYear]   = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selected, setSelected]   = useState<Set<string>>(new Set());

  const [error, setError]         = useState<string | null>(null);
  const [isPending, startTrans]   = useTransition();

  const savedSet = new Set(entries.map(e => e.request_date));

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  function toggleDay(day: number) {
    const dateStr = toYMD(viewYear, viewMonth, day);
    if (savedSet.has(dateStr)) return;
    setSelected(prev => {
      const next = new Set(prev);
      next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr);
      return next;
    });
  }

  function toggleCollapse(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function handleRemove(id: string) {
    setError(null);
    startTrans(async () => {
      const r = await removeHolidayRequestForStaffAction(id);
      if (r.success) {
        setEntries(prev => prev.filter(e => e.id !== id));
      } else {
        setError(r.message ?? "削除できませんでした");
      }
    });
  }

  function handleSave() {
    if (selected.size === 0) return;
    setError(null);
    startTrans(async () => {
      const dates = [...selected].sort();
      const newEntries: HolidayRequestEntry[] = [];
      for (const dateStr of dates) {
        if (savedSet.has(dateStr)) continue;
        const r = await addHolidayRequestForStaffAction(staffId, projectId, dateStr);
        if (r.success && r.id) {
          newEntries.push({ id: r.id, request_date: dateStr, status: "pending", note: null });
        } else if (r.message && r.message !== "同じ日付が既に登録されています") {
          setError(r.message);
          return;
        }
      }
      if (newEntries.length > 0) {
        setEntries(prev =>
          [...prev, ...newEntries].sort((a, b) => a.request_date.localeCompare(b.request_date))
        );
        onDatesAdded?.(newEntries.map(e => e.request_date));
      }
      setSelected(new Set());
      setPanelOpen(false);
    });
  }

  // 月別グループ化
  const monthKeys = [...new Set(entries.map(e => monthKey(e.request_date)))].sort();
  const grouped = monthKeys.map(key => ({
    key,
    label: monthLabel(key),
    entries: entries.filter(e => monthKey(e.request_date) === key),
  }));

  // カレンダー構築
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const lastDay  = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: lastDay }, (_, i) => i + 1),
  ];

  return (
    <div className="space-y-2">
      {/* 月別グループ一覧 */}
      {grouped.length > 0 && (
        <div className="space-y-1.5">
          {grouped.map(g => {
            const isOpen = !collapsed.has(g.key);
            return (
              <div key={g.key} className="rounded-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                {/* グループヘッダー（折りたたみトグル） */}
                <button
                  type="button"
                  onClick={() => toggleCollapse(g.key)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{g.label}</span>
                    <span className="text-[10px] text-zinc-400 tabular-nums">{g.entries.length}日</span>
                  </div>
                  <span className={`text-[10px] text-zinc-400 transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
                </button>
                {/* エントリ一覧 */}
                {isOpen && (
                  <div className="px-3 py-2 flex flex-wrap gap-1">
                    {g.entries.map(e => {
                      const [, m, d] = e.request_date.split("-");
                      const sc = STATUS_CONFIG[e.status] ?? STATUS_CONFIG["pending"];
                      return (
                        <span
                          key={e.id}
                          className={`inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-full text-[11px] font-medium border ${sc.chip}`}
                        >
                          {parseInt(m)}/{parseInt(d)}
                          <span className="opacity-60 text-[9px] mx-0.5">{sc.label}</span>
                          <button
                            type="button"
                            onClick={() => handleRemove(e.id)}
                            disabled={isPending}
                            className="w-3.5 h-3.5 flex items-center justify-center rounded-full opacity-60 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-colors disabled:opacity-30 text-[10px] leading-none"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 希望休を設定ボタン */}
      {!panelOpen && (
        <button
          type="button"
          onClick={() => { setPanelOpen(true); setSelected(new Set()); setError(null); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          希望休を設定
        </button>
      )}

      {/* 展開パネル（カレンダーのみ） */}
      {panelOpen && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/10 p-3 space-y-3">
          {/* 月ナビゲーション */}
          <div className="flex items-center justify-between">
            <button type="button" onClick={prevMonth} disabled={isPending}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors disabled:opacity-40">
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums select-none">
              {viewYear}年{viewMonth + 1}月
            </span>
            <button type="button" onClick={nextMonth} disabled={isPending}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors disabled:opacity-40">
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>

          {/* 選択中件数 */}
          {selected.size > 0 && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold text-center tabular-nums">
              {selected.size}日選択中
            </p>
          )}

          {/* 曜日ヘッダー */}
          <div className="grid grid-cols-7">
            {DOW_JP.map((w, i) => (
              <div key={w} className={`text-center text-[10px] font-semibold pb-1 select-none ${
                i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-400 dark:text-zinc-500"
              }`}>{w}</div>
            ))}
          </div>

          {/* 日付グリッド */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, idx) => {
              if (!day) return <div key={`e-${idx}`} />;
              const dateStr  = toYMD(viewYear, viewMonth, day);
              const isSaved  = savedSet.has(dateStr);
              const isPicked = selected.has(dateStr);
              const dowIdx   = (firstDow + day - 1) % 7;
              const isSun    = dowIdx === 0;
              const isSat    = dowIdx === 6;

              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => toggleDay(day)}
                  disabled={isPending || isSaved}
                  title={isSaved ? "登録済み" : dateStr}
                  className={[
                    "mx-auto flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-all tabular-nums",
                    isSaved
                      ? "bg-emerald-200 dark:bg-emerald-800 text-emerald-500 dark:text-emerald-300 cursor-default opacity-60"
                      : isPicked
                      ? "bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-400/30"
                      : isSun
                      ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                      : isSat
                      ? "text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer"
                      : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer",
                    isPending ? "opacity-50 cursor-wait" : "",
                  ].join(" ")}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {error && <p className="text-[11px] text-red-500">{error}</p>}
          {isPending && <p className="text-[11px] text-zinc-400 animate-pulse">処理中…</p>}

          {/* アクションボタン */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setPanelOpen(false); setSelected(new Set()); setError(null); }}
              disabled={isPending}
              className="flex-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || selected.size === 0}
              className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-40 hover:bg-emerald-700 transition-colors"
            >
              {isPending ? "保存中…" : `${selected.size}日を追加`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
