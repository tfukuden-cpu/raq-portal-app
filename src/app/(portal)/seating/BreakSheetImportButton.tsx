"use client";

/**
 * 「シートから休憩を取り込む」ボタン（当日座席表・翌日座席プラン共用）
 * - 現場が運用している休憩表スプレッドシートから、その日の休憩スロット割り当てを取り込む
 * - 引き当てできなかった行は黙って落とさず、モーダルで行番号・アカウント番号・理由を出す
 */

import { useState, useTransition } from "react";
import {
  importBreakAssignmentsFromSheetAction,
  type BreakImportUnresolved,
} from "./break-actions";
import { XIcon } from "@/components/icons";

const SLOT_LABEL: Record<number, string> = { 1: "①", 2: "②", 3: "③" };

export default function BreakSheetImportButton({
  projectId,
  date,
  onDone,
  className,
}: {
  projectId: string;
  /** 取り込む対象日（YYYY-MM-DD） */
  date: string;
  /** 成功/失敗メッセージを親のトーストに出す */
  onDone?: (message: string, ok: boolean) => void;
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [unresolved, setUnresolved] = useState<BreakImportUnresolved[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  function handleClick() {
    if (isPending) return;
    setUnresolved(null);
    setSummary(null);
    startTransition(async () => {
      const res = await importBreakAssignmentsFromSheetAction(projectId, date);

      if (!res.success) {
        onDone?.(res.message ?? "取り込みに失敗しました", false);
        if (res.unresolved.length > 0) {
          setSummary(res.message ?? "取り込める行がありませんでした");
          setUnresolved(res.unresolved);
        }
        return;
      }

      const breakdown = Object.keys(res.slotCounts)
        .map(Number)
        .sort((a, b) => a - b)
        .map(n => `${SLOT_LABEL[n] ?? `スロット${n}`}${res.slotCounts[n]}`)
        .join("／");
      let msg = breakdown
        ? `${res.imported}名を取り込みました（${breakdown}）`
        : `${res.imported}名を取り込みました`;

      const notes: string[] = [];
      if (res.removed > 0) notes.push(`古い割り当て${res.removed}件を削除`);
      if (res.keptManual > 0) notes.push(`手動指定${res.keptManual}件は保持`);
      if (notes.length > 0) msg += `｜${notes.join("・")}`;

      onDone?.(res.unresolved.length > 0 ? `${msg}｜未解決${res.unresolved.length}件` : msg, true);

      if (res.unresolved.length > 0) {
        setSummary(msg);
        setUnresolved(res.unresolved);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={
          className ??
          "flex items-center gap-1.5 text-xs font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 px-3 py-1.5 rounded-lg border border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-950/50 transition-colors disabled:opacity-50"
        }
      >
        {isPending ? (
          <>
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
            </svg>
            取り込み中…
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            シートから休憩を取り込む
          </>
        )}
      </button>

      {unresolved && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setUnresolved(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-lg flex flex-col shadow-xl max-h-[90dvh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                  未解決 {unresolved.length}件
                </h2>
                {summary && <p className="text-[11px] text-zinc-400 mt-0.5">{summary}</p>}
              </div>
              <button
                type="button"
                onClick={() => setUnresolved(null)}
                className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 shrink-0"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-3 overflow-y-auto">
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {unresolved.map((u, i) => (
                  <li key={`${u.row}-${i}`} className="py-2 flex items-start gap-2.5">
                    <span className="text-[11px] font-mono tabular-nums text-zinc-400 shrink-0 w-10 text-right pt-0.5">
                      {u.row}行
                    </span>
                    <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 shrink-0 w-16 pt-0.5">
                      {u.account || "-"}
                    </span>
                    <span className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">{u.reason}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-zinc-400 mt-3 leading-relaxed">
                シート側を直してから再度取り込むか、座席表で個別に休憩パターンを設定してください。
                座席表で個別に設定した分（手動指定）は、次の取り込みでも保持されます。
              </p>
            </div>

            <div className="px-5 pb-4 pt-2 border-t border-zinc-100 dark:border-zinc-800 shrink-0 flex justify-end">
              <button
                type="button"
                onClick={() => setUnresolved(null)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
