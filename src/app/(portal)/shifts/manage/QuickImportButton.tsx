"use client";

import { useState, useTransition } from "react";
import { quickImportShiftTableAction } from "../sheet-actions";

export default function QuickImportButton({
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
    fd.set("year",  String(year));
    fd.set("month", String(month));
    startTransition(async () => {
      const r = await quickImportShiftTableAction(fd);
      setResult({
        ok:  r.success,
        msg: r.success
          ? (r.message ?? `${r.count ?? 0}件を読み込みました`)
          : (r.message ?? "エラーが発生しました"),
      });
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors"
      >
        <span className="text-sm leading-none">↓</span>
        {isPending ? "読み込み中…" : "スプシから読み込む"}
      </button>
      {result && (
        <p className={`text-[10px] font-medium tabular-nums ${result.ok ? "text-emerald-500" : "text-red-500"}`}>
          {result.ok ? "✓ " : "✗ "}{result.msg}
        </p>
      )}
    </div>
  );
}
