"use client";

/**
 * LINE公式アカウントを友達追加していない場合に表示する全画面ゲート。
 * - 「友達追加する」→ LINE アプリを開く
 * - ユーザーがアプリに戻ってきたら visibilitychange で自動検知 → line_friend=true をセット
 */

import { useTransition, useRef } from "react";
import { confirmLineFriendAction } from "./line-friend-actions";

interface Props {
  lineAddUrl: string;
}

export default function LineFriendGate({ lineAddUrl }: Props) {
  const [isPending, startTransition] = useTransition();
  const listeningRef = useRef(false);

  function confirm() {
    startTransition(async () => {
      await confirmLineFriendAction();
    });
  }

  function handleLineAdd() {
    if (listeningRef.current) return;
    listeningRef.current = true;

    // LINE アプリを開く（iOS ユニバーサルリンク → アプリへ遷移、ブラウザは同 URL のまま）
    window.location.href = lineAddUrl || "https://line.me";

    // 2 秒後から visibilitychange を監視（LINE が完全に開くまで待つ）
    const cleanup = () => {
      document.removeEventListener("visibilitychange", onReturn);
      clearTimeout(fallback);
      listeningRef.current = false;
    };

    const onReturn = () => {
      if (document.hidden) return; // まだ LINE 側にいる
      cleanup();
      confirm(); // 戻ってきたら自動確認
    };

    setTimeout(() => {
      document.addEventListener("visibilitychange", onReturn);
    }, 2000);

    // 60 秒経っても戻らなければリスナー解除
    const fallback = setTimeout(cleanup, 60_000);
  }

  if (isPending) {
    return (
      <div className="fixed inset-0 z-[9999] bg-white dark:bg-zinc-950 flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 rounded-full border-4 border-zinc-200 border-t-blue-600 animate-spin" />
        <p className="text-sm text-zinc-500">確認中…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-white dark:bg-zinc-950 flex flex-col items-center justify-center px-6 text-center">
      {/* LINE アイコン */}
      <div className="w-20 h-20 rounded-[22px] bg-[#06C755] flex items-center justify-center mb-6 shadow-lg">
        <svg viewBox="0 0 48 48" className="w-12 h-12 fill-white">
          <path d="M24 4C12.95 4 4 11.82 4 21.4c0 6.5 4.3 12.2 10.76 15.44-.15.54-1 3.47-1.14 3.97-.17.62.23.61.49.45.2-.13 3.2-2.12 4.5-2.98.94.13 1.9.2 2.87.2 11.05 0 20-7.82 20-17.4S35.05 4 24 4z"/>
        </svg>
      </div>

      <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
        LINE友達追加が必要です
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs leading-relaxed mb-8">
        シフト確認・お知らせ通知のため、<br />
        I Works の LINE 公式アカウントを<br />
        友達追加してください。
      </p>

      <div className="w-full max-w-xs space-y-3">
        <button
          type="button"
          onClick={handleLineAdd}
          className="flex items-center justify-center gap-2 w-full bg-[#06C755] hover:bg-[#05b34c] active:bg-[#049a41] text-white font-semibold py-3.5 px-6 rounded-2xl transition-colors shadow-md text-base"
        >
          <svg viewBox="0 0 20 20" className="w-5 h-5 fill-white shrink-0">
            <path d="M10 2C5.58 2 2 5.13 2 9c0 2.7 1.79 5.08 4.48 6.43-.06.22-.42 1.44-.47 1.65-.07.26.1.25.2.19.08-.05 1.33-.88 1.87-1.24.39.05.79.08 1.19.08 4.42 0 8-3.13 8-7S14.42 2 10 2z"/>
          </svg>
          友達追加する
        </button>

        {/* 手動確認（自動検知が効かない環境用） */}
        <button
          type="button"
          onClick={confirm}
          className="w-full text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 py-2 transition-colors"
        >
          すでに追加済み・手動で確認する
        </button>
      </div>
    </div>
  );
}
