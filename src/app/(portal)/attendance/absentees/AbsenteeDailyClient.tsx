"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { AbsenteeByDate } from "@/app/api/admin/work-records/absentees/route";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

function dowOf(ds: string): number {
  // 曜日はTZ非依存に算出
  return new Date(`${ds}T00:00:00Z`).getUTCDay();
}

function mdLabel(ds: string): string {
  const [, mm, dd] = ds.split("-");
  return `${parseInt(mm)}/${parseInt(dd)}`;
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

  const [y, m] = month ? month.split("-").map(Number) : [0, 0];
  const monthLabel = month ? `${y}年${m}月` : "";
  const totalDays = byDate.length;
  const totalAbsences = byDate.reduce((s, d) => s + d.items.length, 0);

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

      {/* サマリー */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 px-4 py-3">
          <p className="text-[11px] font-semibold text-zinc-400">欠勤のあった日数</p>
          <p className="text-2xl font-bold text-zinc-700 dark:text-zinc-200 tabular-nums">{totalDays}<span className="text-sm font-semibold ml-0.5">日</span></p>
        </div>
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 px-4 py-3">
          <p className="text-[11px] font-semibold text-red-400">延べ欠勤人数</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-300 tabular-nums">{totalAbsences}<span className="text-sm font-semibold ml-0.5">名</span></p>
        </div>
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
      {loading && <p className="text-sm text-zinc-400 text-center py-8">読み込み中…</p>}

      {!loading && totalDays === 0 && (
        <p className="text-sm text-zinc-400 text-center py-10">この月の欠勤者はいません</p>
      )}

      {/* 表 */}
      {!loading && totalDays > 0 && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-300">
                <th className="px-3 py-2.5 text-left font-semibold w-24 whitespace-nowrap">日付</th>
                <th className="px-3 py-2.5 text-center font-semibold w-14 whitespace-nowrap">人数</th>
                <th className="px-3 py-2.5 text-left font-semibold">欠勤者</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {byDate.map(d => {
                const dow = dowOf(d.date);
                return (
                  <tr key={d.date} className="align-top hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums font-semibold">
                      <span className={dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-zinc-700 dark:text-zinc-200"}>
                        {mdLabel(d.date)}（{WEEK[dow]}）
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums font-bold text-red-600 dark:text-red-300">{d.items.length}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {d.items.map(it => (
                          <span key={it.staffId} className="inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-100 dark:border-red-900/50">
                            <span className="font-semibold">{it.name}</span>
                            {it.reason && <span className="text-red-400 truncate max-w-[160px]">{it.reason}</span>}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
