"use client";

import { useState, useTransition } from "react";
import {
  addTrainingDateAction,
  removeTrainingDateAction,
  type TrainingEntry,
} from "@/app/(portal)/admin/[projectId]/settings/training-actions";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

export type { TrainingEntry };
// backward compat alias
export type TrainingDate = TrainingEntry;

interface Props {
  staffId: string;
  initialDates: TrainingEntry[];
}

const DOW_JP = ["日", "月", "火", "水", "木", "金", "土"];

const TRAINING_TYPES = [
  { value: "導入研修", label: "導入研修" },
  { value: "研修",     label: "研修" },
  { value: "案件研修", label: "案件研修" },
] as const;

function toYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fmtLabel(entry: TrainingEntry): string {
  const [, m, d] = entry.training_date.split("-");
  const base = `${parseInt(m)}/${parseInt(d)}`;
  const name = entry.training_name ? ` ${entry.training_name}` : "";
  return base + name;
}

function fmtTime(t: string | null) {
  if (!t) return "";
  return t.slice(0, 5); // "HH:MM"
}

export default function TrainingSection({ staffId, initialDates }: Props) {
  const now = new Date();
  const [entries, setEntries]       = useState<TrainingEntry[]>(initialDates);
  const [panelOpen, setPanelOpen]   = useState(false);

  // picker state
  const [viewYear, setViewYear]     = useState(now.getFullYear());
  const [viewMonth, setViewMonth]   = useState(now.getMonth());
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [trainingName, setTrainingName] = useState("導入研修");
  const [customName, setCustomName] = useState("");
  const [startTime, setStartTime]   = useState("");
  const [endTime, setEndTime]       = useState("");

  const [error, setError]           = useState<string | null>(null);
  const [isPending, startTrans]     = useTransition();

  // date string → entry (for quick lookup of already-saved dates)
  const savedMap = new Map(entries.map(e => [e.training_date, e]));

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
    if (savedMap.has(dateStr)) return; // already saved — remove via chip
    setSelected(prev => {
      const next = new Set(prev);
      next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr);
      return next;
    });
  }

  function handleRemove(id: string) {
    setError(null);
    startTrans(async () => {
      const r = await removeTrainingDateAction(id);
      if (r.success) {
        setEntries(prev => prev.filter(e => e.id !== id));
      } else {
        setError(r.message ?? "削除できませんでした");
      }
    });
  }

  function handleSave() {
    if (selected.size === 0) return;
    const finalName = trainingName === "__custom__" ? customName.trim() || null : trainingName || null;
    const st = startTime || null;
    const et = endTime   || null;
    setError(null);

    startTrans(async () => {
      const dates = [...selected].sort();
      const newEntries: TrainingEntry[] = [];
      for (const dateStr of dates) {
        if (savedMap.has(dateStr)) continue;
        const r = await addTrainingDateAction(staffId, dateStr, finalName, st, et);
        if (r.success && r.id) {
          newEntries.push({ id: r.id, training_date: dateStr, training_name: finalName, start_time: st, end_time: et });
        } else if (r.message && r.message !== "同じ日付が既に登録されています") {
          setError(r.message);
          return;
        }
      }
      if (newEntries.length > 0) {
        setEntries(prev =>
          [...prev, ...newEntries].sort((a, b) => a.training_date.localeCompare(b.training_date))
        );
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

  // group entries by training_name for display
  type Group = { name: string | null; startTime: string | null; endTime: string | null; entries: TrainingEntry[] };
  const groups: Group[] = [];
  for (const e of entries) {
    const g = groups.find(g => g.name === e.training_name && g.startTime === e.start_time && g.endTime === e.end_time);
    if (g) { g.entries.push(e); }
    else { groups.push({ name: e.training_name, startTime: e.start_time, endTime: e.end_time, entries: [e] }); }
  }

  return (
    <div className="space-y-2">
      {/* 登録済み一覧 */}
      {groups.length > 0 && (
        <div className="space-y-2">
          {groups.map((g, gi) => (
            <div key={gi} className="space-y-1">
              <div className="flex items-center gap-1.5">
                {g.name && (
                  <span className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">{g.name}</span>
                )}
                {(g.startTime || g.endTime) && (
                  <span className="text-[10px] text-zinc-400 tabular-nums">
                    {fmtTime(g.startTime)}{g.startTime && g.endTime ? "〜" : ""}{fmtTime(g.endTime)}
                  </span>
                )}
                <span className="text-[10px] text-zinc-400">（{g.entries.length}日）</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {g.entries.map(e => {
                  const [, m, d] = e.training_date.split("-");
                  return (
                    <span
                      key={e.id}
                      className="inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-[11px] font-medium border border-blue-200 dark:border-blue-800"
                    >
                      {parseInt(m)}/{parseInt(d)}
                      <button
                        type="button"
                        onClick={() => handleRemove(e.id)}
                        disabled={isPending}
                        className="w-3.5 h-3.5 flex items-center justify-center rounded-full text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 hover:text-blue-700 transition-colors disabled:opacity-40 text-[10px] leading-none"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 研修日を設定ボタン */}
      {!panelOpen && (
        <button
          type="button"
          onClick={() => { setPanelOpen(true); setSelected(new Set()); setError(null); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          研修日を設定
        </button>
      )}

      {/* 展開パネル */}
      {panelOpen && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/10 p-3 space-y-3">
          {/* 研修タイプ */}
          <div>
            <label className="text-[10px] text-zinc-500 font-semibold block mb-1">研修タイプ</label>
            <div className="flex flex-wrap gap-1.5">
              {TRAINING_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTrainingName(t.value)}
                  className={[
                    "px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors",
                    trainingName === t.value
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-blue-300",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setTrainingName("__custom__")}
                className={[
                  "px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors",
                  trainingName === "__custom__"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-blue-300",
                ].join(" ")}
              >
                カスタム
              </button>
            </div>
            {trainingName === "__custom__" && (
              <input
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="研修名を入力"
                className="mt-1.5 w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            )}
          </div>

          {/* 時間設定 */}
          <div>
            <label className="text-[10px] text-zinc-500 font-semibold block mb-1">時間（任意）</label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <span className="text-xs text-zinc-400">〜</span>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          {/* カレンダー */}
          <div>
            <label className="text-[10px] text-zinc-500 font-semibold block mb-1">
              日付を選択（複数可）
              {selected.size > 0 && (
                <span className="ml-1.5 text-blue-600">{selected.size}日選択中</span>
              )}
            </label>

            {/* 月ナビゲーション */}
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
                    title={isSaved ? "登録済み" : dateStr}
                    className={[
                      "mx-auto flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-all tabular-nums",
                      isSaved
                        ? "bg-blue-200 dark:bg-blue-800 text-blue-500 dark:text-blue-300 cursor-default opacity-60"
                        : isPicked
                        ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-400/30"
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
              className="flex-1 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-40 hover:bg-blue-700 transition-colors"
            >
              {isPending ? "保存中…" : `${selected.size}日を追加`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
