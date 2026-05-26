"use client";

import { useState, useTransition } from "react";
import { publishShiftsAction } from "./actions";

type Props = {
  projectId: string;
  year: number;
  month: number;
  isPublished?: boolean;
};

export default function PublishButton({ projectId, year, month, isPublished }: Props) {
  const [result, setResult]  = useState<{ sent: number; noLine: string[] } | null>(null);
  const [error, setError]    = useState<string | null>(null);
  const [isPending, start]   = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);

  const targetMonth = `${year}/${String(month).padStart(2, "0")}`;

  const handlePublish = () => {
    setError(null);
    setResult(null);
    start(async () => {
      const res = await publishShiftsAction(projectId, year, month);
      setShowConfirm(false);
      if (res.success) {
        setResult({ sent: res.sent ?? 0, noLine: res.noLine ?? [] });
      } else {
        setError(res.message ?? "エラーが発生しました");
      }
    });
  };

  // 展開済みの場合はグレーアウトバッジ表示（再展開も可能）
  if (isPublished) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => { setShowConfirm(true); setResult(null); setError(null); }}
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-500 dark:text-zinc-400 transition-colors"
          title="展開済み（再展開する場合はクリック）"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          展開済み
        </button>

        {/* 確認ダイアログ（再展開用） */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-6 w-full max-w-xs space-y-4">
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">シフト再展開の確認</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {targetMonth}のシフトをもう一度全スタッフへLINEで通知します。よろしいですか？
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirm(false)}
                  className="flex-1 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  キャンセル
                </button>
                <button onClick={handlePublish} disabled={isPending}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 text-sm font-semibold text-white">
                  {isPending ? "送信中..." : "再展開する"}
                </button>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="absolute right-0 top-10 z-40 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg p-3 w-56 text-xs space-y-1">
            <p className="font-semibold text-emerald-600">送信完了 {result.sent}名</p>
            {result.noLine.length > 0 && (
              <p className="text-zinc-500">LINE未連携：{result.noLine.join("・")}</p>
            )}
            <button onClick={() => setResult(null)} className="text-zinc-400 hover:text-zinc-600 text-[10px]">閉じる</button>
          </div>
        )}
        {error && (
          <div className="absolute right-0 top-10 z-40 bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-800 rounded-xl shadow-lg p-3 w-48 text-xs">
            <p className="text-red-600">{error}</p>
            <button onClick={() => setError(null)} className="text-zinc-400 hover:text-zinc-600 text-[10px] mt-1">閉じる</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setShowConfirm(true); setResult(null); setError(null); }}
        disabled={isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 text-white transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
        シフト展開
      </button>

      {/* 確認ダイアログ */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-6 w-full max-w-xs space-y-4">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">シフト展開の確認</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {targetMonth}のシフトを全スタッフへLINEで通知します。よろしいですか？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                キャンセル
              </button>
              <button
                onClick={handlePublish}
                disabled={isPending}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 text-sm font-semibold text-white"
              >
                {isPending ? "送信中..." : "展開する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 結果表示 */}
      {result && (
        <div className="absolute right-0 top-10 z-40 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg p-3 w-56 text-xs space-y-1">
          <p className="font-semibold text-emerald-600">送信完了 {result.sent}名</p>
          {result.noLine.length > 0 && (
            <p className="text-zinc-500">LINE未連携：{result.noLine.join("・")}</p>
          )}
          <button onClick={() => setResult(null)} className="text-zinc-400 hover:text-zinc-600 text-[10px]">閉じる</button>
        </div>
      )}

      {error && (
        <div className="absolute right-0 top-10 z-40 bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-800 rounded-xl shadow-lg p-3 w-48 text-xs">
          <p className="text-red-600">{error}</p>
          <button onClick={() => setError(null)} className="text-zinc-400 hover:text-zinc-600 text-[10px] mt-1">閉じる</button>
        </div>
      )}
    </div>
  );
}
