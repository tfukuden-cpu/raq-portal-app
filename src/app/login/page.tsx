/**
 * ログイン画面
 * 社員ID + パスワードで認証
 */
"use client";

import { useState, useTransition, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { loginAction } from "./actions";

const URL_ERROR_MESSAGES: Record<string, string> = {
  line_not_friend:    "公式LINEを友達追加してからもう一度お試しください",
  line_not_registered: "このLINEアカウントはシステムに登録されていません",
  line_cancelled:     "LINEログインをキャンセルしました",
  line_failed:        "LINEログインに失敗しました。再度お試しください",
};

const LINE_ADD_FRIEND_URL = "https://line.me/ti/p/@014icizf";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("error");
    if (code && URL_ERROR_MESSAGES[code]) setError(URL_ERROR_MESSAGES[code]);
  }, [searchParams]);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await loginAction(formData);
      if (!result.success) {
        setError(result.message ?? "ログインに失敗しました");
      }
    });
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            RaqWorks
          </h1>
          <p className="text-sm text-zinc-500 mt-1">社内ポータル</p>
        </div>

        <form
          action={handleSubmit}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 space-y-4 shadow-sm"
        >
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
            >
              氏名
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              autoComplete="name"
              placeholder="例：田中太郎"
              className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
            >
              パスワード
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full px-3 py-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200 space-y-2">
              <p>{error}</p>
              {searchParams.get("error") === "line_not_friend" && (
                <a
                  href={LINE_ADD_FRIEND_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white"
                  style={{ backgroundColor: "#06C755" }}
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white flex-shrink-0">
                    <path d="M12 2C6.477 2 2 6.036 2 11c0 2.67 1.28 5.063 3.306 6.73.145.122.203.316.151.496l-.47 1.717c-.073.266.107.538.378.538.07 0 .14-.018.202-.054L8.05 19.05c.131-.076.284-.09.427-.039C9.357 19.332 10.666 19.5 12 19.5c5.523 0 10-4.036 10-9s-4.477-9-10-9z"/>
                  </svg>
                  公式LINEを友達追加する
                </a>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white font-medium transition-colors"
          >
            {isPending ? "ログイン中..." : "ログイン"}
          </button>
        </form>

        {/* LINE ログイン */}
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
          <span className="text-xs text-zinc-400">または</span>
          <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
        </div>

        <a
          href="/api/auth/line?mode=login"
          className="flex items-center justify-center gap-2.5 w-full py-2.5 rounded-md font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#06C755" }}
        >
          {/* LINE ロゴ */}
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white flex-shrink-0">
            <path d="M19.365 9.89c.50 0 .906.407.906.907s-.406.907-.906.907H17.27v1.204h2.094c.5 0 .906.406.906.906s-.406.907-.906.907h-3c-.5 0-.907-.407-.907-.907V9.89c0-.5.407-.907.907-.907h3zm-5.423 0c.5 0 .906.407.906.907v3.924c0 .5-.406.907-.906.907s-.906-.407-.906-.907V10.797c0-.5.406-.907.906-.907zm-2.854 0c.346 0 .657.197.81.504l1.672 3.34c.222.444.041.985-.402 1.207-.443.222-.985.041-1.207-.402l-.22-.44h-1.306l-.22.44c-.222.443-.764.624-1.207.402-.443-.222-.624-.763-.402-1.207l1.672-3.34c.153-.307.464-.504.81-.504zm0 2.27l-.356.71h.713l-.356-.71zM5.84 9.89c.5 0 .906.407.906.907v2.354l1.814-2.682c.183-.27.487-.42.807-.38.32.04.6.26.706.57.044.132.063.267.055.4v3.757c0 .5-.406.907-.906.907s-.907-.407-.907-.907v-2.354l-1.814 2.682c-.21.31-.579.456-.935.376-.357-.08-.627-.376-.669-.74-.01-.083-.01-.167 0-.25V10.797c0-.5.406-.907.906-.907zM12 2C6.477 2 2 6.036 2 11c0 2.67 1.28 5.063 3.306 6.73.145.122.203.316.151.496l-.47 1.717c-.073.266.107.538.378.538.07 0 .14-.018.202-.054L8.05 19.05c.131-.076.284-.09.427-.039C9.357 19.332 10.666 19.5 12 19.5c5.523 0 10-4.036 10-9s-4.477-9-10-9z"/>
          </svg>
          LINEでログイン
        </a>

        <p className="text-center text-xs text-zinc-500 mt-5">
          パスワードを忘れた場合は管理者にお問い合わせください
        </p>
      </div>
    </main>
  );
}
