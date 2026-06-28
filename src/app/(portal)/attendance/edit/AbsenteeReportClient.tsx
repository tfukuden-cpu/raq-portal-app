"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { AbsenteeStaff } from "@/app/api/admin/work-records/absentees/route";

function rateColor(rate: number | null): string {
  if (rate === null) return "text-zinc-400";
  if (rate >= 95) return "text-emerald-600 dark:text-emerald-400";
  if (rate >= 80) return "text-amber-500";
  return "text-red-500";
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function AbsenteeReportClient({ projectId }: { projectId: string }) {
  const [month, setMonth] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [staff, setStaff] = useState<AbsenteeStaff[]>([]);
  const [openStaffId, setOpenStaffId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 初期月（当月・JST）はマウント後に設定（hydration mismatch回避）
  useEffect(() => {
    setMonth(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).slice(0, 7));
  }, []);

  const load = useCallback(async (mon: string) => {
    if (!mon) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/work-records/absentees?projectId=${encodeURIComponent(projectId)}&month=${mon}`);
      if (!res.ok) throw new Error(`(${res.status})`);
      const data = await res.json() as { staff: AbsenteeStaff[] };
      setStaff(data.staff ?? []);
    } catch (e) {
      setError("読み込みに失敗しました " + (e instanceof Error ? e.message : ""));
      setStaff([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { if (month) load(month); }, [month, load]);

  const [y, m] = month ? month.split("-").map(Number) : [0, 0];
  const monthLabel = month ? `${y}年${m}月` : "";
  const totalAbsentees = staff.length;
  const totalAbsenceDays = staff.reduce((s, x) => s + x.monthAbsences, 0);

  return (
    <div className="pt-4 pb-32 max-w-3xl mx-auto">
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
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 px-4 py-3">
          <p className="text-[11px] font-semibold text-red-400">当月の欠勤者</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-300 tabular-nums">{totalAbsentees}<span className="text-sm font-semibold ml-0.5">名</span></p>
        </div>
        <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 px-4 py-3">
          <p className="text-[11px] font-semibold text-zinc-400">延べ欠勤日数</p>
          <p className="text-2xl font-bold text-zinc-700 dark:text-zinc-200 tabular-nums">{totalAbsenceDays}<span className="text-sm font-semibold ml-0.5">日</span></p>
        </div>
      </div>

      {/* 日毎の欠勤者を表で見る（別ページ） */}
      <Link
        href={`/attendance/absentees${month ? `?month=${month}` : ""}`}
        className="flex items-center justify-center gap-2 w-full mb-5 px-4 py-3 rounded-2xl bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold hover:bg-zinc-700 dark:hover:bg-white transition-colors">
        📅 日毎の欠勤者を表で見る
        <span className="text-base">›</span>
      </Link>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
      {loading && <p className="text-sm text-zinc-400 text-center py-8">読み込み中…</p>}

      {!loading && totalAbsentees === 0 && (
        <p className="text-sm text-zinc-400 text-center py-10">当月の欠勤者はいません</p>
      )}

      {!loading && totalAbsentees > 0 && (
        <>
          {/* 当月の欠勤者一覧（OP選択で過去分） */}
          <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-200 mb-2">当月の欠勤者（タップで当月＋過去の出勤率）</h3>
          <div className="space-y-1.5 mb-7">
            {staff.map(s => {
              const open = openStaffId === s.staffId;
              return (
                <div key={s.staffId} className="rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                  <button type="button"
                    onClick={() => setOpenStaffId(open ? null : s.staffId)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <span className="text-[11px] tabular-nums text-zinc-400 w-16 shrink-0">{s.accountNumber ?? "—"}</span>
                    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex-1 truncate">{s.name}</span>
                    {s.section && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 shrink-0">{s.section}</span>}
                    <span className="text-xs font-bold text-red-600 dark:text-red-300 tabular-nums shrink-0">
                      {s.monthAbsentRate === null ? "—" : `欠勤${s.monthAbsentRate}%`}
                      <span className="font-semibold text-zinc-400 ml-1">{s.monthAbsences}回</span>
                    </span>
                    <span className={`text-zinc-300 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
                  </button>
                  {open && (
                    <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-900/60 border-t border-zinc-100 dark:border-zinc-800 space-y-4">
                      {/* 当月のみの実績 */}
                      <div>
                        <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-300 mb-2">{m}月のみの出勤率</p>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-[10px] text-zinc-400">出勤率</p>
                            <p className={`text-lg font-bold tabular-nums ${rateColor(s.monthRate)}`}>
                              {s.monthRate === null ? "—" : `${s.monthRate}%`}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-400">出勤数</p>
                            <p className="text-lg font-bold text-zinc-700 dark:text-zinc-200 tabular-nums">{s.monthAttendedDays}<span className="text-[10px] font-semibold">日</span></p>
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-400">欠勤数</p>
                            <p className="text-lg font-bold text-red-600 dark:text-red-300 tabular-nums">{s.monthAbsentDays}<span className="text-[10px] font-semibold">日</span></p>
                          </div>
                        </div>
                        <p className="text-[10px] text-zinc-400 mt-1 text-right">出勤予定 {s.monthShiftDays}日中（本日まで）</p>
                      </div>

                      {/* 過去1年の累計実績 */}
                      <div className="pt-3 border-t border-zinc-200/70 dark:border-zinc-700/50">
                        <p className="text-[11px] text-zinc-400 mb-2">過去1年の実績（累計）</p>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-[10px] text-zinc-400">出勤率</p>
                            <p className={`text-lg font-bold tabular-nums ${rateColor(s.histRate)}`}>
                              {s.histRate === null ? "—" : `${s.histRate}%`}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-400">出勤数</p>
                            <p className="text-lg font-bold text-zinc-700 dark:text-zinc-200 tabular-nums">{s.histAttendedDays}<span className="text-[10px] font-semibold">日</span></p>
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-400">欠勤数</p>
                            <p className="text-lg font-bold text-red-600 dark:text-red-300 tabular-nums">{s.histAbsentDays}<span className="text-[10px] font-semibold">日</span></p>
                          </div>
                        </div>
                        <p className="text-[10px] text-zinc-400 mt-1 text-right">出勤予定 {s.histShiftDays}日中</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
