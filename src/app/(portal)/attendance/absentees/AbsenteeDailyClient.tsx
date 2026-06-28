"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import type { AbsenteeByDate } from "@/app/api/admin/work-records/absentees/route";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

function dowOf(ds: string): number {
  // 曜日はTZ非依存に算出
  return new Date(`${ds}T00:00:00Z`).getUTCDay();
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function AbsenteeDailyClient({
  projectId,
  initialMonth,
}: {
  projectId: string;
  initialMonth: string | null;
}) {
  const [month, setMonth] = useState<string>(initialMonth ?? "");
  const [loading, setLoading] = useState(false);
  const [byDate, setByDate] = useState<AbsenteeByDate[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 月未指定なら当月（JST）をマウント後に設定（hydration mismatch回避）
  useEffect(() => {
    if (!initialMonth) {
      setMonth(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).slice(0, 7));
    }
  }, [initialMonth]);

  const load = useCallback(async (mon: string) => {
    if (!mon) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/work-records/absentees?projectId=${encodeURIComponent(projectId)}&month=${mon}`);
      if (!res.ok) throw new Error(`(${res.status})`);
      const data = await res.json() as { byDate: AbsenteeByDate[] };
      setByDate(data.byDate ?? []);
    } catch (e) {
      setError("読み込みに失敗しました " + (e instanceof Error ? e.message : ""));
      setByDate([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { if (month) load(month); }, [month, load]);

  // 日付→欠勤者
  const itemsByDate = useMemo(
    () => new Map(byDate.map(d => [d.date, d.items])),
    [byDate],
  );

  // 読み込みのたびに、欠勤のあった最終日を初期選択
  useEffect(() => {
    setSelectedDate(byDate.length ? byDate[byDate.length - 1].date : null);
  }, [byDate]);

  const [y, m] = month ? month.split("-").map(Number) : [0, 0];
  const monthLabel = month ? `${y}年${m}月` : "";

  // カレンダーのセル（先頭の空白＋1〜末日）
  const cells = useMemo<(string | null)[]>(() => {
    if (!month) return [];
    const daysInMonth = new Date(y, m, 0).getDate();
    const firstDow = dowOf(`${month}-01`);
    const arr: (string | null)[] = Array(firstDow).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      arr.push(`${month}-${String(d).padStart(2, "0")}`);
    }
    return arr;
  }, [month, y, m]);

  const totalDays = byDate.length;
  const totalAbsences = byDate.reduce((s, d) => s + d.items.length, 0);
  const selectedItems = selectedDate ? itemsByDate.get(selectedDate) ?? [] : [];

  return (
    <div className="pt-4">
      {/* 戻る */}
      <Link
        href={`/attendance/edit?tab=absentees${month ? `&month=${month}` : ""}`}
        className="inline-flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 mb-3">
        ← 欠勤者レポートに戻る
      </Link>

      <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100 mb-3">日毎の欠勤者</h2>

      {/* 月ナビ */}
      <div className="flex items-center justify-center gap-3 mb-4">
        <button type="button" onClick={() => setMonth(prev => shiftMonth(prev, -1))}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700">◀</button>
        <span className="text-lg font-bold text-zinc-800 dark:text-zinc-100 tabular-nums min-w-[7rem] text-center">{monthLabel}</span>
        <button type="button" onClick={() => setMonth(prev => shiftMonth(prev, 1))}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700">▶</button>
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {/* カレンダー */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 mb-4">
        {/* 曜日ヘッダー */}
        <div className="grid grid-cols-7 mb-1">
          {WEEK.map((w, i) => (
            <div key={w} className={`text-center text-[11px] font-bold py-1 ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-400"}`}>{w}</div>
          ))}
        </div>
        {/* 日セル */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((ds, idx) => {
            if (!ds) return <div key={`b${idx}`} />;
            const dow = dowOf(ds);
            const count = itemsByDate.get(ds)?.length ?? 0;
            const selected = ds === selectedDate;
            const dayNum = parseInt(ds.slice(8), 10);
            return (
              <button
                key={ds}
                type="button"
                onClick={() => setSelectedDate(ds)}
                className={`relative aspect-square rounded-xl flex flex-col items-center justify-center transition-colors
                  ${selected ? "ring-2 ring-zinc-800 dark:ring-zinc-100" : ""}
                  ${count > 0
                    ? "bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/40"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
              >
                <span className={`text-sm font-semibold tabular-nums ${dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-zinc-700 dark:text-zinc-200"}`}>{dayNum}</span>
                {count > 0 && (
                  <span className="mt-0.5 text-[10px] font-bold text-white bg-red-500 rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center tabular-nums leading-none">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* サマリー */}
      <div className="flex items-center justify-center gap-4 text-xs text-zinc-400 mb-4">
        <span>欠勤のあった日 <span className="font-bold text-zinc-600 dark:text-zinc-300 tabular-nums">{totalDays}</span> 日</span>
        <span>延べ <span className="font-bold text-red-500 tabular-nums">{totalAbsences}</span> 名</span>
      </div>

      {loading && <p className="text-sm text-zinc-400 text-center py-6">読み込み中…</p>}

      {!loading && totalDays === 0 && (
        <p className="text-sm text-zinc-400 text-center py-8">この月の欠勤者はいません</p>
      )}

      {/* 選択した日の欠勤者 */}
      {!loading && selectedDate && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-100 dark:border-zinc-800">
            <span className="text-base font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">
              {m}/{parseInt(selectedDate.slice(8), 10)}（{WEEK[dowOf(selectedDate)]}）
            </span>
            <span className="text-sm font-bold text-red-500 tabular-nums">欠勤 {selectedItems.length} 名</span>
          </div>
          {selectedItems.length === 0 ? (
            <p className="text-sm text-zinc-400 text-center py-8">この日の欠勤者はいません</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {selectedItems.map(it => (
                <li key={it.staffId} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-[11px] tabular-nums text-zinc-400 w-14 shrink-0">{it.accountNumber ?? "—"}</span>
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex-1 truncate">{it.name}</span>
                  {it.reason && <span className="text-xs text-red-400 truncate max-w-[45%]">{it.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
