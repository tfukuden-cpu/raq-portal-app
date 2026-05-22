"use client";

import { useState, useTransition, useEffect } from "react";
import {
  fetchOffRequestsAction,
  type OffRequestRow,
} from "./off-request-actions";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

const PRIORITY_COLOR: Record<string, string> = {
  "第一希望休": "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  "第二希望休": "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300",
  "第三希望休": "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
  "第四希望休": "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
  "冠婚葬祭":   "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
};

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

function fmtDate(d: string) {
  const dt = new Date(d + "T00:00:00+09:00");
  return `${dt.getMonth() + 1}/${dt.getDate()}（${WEEKDAY_JP[dt.getDay()]}）`;
}
function fmtTs(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ShiftOffRequestSection({ projectId }: { projectId: string }) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [rows, setRows]          = useState<OffRequestRow[] | null>(null);
  const [listMsg, setListMsg]    = useState<string | null>(null);
  const [isFetching, startFetch] = useTransition();
  const [filterStaff, setFilterStaff] = useState("");

  function handleFetch() {
    setListMsg(null);
    setRows(null);
    setFilterStaff("");
    startFetch(async () => {
      const r = await fetchOffRequestsAction(projectId, year, month);
      if (r.success) setRows(r.rows ?? []);
      else setListMsg(r.message ?? "取得失敗");
    });
  }

  // マウント時・月変更時に自動取得
  useEffect(() => {
    setListMsg(null);
    setRows(null);
    setFilterStaff("");
    startFetch(async () => {
      const r = await fetchOffRequestsAction(projectId, year, month);
      if (r.success) setRows(r.rows ?? []);
      else setListMsg(r.message ?? "取得失敗");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, year, month]);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  // スタッフ別グループ
  const grouped = (() => {
    if (!rows) return null;
    const map = new Map<string, { staffId: string; staffName: string; submittedAt: string | null; dates: { date: string; priority: string }[] }>();
    for (const r of rows) {
      if (!map.has(r.staff_id)) map.set(r.staff_id, { staffId: r.staff_id, staffName: r.staff_name, submittedAt: r.submitted_at, dates: [] });
      map.get(r.staff_id)!.dates.push({ date: r.request_date, priority: r.priority });
    }
    return [...map.values()].filter(g => !filterStaff || g.staffName.includes(filterStaff) || g.staffId.includes(filterStaff));
  })();

  return (
    <div className="space-y-4">

      {/* 月ナビ */}
      <div className="flex items-center gap-2">
        <button
          onClick={prevMonth}
          className="p-1.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <ChevronLeftIcon className="w-4 h-4 text-zinc-500" />
        </button>
        <span className="text-sm font-semibold tabular-nums w-20 text-center text-zinc-900 dark:text-zinc-100">
          {year}/{String(month).padStart(2, "0")}
        </span>
        <button
          onClick={nextMonth}
          className="p-1.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <ChevronRightIcon className="w-4 h-4 text-zinc-500" />
        </button>
        <button
          onClick={handleFetch}
          disabled={isFetching}
          className="ml-1 px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors"
        >
          {isFetching ? "読み込み中…" : "更新"}
        </button>
      </div>

      {listMsg && <p className="text-xs text-red-500">{listMsg}</p>}

      {/* 一覧 */}
      {isFetching && rows === null && (
        <p className="text-xs text-zinc-400 py-3 text-center">読み込み中…</p>
      )}
      {grouped !== null && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {year}年{month}月 — {grouped.length}名 / {rows?.length ?? 0}日分
            </span>
            {grouped.length > 5 && (
              <input
                type="text"
                placeholder="名前・IDで絞り込み"
                value={filterStaff}
                onChange={e => setFilterStaff(e.target.value)}
                className="flex-1 max-w-xs px-2.5 py-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
              />
            )}
          </div>

          {grouped.length === 0 ? (
            <p className="text-xs text-zinc-400 py-2">データなし</p>
          ) : (
            grouped.map(g => (
              <div key={g.staffId} className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{g.staffName}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-400 tabular-nums">申請: {fmtTs(g.submittedAt)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 tabular-nums">{g.dates.length}日</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.dates.map((d, i) => (
                    <span key={i} className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLOR[d.priority] ?? "bg-zinc-100 text-zinc-500"}`}>
                      {fmtDate(d.date)}
                      <span className="opacity-70">{d.priority.replace("希望休", "").replace("冠婚葬祭", "冠婚")}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
