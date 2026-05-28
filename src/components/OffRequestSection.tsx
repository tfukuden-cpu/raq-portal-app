"use client";

import { useState, useTransition } from "react";
import {
  addOffRequestForStaffAction,
  removeOffRequestForStaffAction,
} from "@/app/(portal)/admin/[projectId]/settings/off-request-actions";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

export type OffRequestEntry = {
  id: string;
  request_date: string;
  priority: string;
};

const OFF_PRIORITY_LABEL: Record<string, string> = {
  "第一希望休": "希休1",
  "第二希望休": "希休2",
  "第三希望休": "希休3",
  "第四希望休": "希休4",
  "冠婚葬祭":   "冠婚",
};

const PRIORITY_TYPES = [
  { value: "第一希望休", label: "希休1" },
  { value: "第二希望休", label: "希休2" },
  { value: "第三希望休", label: "希休3" },
  { value: "第四希望休", label: "希休4" },
] as const;

const DOW_JP = ["日", "月", "火", "水", "木", "金", "土"];

function toYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface Props {
  staffId: string;
  projectId: string;
  initialEntries: OffRequestEntry[];
  onEntryAdded?: (entries: { date: string; priority: string }[]) => void;
  onEntryRemoved?: (date: string) => void;
}

export default function OffRequestSection({
  staffId, projectId, initialEntries, onEntryAdded, onEntryRemoved,
}: Props) {
  const now = new Date();
  const [entries, setEntries]     = useState<OffRequestEntry[]>(initialEntries);
  const [panelOpen, setPanelOpen] = useState(false);

  const [viewYear, setViewYear]   = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [priority, setPriority]   = useState<string>("第一希望休");

  const [error, setError]         = useState<string | null>(null);
  const [isPending, startTrans]   = useTransition();

  const savedMap = new Map(entries.map(e => [e.request_date, e]));

  const thisMonth = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).slice(0, 7);

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
    if (savedMap.has(dateStr)) return;
    setSelected(prev => {
      const next = new Set(prev);
      next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr);
      return next;
    });
  }

  function handleRemove(entry: OffRequestEntry) {
    setError(null);
    startTrans(async () => {
      const r = await removeOffRequestForStaffAction(entry.id);
      if (r.success) {
        setEntries(prev => prev.filter(e => e.id !== entry.id));
        onEntryRemoved?.(entry.request_date);
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
      const newEntries: OffRequestEntry[] = [];
      for (const dateStr of dates) {
        if (savedMap.has(dateStr)) continue;
        const r = await addOffRequestForStaffAction(projectId, staffId, dateStr, priority);
        if (r.success && r.id) {
          newEntries.push({ id: r.id, request_date: dateStr, priority });
        } else if (r.message && r.message !== "同じ日付が既に登録されています") {
          setError(r.message);
          return;
        }
      }
      if (newEntries.length > 0) {
        setEntries(prev =>
          [...prev, ...newEntries].sort((a, b) => a.request_date.localeCompare(b.request_date))
        );
        onEntryAdded?.(newEntries.map(e => ({ date: e.request_date, priority: e.priority })));
      }
      setSelected(new Set());
      setPanelOpen(false);
    });
  }

  // カレンダー構築
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const lastDay  = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: lastDay }, (_, i) => i + 1),
  ];

  // 当月分のみ表示
  const monthKeys = entries.some(e => e.request_date.startsWith(thisMonth)) ? [thisMonth] : [];

  return (
    <div className="space-y-2">
      {/* 登録済み一覧 */}
      {monthKeys.length > 0 && (
        <div className="space-y-2">
          {monthKeys.map(ym => {
            const [y, m] = ym.split("-");
            const monthEntries = entries.filter(e => e.request_date.startsWith(ym));
            return (
              <div key={ym}>
                <p className="text-[10px] text-zinc-400 mb-1">
                  {y}年{parseInt(m)}月
                  <span className="tabular-nums ml-1">({monthEntries.length}日)</span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {monthEntries.map(e => {
                    const [, , d] = e.request_date.split("-");
                    const lbl = OFF_PRIORITY_LABEL[e.priority] ?? e.priority.slice(0, 3);
                    return (
                      <span
                        key={e.id}
                        className="inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-full bg-zinc-700 dark:bg-zinc-600 text-white text-[11px] font-semibold"
                      >
                        {parseInt(d)}日
                        <span className="text-[9px] opacity-70 mx-0.5">{lbl}</span>
                        <button
                          type="button"
                          onClick={() => handleRemove(e)}
                          disabled={isPending}
                          className="w-3.5 h-3.5 flex items-center justify-center rounded-full text-zinc-300 hover:bg-zinc-500 hover:text-white transition-colors disabled:opacity-40 text-[10px] leading-none"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 希望休を追加ボタン */}
      {!panelOpen && (
        <button
          type="button"
          onClick={() => { setPanelOpen(true); setSelected(new Set()); setError(null); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          希望休を追加
        </button>
      )}

      {/* 展開パネル */}
      {panelOpen && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/20 p-3 space-y-3">
          {/* 優先度 */}
          <div>
            <label className="text-[10px] text-zinc-500 font-semibold block mb-1">優先度</label>
            <div className="flex gap-1.5">
              {PRIORITY_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setPriority(t.value)}
                  className={[
                    "px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors",
                    priority === t.value
                      ? "bg-zinc-700 text-white border-zinc-700"
                      : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* カレンダー */}
          <div>
            <label className="text-[10px] text-zinc-500 font-semibold block mb-1">
              日付を選択（複数可）
              {selected.size > 0 && (
                <span className="ml-1.5 text-zinc-600 dark:text-zinc-400">{selected.size}日選択中</span>
              )}
            </label>

            <div className="flex items-center justify-between mb-2">
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

            <div className="grid grid-cols-7">
              {DOW_JP.map((w, i) => (
                <div key={w} className={`text-center text-[10px] font-semibold pb-1 select-none ${
                  i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-400 dark:text-zinc-500"
                }`}>{w}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-0.5">
              {cells.map((day, idx) => {
                if (!day) return <div key={`e-${idx}`} />;
                const dateStr  = toYMD(viewYear, viewMonth, day);
                const isSaved  = savedMap.has(dateStr);
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
                    title={isSaved ? `登録済み（${OFF_PRIORITY_LABEL[savedMap.get(dateStr)?.priority ?? ""] ?? ""}）` : dateStr}
                    className={[
                      "mx-auto flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-all tabular-nums",
                      isSaved
                        ? "bg-zinc-700 text-white cursor-default opacity-60"
                        : isPicked
                        ? "bg-zinc-700 text-white shadow-sm ring-2 ring-zinc-400/30"
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
          </div>

          {error && <p className="text-[11px] text-red-500">{error}</p>}
          {isPending && <p className="text-[11px] text-zinc-400 animate-pulse">処理中…</p>}

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
              className="flex-1 py-1.5 rounded-lg bg-zinc-700 text-white text-xs font-semibold disabled:opacity-40 hover:bg-zinc-800 transition-colors"
            >
              {isPending ? "保存中…" : `保存（${selected.size}日）`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
