"use client";

import { useState } from "react";

export type ChangeLogEntry = {
  staff_id: string;
  staff_name: string;
  shift_date: string;
  action: string;
  before_shift_name: string | null;
  after_shift_name: string | null;
  changed_by_name: string;
  changed_at: string;
};

type Props = {
  logs: ChangeLogEntry[];
  year: number;
  month: number;
  prevMonth: { year: number; month: number };
  nextMonth: { year: number; month: number };
  monthNavBase: string;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

function actionLabel(action: string): { label: string; cls: string } {
  if (action === "confirm")  return { label: "確定",   cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" };
  if (action === "delete")   return { label: "削除",   cls: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" };
  if (action === "update")   return { label: "変更",   cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" };
  if (action === "add")      return { label: "追加",   cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" };
  return { label: action, cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" };
}

export default function ShiftChangeLogTab({ logs, year, month, prevMonth, nextMonth, monthNavBase }: Props) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? logs.filter(l =>
        l.staff_name.includes(search) ||
        l.shift_date.includes(search) ||
        l.changed_by_name.includes(search) ||
        (l.before_shift_name ?? "").includes(search) ||
        (l.after_shift_name  ?? "").includes(search)
      )
    : logs;

  const prevUrl = `${monthNavBase}${prevMonth.year}&month=${prevMonth.month}&tab=logs`;
  const nextUrl = `${monthNavBase}${nextMonth.year}&month=${nextMonth.month}&tab=logs`;

  return (
    <div className="space-y-4">
      {/* 月ナビ */}
      <div className="flex items-center justify-between">
        <a href={prevUrl} className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
          <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </a>
        <span className="text-base font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
          {year}/{String(month).padStart(2, "0")}
        </span>
        <a href={nextUrl} className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
          <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </a>
      </div>

      {/* 検索 */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="スタッフ名・日付・シフト名で絞り込み…"
        className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
      />

      {/* 件数 */}
      <p className="text-xs text-zinc-400">
        {filtered.length} 件{search && `（絞り込み中）`}
      </p>

      {/* ログ一覧 */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-zinc-400 text-sm">変更ログがありません</div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((log, i) => {
            const { label, cls } = actionLabel(log.action);
            const hasChange = log.before_shift_name !== null || log.after_shift_name !== null;
            return (
              <div key={i}
                className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-700/50">
                {/* 日付 */}
                <div className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400 w-12 shrink-0 pt-0.5">
                  {log.shift_date.slice(5).replace("-", "/")}
                </div>
                {/* スタッフ名 */}
                <div className="font-semibold text-sm text-zinc-800 dark:text-zinc-100 w-20 shrink-0 truncate">
                  {log.staff_name}
                </div>
                {/* アクション + 変更内容 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${cls}`}>{label}</span>
                    {hasChange && (
                      <span className="text-xs text-zinc-600 dark:text-zinc-300">
                        {log.before_shift_name
                          ? <span className="text-red-500 dark:text-red-400 line-through mr-1">{log.before_shift_name}</span>
                          : <span className="text-zinc-300 mr-1">—</span>
                        }
                        <span className="text-zinc-300 dark:text-zinc-600 mr-1">→</span>
                        {log.after_shift_name
                          ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{log.after_shift_name}</span>
                          : <span className="text-zinc-300">—</span>
                        }
                      </span>
                    )}
                  </div>
                </div>
                {/* 変更者・日時 */}
                <div className="text-right shrink-0">
                  <div className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">{log.changed_by_name}</div>
                  <div className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">{formatTime(log.changed_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
