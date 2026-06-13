"use client";

import { useRef, useState, useTransition } from "react";
import { importRankingsAction } from "./actions";

type RankingRow = {
  rank_label: string;
  rank_order: number;
  staff_name: string;
  category: "査定" | "販売";
};

type Props = {
  sateiRankings: RankingRow[];
  hanbaiRankings: RankingRow[];
  importedAt: string | null;
};

function RankLabel({ label }: { label: string }) {
  const isNum = /^\d+$/.test(label);
  const isG = label === "G";
  return (
    <span className={
      isNum
        ? "font-bold tabular-nums text-blue-600 dark:text-blue-400 w-10 text-right inline-block"
        : isG
        ? "font-bold text-amber-500 dark:text-amber-400 w-10 text-right inline-block"
        : "text-zinc-400 dark:text-zinc-500 text-xs w-10 text-right inline-block"
    }>
      {isNum ? `${label}位` : label}
    </span>
  );
}

function RankingTable({ title, rows, accent }: {
  title: string;
  rows: RankingRow[];
  accent: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4">
        <h3 className="font-semibold text-sm text-zinc-700 dark:text-zinc-300 mb-3">{title}</h3>
        <p className="text-sm text-zinc-400 text-center py-6">データなし</p>
      </div>
    );
  }

  const numRows = rows.filter(r => /^\d+$/.test(r.rank_label));
  const others  = rows.filter(r => !/^\d+$/.test(r.rank_label));

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className={`px-4 py-2.5 ${accent} flex items-center justify-between`}>
        <h3 className="font-bold text-sm text-white">{title}</h3>
        <span className="text-xs text-white/70 tabular-nums">{rows.length} 名</span>
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {numRows.map((r) => (
          <div key={r.rank_order} className="flex items-center gap-3 px-4 py-1.5 text-sm">
            <RankLabel label={r.rank_label} />
            <span className="text-zinc-800 dark:text-zinc-100 flex-1 truncate">{r.staff_name}</span>
          </div>
        ))}
        {others.length > 0 && numRows.length > 0 && (
          <div className="h-px bg-zinc-200 dark:bg-zinc-700" />
        )}
        {others.map((r) => (
          <div key={r.rank_order} className="flex items-center gap-3 px-4 py-1.5 text-sm bg-zinc-50/50 dark:bg-zinc-800/30">
            <RankLabel label={r.rank_label} />
            <span className="text-zinc-500 dark:text-zinc-400 flex-1 truncate">{r.staff_name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RankingsClient({ sateiRankings, hanbaiRankings, importedAt }: Props) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok?: boolean; error?: string; sateiCount?: number; hanbaiCount?: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleImport(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await importRankingsAction(fd);
      setStatus(res);
      if (res.ok && fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div className="space-y-6">
      {/* インポートカード */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-sm text-zinc-700 dark:text-zinc-300">番付インポート</h2>
          <a
            href="/api/rankings/template"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            テンプレートDL
          </a>
        </div>

        {importedAt && (
          <p className="text-xs text-zinc-400 tabular-nums">
            最終インポート: {new Date(importedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </p>
        )}

        <form onSubmit={handleImport} className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".xlsx,.xls"
            required
            className="flex-1 text-xs text-zinc-600 dark:text-zinc-300 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-600 dark:file:bg-blue-900/30 dark:file:text-blue-400 cursor-pointer"
          />
          <button
            type="submit"
            disabled={isPending}
            className="shrink-0 px-4 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold disabled:opacity-50 hover:bg-blue-700 transition-colors"
          >
            {isPending ? "処理中…" : "インポート"}
          </button>
        </form>

        {status && (
          <div className={`text-xs rounded-xl px-3 py-2 ${status.ok ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400" : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"}`}>
            {status.ok
              ? `インポート完了 — 査定 ${status.sateiCount} 名、販売 ${status.hanbaiCount} 名`
              : `エラー: ${status.error}`}
          </div>
        )}

        {status?.ok && (
          <p className="text-xs text-zinc-400">ページを再読み込みすると番付が更新されます。</p>
        )}
      </div>

      {/* 番付テーブル */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <RankingTable
          title="査定番付"
          rows={sateiRankings}
          accent="bg-blue-600 dark:bg-blue-700"
        />
        <RankingTable
          title="販売番付"
          rows={hanbaiRankings}
          accent="bg-emerald-600 dark:bg-emerald-700"
        />
      </div>
    </div>
  );
}
