"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { AbsenteeByDate } from "@/app/api/admin/work-records/absentees/route";
import { toggleAbsenceRecoveryAction } from "./actions";

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

function dowColor(dow: number): string {
  return dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-zinc-700 dark:text-zinc-200";
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
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  // 名前タップで補填回収 済/未 を切替（楽観的更新）
  const toggleRecovery = useCallback(async (staffId: string, date: string) => {
    const key = `${staffId}_${date}`;
    if (togglingKey) return;
    setTogglingKey(key);
    setByDate(prev => prev.map(d => d.date !== date ? d : {
      ...d,
      items: d.items.map(it => it.staffId === staffId ? { ...it, recovered: !it.recovered } : it),
    }));
    const res = await toggleAbsenceRecoveryAction(projectId, staffId, date);
    if (!res.success) {
      // ロールバック
      setByDate(prev => prev.map(d => d.date !== date ? d : {
        ...d,
        items: d.items.map(it => it.staffId === staffId ? { ...it, recovered: !it.recovered } : it),
      }));
      setError(res.message ?? "保存に失敗しました");
    }
    setTogglingKey(null);
  }, [projectId, togglingKey]);

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

  const [, m] = month ? month.split("-").map(Number) : [0, 0];
  const monthLabel = month ? month.replace("-", "年") + "月" : "";
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

      {/* 月ナビ */}
      <div className="flex items-center justify-center gap-3 mb-3">
        <button type="button" onClick={() => setMonth(prev => shiftMonth(prev, -1))}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700">◀</button>
        <span className="text-lg font-bold text-zinc-800 dark:text-zinc-100 tabular-nums min-w-[8rem] text-center">{monthLabel}</span>
        <button type="button" onClick={() => setMonth(prev => shiftMonth(prev, 1))}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700">▶</button>
      </div>

      {/* サマリー */}
      <div className="flex items-center justify-center gap-4 text-xs text-zinc-400 mb-2">
        <span>欠勤のあった日 <span className="font-bold text-zinc-600 dark:text-zinc-300 tabular-nums">{totalDays}</span> 日</span>
        <span>延べ <span className="font-bold text-red-500 tabular-nums">{totalAbsences}</span> 名</span>
      </div>

      {/* 凡例 */}
      <div className="flex items-center justify-center gap-3 text-[11px] text-zinc-400 mb-4 flex-wrap">
        <span>名前タップで補填回収の 済/未 を切替：</span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-300 dark:bg-emerald-900/40 dark:border-emerald-700 inline-block" />
          済
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-red-50 border border-red-200 dark:bg-red-950/30 dark:border-red-900 inline-block" />
          未
        </span>
        <span className="text-zinc-300 dark:text-zinc-600">※離脱リスクONのスタッフは表示されません</span>
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
      {loading && <p className="text-sm text-zinc-400 text-center py-8">読み込み中…</p>}

      {!loading && totalDays === 0 && (
        <p className="text-sm text-zinc-400 text-center py-10">この月の欠勤者はいません</p>
      )}

      {/* 選択月の日毎の表 */}
      {!loading && totalDays > 0 && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-100 dark:bg-zinc-800/80 text-[11px] font-bold text-zinc-500 dark:text-zinc-300">
                <th className="px-3 py-2.5 text-left w-24 whitespace-nowrap">日付</th>
                <th className="px-2 py-2.5 text-center w-12 whitespace-nowrap">人数</th>
                <th className="px-3 py-2.5 text-left">欠勤者</th>
              </tr>
            </thead>
            <tbody>
              {byDate.map((d, i) => {
                const dow = dowOf(d.date);
                return (
                  <tr key={d.date} className={`align-top border-t border-zinc-100 dark:border-zinc-800 ${i % 2 ? "bg-zinc-50/60 dark:bg-zinc-900/40" : ""}`}>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                      <span className={`text-base font-bold ${dowColor(dow)}`}>{m}/{parseInt(d.date.slice(8), 10)}</span>
                      <span className={`text-xs font-semibold ml-0.5 ${dowColor(dow)}`}>（{WEEK[dow]}）</span>
                    </td>
                    <td className="px-2 py-3 text-center align-middle">
                      <span className="inline-flex items-center justify-center min-w-[26px] h-[26px] px-1.5 rounded-full bg-red-500 text-white text-xs font-bold tabular-nums">{d.items.length}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {d.items.map(it => {
                          const key = `${it.staffId}_${d.date}`;
                          return (
                            <button
                              key={it.staffId}
                              type="button"
                              disabled={togglingKey === key}
                              onClick={() => toggleRecovery(it.staffId, d.date)}
                              title={it.recovered ? "補填回収 済（タップで未に戻す）" : "補填回収 未（タップで済にする）"}
                              className={[
                                "inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-lg border transition-colors disabled:opacity-50",
                                it.recovered
                                  ? "bg-emerald-100 border-emerald-300 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:border-emerald-700 dark:hover:bg-emerald-900/60"
                                  : "bg-red-50 border-red-200 hover:bg-red-100 dark:bg-red-950/30 dark:border-red-900 dark:hover:bg-red-950/50",
                              ].join(" ")}
                            >
                              <span className={`text-[10px] font-bold ${it.recovered ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                                {it.recovered ? "済" : "未"}
                              </span>
                              <span className="font-semibold text-zinc-800 dark:text-zinc-100">{it.name}</span>
                              {it.reason && <span className="text-red-400 truncate max-w-[140px]">{it.reason}</span>}
                            </button>
                          );
                        })}
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
