"use client";

import { useState, useTransition, useEffect } from "react";
import {
  fetchMyOffRequestsAction,
  withdrawOffRequestAction,
} from "@/app/(portal)/admin/[projectId]/settings/off-request-actions";

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
  if (!ts) return null;
  const d = new Date(ts);
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function MyOffRequestsCard({
  projectId,
  initialYear,
  initialMonth,
}: {
  projectId: string;
  initialYear: number;
  initialMonth: number;
}) {
  const [year, setYear]   = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [rows, setRows]   = useState<{ request_date: string; priority: string; submitted_at: string | null }[] | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmDate, setConfirmDate] = useState<string | null>(null);
  const [isWithdrawing, startWithdraw] = useTransition();
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  function load(y: number, m: number) {
    startTransition(async () => {
      const r = await fetchMyOffRequestsAction(projectId, y, m);
      if (r.success) {
        setRows(r.rows ?? []);
        setSubmittedAt(r.rows?.[0]?.submitted_at ?? null);
      } else {
        setRows([]);
        setSubmittedAt(null);
      }
    });
  }

  useEffect(() => { load(year, month); }, []); // 初期ロード

  function handleWithdraw(requestDate: string) {
    setWithdrawError(null);
    startWithdraw(async () => {
      const r = await withdrawOffRequestAction(projectId, requestDate);
      if (r.success) {
        setConfirmDate(null);
        load(year, month);
      } else {
        setWithdrawError(r.message ?? "取り下げに失敗しました");
      }
    });
  }

  const now = new Date();
  const yearOptions = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-3">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">提出済み希望休</p>
        {submittedAt && (
          <p className="text-[10px] text-zinc-400 tabular-nums">申請日時: {fmtTs(submittedAt)}</p>
        )}
      </div>

      {/* 月選択 */}
      <div className="flex items-center gap-2">
        <select value={year} onChange={e => { setYear(Number(e.target.value)); }}
          className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-100">
          {yearOptions.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={month} onChange={e => { setMonth(Number(e.target.value)); }}
          className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-100">
          {monthOptions.map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
        <button
          onClick={() => load(year, month)}
          disabled={isPending}
          className="px-2.5 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-xs font-semibold hover:bg-zinc-300 dark:hover:bg-zinc-600 disabled:opacity-40 transition-colors"
        >
          {isPending ? "…" : "表示"}
        </button>
      </div>

      {/* コンテンツ */}
      {isPending && (
        <p className="text-xs text-zinc-400 py-2 text-center">読み込み中…</p>
      )}

      {!isPending && rows !== null && rows.length === 0 && (
        <p className="text-xs text-zinc-400 py-2 text-center">
          {year}年{month}月の希望休申請はありません
        </p>
      )}

      {!isPending && rows !== null && rows.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setConfirmDate(r.request_date); setWithdrawError(null); }}
              className={`inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full active:opacity-70 transition-opacity ${PRIORITY_COLOR[r.priority] ?? "bg-zinc-100 text-zinc-500"}`}
            >
              {fmtDate(r.request_date)}
              <span className="opacity-70 text-[9px]">{r.priority.replace("希望休", "希望").replace("冠婚葬祭", "冠婚")}</span>
            </button>
          ))}
        </div>
      )}

      {/* 取り下げ確認 */}
      {confirmDate && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 space-y-2">
          <p className="text-xs font-semibold text-red-700 dark:text-red-300">
            {fmtDate(confirmDate)} の希望休を取り下げますか？
          </p>
          {withdrawError && (
            <p className="text-[11px] text-red-500">{withdrawError}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleWithdraw(confirmDate)}
              disabled={isWithdrawing}
              className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-40 transition-colors"
            >
              {isWithdrawing ? "取り下げ中…" : "取り下げる"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDate(null)}
              className="px-3 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <p className="text-[10px] text-zinc-400">日付をタップして取り下げ</p>
      )}
    </div>
  );
}
