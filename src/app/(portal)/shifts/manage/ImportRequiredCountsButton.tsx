"use client";

import { useState, useTransition } from "react";
import { importRequiredCountsFromSheetAction } from "./sufficiency-actions";

export default function ImportRequiredCountsButton({
  projectId,
  year,
  month,
}: {
  projectId: string;
  year: number;
  month: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleClick = () => {
    setResult(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("year", String(year));
    fd.set("month", String(month));
    startTransition(async () => {
      const r = await importRequiredCountsFromSheetAction(fd);
      setResult({ ok: r.success, msg: r.message ?? (r.success ? "完了" : "エラー") });
    });
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
      >
        {isPending ? (
          <>
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"/>
            </svg>
            読み込み中…
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            スプシから必要数を読込
          </>
        )}
      </button>
      {result && (
        <p className={`text-[11px] font-medium px-1 ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
          {result.ok ? "✓ " : "✗ "}{result.msg}
        </p>
      )}
    </div>
  );
}
