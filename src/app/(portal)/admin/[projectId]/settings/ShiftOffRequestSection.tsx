"use client";

import { useState, useTransition, useRef } from "react";
import {
  fetchOffRequestsAction,
  type OffRequestRow,
} from "./off-request-actions";

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

  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg]   = useState<{ ok: boolean; msg: string } | null>(null);
  const [isImporting, startImport]  = useTransition();

  const [rows, setRows]          = useState<OffRequestRow[] | null>(null);
  const [listMsg, setListMsg]    = useState<string | null>(null);
  const [isFetching, startFetch] = useTransition();
  const [filterStaff, setFilterStaff] = useState("");

  function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setImportMsg({ ok: false, msg: "ファイルを選択してください" }); return; }
    setImportMsg(null);
    startImport(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("projectId", projectId);
      const res = await fetch("/api/admin/import-shift-off-requests", { method: "POST", body: fd });
      const json = await res.json();
      if (json.ok) {
        setImportMsg({ ok: true, msg: `${json.month} — ${json.imported}件 取り込み完了${json.skipped?.length ? `（未マッチ: ${json.skipped.join(", ")}）` : ""}` });
        startFetch(async () => {
          const r = await fetchOffRequestsAction(projectId, year, month);
          if (r.success) setRows(r.rows ?? []);
        });
      } else {
        setImportMsg({ ok: false, msg: json.error ?? json.message ?? "エラー" });
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

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

  const yearOptions = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

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
    <div className="space-y-6">

      {/* 月選択 */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm text-zinc-800 dark:text-zinc-100">
          {yearOptions.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={month} onChange={e => setMonth(Number(e.target.value))}
          className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm text-zinc-800 dark:text-zinc-100">
          {monthOptions.map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
        <button onClick={handleFetch} disabled={isFetching}
          className="px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-semibold hover:bg-zinc-200 disabled:opacity-40 transition-colors">
          {isFetching ? "読み込み中…" : "一覧を表示"}
        </button>
      </div>

      {/* Excelインポート */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-3">
        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Googleフォーム集計Excelをインポート</p>
        <p className="text-[11px] text-zinc-400">「希望休」という名称を含むシートを自動認識します。同月同スタッフのデータは上書きされます。</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".xlsx,.xls"
            className="text-xs text-zinc-600 dark:text-zinc-300 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-zinc-200 dark:file:bg-zinc-700 file:text-zinc-700 dark:file:text-zinc-300 hover:file:bg-zinc-300"
          />
          <button onClick={handleImport} disabled={isImporting}
            className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {isImporting ? "インポート中…" : "インポート"}
          </button>
        </div>
        {importMsg && (
          <p className={`text-xs px-3 py-2 rounded-xl ${importMsg.ok ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300" : "bg-red-50 dark:bg-red-950/20 text-red-500"}`}>
            {importMsg.ok ? "✓ " : "✗ "}{importMsg.msg}
          </p>
        )}
      </div>

      {listMsg && <p className="text-xs text-red-500">{listMsg}</p>}

      {/* 一覧 */}
      {grouped !== null && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{year}年{month}月 — {grouped.length}名 / {rows?.length ?? 0}日分</span>
            {grouped.length > 5 && (
              <input type="text" placeholder="名前・IDで絞り込み" value={filterStaff}
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
