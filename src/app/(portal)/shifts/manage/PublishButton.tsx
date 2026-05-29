"use client";

import { useState, useTransition } from "react";
import { publishShiftsAction } from "./actions";

type Props = {
  projectId: string;
  year: number;
  month: number;
  isPublished?: boolean;
  /** グループ内に埋め込む場合 true → 角丸なし */
  flat?: boolean;
  /** 通知設定から取得したメッセージテンプレート */
  defaultMessage?: string;
};

const FALLBACK_MESSAGE = `{名前}さん、{対象月}のシフトが確定しました。

{シフト一覧}
ポータルのシフトページからご確認ください。`;

export default function PublishButton({ projectId, year, month, isPublished, flat, defaultMessage }: Props) {
  const rounding = flat ? "rounded-none" : "rounded-lg";
  const [result, setResult]       = useState<{ sent: number; noLine: string[] } | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [isPending, start]        = useTransition();
  const [showDialog, setShowDialog] = useState(false);
  const [message, setMessage]     = useState<string>("");
  // 展開成功後にクライアント側で即グレーアウトするためのローカルフラグ
  const [localPublished, setLocalPublished] = useState(isPublished ?? false);

  const targetMonth = `${year}/${String(month).padStart(2, "0")}`;

  function openDialog() {
    setMessage(defaultMessage?.trim() || FALLBACK_MESSAGE);
    setResult(null);
    setError(null);
    setShowDialog(true);
  }

  const handlePublish = () => {
    setError(null);
    setResult(null);
    start(async () => {
      const res = await publishShiftsAction(projectId, year, month, message);
      setShowDialog(false);
      if (res.success) {
        setResult({ sent: res.sent ?? 0, noLine: res.noLine ?? [] });
        setLocalPublished(true);
      } else {
        setError(res.message ?? "エラーが発生しました");
      }
    });
  };

  const dialog = showDialog && (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md space-y-4 p-5">
        <div>
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            {localPublished ? "シフト再展開" : "シフト展開"} — {targetMonth}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            LINE連携済みの全スタッフへ個別に通知が届きます
          </p>
        </div>

        {/* メッセージ編集エリア */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            通知メッセージ
          </label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={10}
            className="w-full text-xs font-mono rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-800 dark:text-zinc-200 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-[10px] text-zinc-400 leading-relaxed">
            <span className="font-semibold text-zinc-500">{"{名前}"}</span> 各スタッフ名 ／{" "}
            <span className="font-semibold text-zinc-500">{"{対象月}"}</span> {targetMonth} ／{" "}
            <span className="font-semibold text-zinc-500">{"{シフト一覧}"}</span> 全日程（公休含む）
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setShowDialog(false)}
            className="flex-1 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            キャンセル
          </button>
          <button
            onClick={handlePublish}
            disabled={isPending || !message.trim()}
            className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 text-sm font-semibold text-white transition-colors"
          >
            {isPending ? "送信中..." : localPublished ? "再展開する" : "展開する"}
          </button>
        </div>
      </div>
    </div>
  );

  // 展開済みの場合はグレーアウトバッジ
  if (localPublished) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={openDialog}
          disabled={isPending}
          className={`flex items-center gap-1.5 px-3 py-1.5 ${rounding} text-xs font-semibold bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-500 dark:text-zinc-400 transition-colors`}
          title="展開済み（再展開する場合はクリック）"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          展開済み
        </button>

        {dialog}

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
        onClick={openDialog}
        disabled={isPending}
        className={`flex items-center gap-1.5 px-3 py-1.5 ${rounding} text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 text-white transition-colors`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
        シフト展開
      </button>

      {dialog}

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
