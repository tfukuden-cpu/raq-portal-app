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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
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
        placeholder="スタッフ名・変更者・シフト名で絞り込み…"
        className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
      />

      {/* 件数 */}
      <p className="text-xs text-zinc-400">{filtered.length} 件{search && "（絞り込み中）"}</p>

      {/* テーブル */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-zinc-400 text-sm">変更ログがありません</div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          {/* ヘッダー */}
          <div className="grid grid-cols-[120px_1fr_1fr_1fr] gap-px bg-zinc-200 dark:bg-zinc-700 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
            <div className="bg-zinc-50 dark:bg-zinc-800 px-3 py-2">変更日時</div>
            <div className="bg-zinc-50 dark:bg-zinc-800 px-3 py-2">シフト変更者</div>
            <div className="bg-zinc-50 dark:bg-zinc-800 px-3 py-2">当該スタッフ</div>
            <div className="bg-zinc-50 dark:bg-zinc-800 px-3 py-2">変更前⇒変更後</div>
          </div>
          {/* 行 */}
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filtered.map((log, i) => (
              <div key={i}
                className="grid grid-cols-[120px_1fr_1fr_1fr] gap-px bg-zinc-200 dark:bg-zinc-700 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors">
                <div className="bg-white dark:bg-zinc-900 px-3 py-2 tabular-nums text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                  {formatDateTime(log.changed_at)}
                </div>
                <div className="bg-white dark:bg-zinc-900 px-3 py-2 text-zinc-700 dark:text-zinc-300 truncate">
                  {log.changed_by_name}
                </div>
                <div className="bg-white dark:bg-zinc-900 px-3 py-2 font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                  {log.staff_name}
                </div>
                <div className="bg-white dark:bg-zinc-900 px-3 py-2 flex items-center gap-1 flex-wrap">
                  <span className={log.before_shift_name ? "text-red-500 dark:text-red-400 line-through" : "text-zinc-300 dark:text-zinc-600"}>
                    {log.before_shift_name ?? "—"}
                  </span>
                  <span className="text-zinc-400">⇒</span>
                  <span className={log.after_shift_name ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-zinc-300 dark:text-zinc-600"}>
                    {log.after_shift_name ?? "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
