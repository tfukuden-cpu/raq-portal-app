"use client";

import { useState, useTransition, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { exchangeCodeAction } from "./actions";

const REDIRECT_URI = "http://localhost:3000/admin/gsheet-oauth";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export default function OAuthClient() {
  const searchParams = useSearchParams();
  const [step, setStep]               = useState<1 | 2 | 3>(1);
  const [clientId, setClientId]       = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [code, setCode]               = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [error, setError]             = useState<string | null>(null);
  const [isPending, startTransition]  = useTransition();

  // Google認証後のリダイレクトで ?code= を自動検出
  useEffect(() => {
    const urlCode = searchParams.get("code");
    if (urlCode) {
      setCode(urlCode);
      setStep(2);
    }
  }, [searchParams]);

  const authUrl = clientId
    ? `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPE)}&access_type=offline&prompt=consent`
    : "";

  const handleExchange = () => {
    setError(null);
    const fd = new FormData();
    fd.set("code", code);
    fd.set("clientId", clientId);
    fd.set("clientSecret", clientSecret);
    fd.set("redirectUri", REDIRECT_URI);
    startTransition(async () => {
      const r = await exchangeCodeAction(fd);
      if (r.success && r.refreshToken) {
        setRefreshToken(r.refreshToken);
        setStep(3);
      } else {
        setError(r.message ?? "エラーが発生しました");
      }
    });
  };

  return (
    <div className="space-y-6">

      {/* ステップ1: クライアントID/シークレット入力 */}
      <div className={`rounded-2xl border p-5 space-y-4 ${step === 1 ? "border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20" : "border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 opacity-60"}`}>
        <div className="flex items-center gap-3">
          <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${step >= 1 ? "bg-blue-500 text-white" : "bg-zinc-200 text-zinc-500"}`}>1</span>
          <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-50">Google Cloud Console で OAuth2 クライアントIDを作成</p>
        </div>
        <ol className="text-xs text-zinc-500 space-y-1.5 ml-9 list-decimal">
          <li><a href="https://console.cloud.google.com/apis/credentials" target="_blank" className="text-blue-500 underline">console.cloud.google.com/apis/credentials</a> を開く</li>
          <li>「認証情報を作成」→「OAuth クライアント ID」</li>
          <li>アプリの種類：<span className="font-semibold text-zinc-700 dark:text-zinc-300">ウェブ アプリケーション</span></li>
          <li>「承認済みのリダイレクト URI」に追加：</li>
        </ol>
        <div className="ml-9 bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs font-mono text-zinc-700 dark:text-zinc-300 select-all">
          {REDIRECT_URI}
        </div>
        <div className="ml-9 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1">クライアント ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="xxxx.apps.googleusercontent.com"
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono text-zinc-900 dark:text-zinc-100"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1">クライアント シークレット</label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="GOCSPX-..."
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono text-zinc-900 dark:text-zinc-100"
            />
          </div>
          <button
            type="button"
            disabled={!clientId || !clientSecret}
            onClick={() => setStep(2)}
            className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold disabled:opacity-40 transition-colors"
          >
            次へ →
          </button>
        </div>
      </div>

      {/* ステップ2: Googleでログイン → コード取得 */}
      <div className={`rounded-2xl border p-5 space-y-4 ${step === 2 ? "border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20" : "border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 opacity-60"}`}>
        <div className="flex items-center gap-3">
          <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${step >= 2 ? "bg-blue-500 text-white" : "bg-zinc-200 text-zinc-500"}`}>2</span>
          <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-50">Googleアカウントで認証</p>
        </div>
        {step === 2 && (
          <div className="ml-9 space-y-3">
            <p className="text-xs text-zinc-500">下のボタンを押してGoogleアカウントでログインし、スプレッドシートへのアクセスを許可してください。</p>
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Googleアカウントで認証する
            </a>
            <p className="text-xs text-zinc-400">認証後、このページにリダイレクトされます。URLに <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">?code=...</code> が含まれます。</p>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1">URLから <code>code=</code> 以降の値を貼り付け</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                placeholder="4/0Adxxxxxx..."
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono text-zinc-900 dark:text-zinc-100"
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              type="button"
              disabled={!code || isPending}
              onClick={handleExchange}
              className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold disabled:opacity-40 transition-colors"
            >
              {isPending ? "取得中…" : "リフレッシュトークンを取得 →"}
            </button>
          </div>
        )}
      </div>

      {/* ステップ3: .env.local に追記 */}
      <div className={`rounded-2xl border p-5 space-y-4 ${step === 3 ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20" : "border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 opacity-60"}`}>
        <div className="flex items-center gap-3">
          <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${step === 3 ? "bg-emerald-500 text-white" : "bg-zinc-200 text-zinc-500"}`}>3</span>
          <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-50">.env.local に追記してサーバーを再起動</p>
        </div>
        {step === 3 && (
          <div className="ml-9 space-y-3">
            <p className="text-xs text-zinc-500">以下を <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">.env.local</code> にコピーして貼り付けてください：</p>
            <pre className="bg-zinc-900 dark:bg-zinc-950 text-emerald-400 rounded-2xl px-4 py-3 text-[11px] overflow-x-auto whitespace-pre-wrap break-all select-all">
{`GOOGLE_CLIENT_ID=${clientId}
GOOGLE_CLIENT_SECRET=${clientSecret}
GOOGLE_REFRESH_TOKEN=${refreshToken}`}
            </pre>
            <p className="text-xs text-zinc-500">追記後、ターミナルで再起動：</p>
            <pre className="bg-zinc-900 dark:bg-zinc-950 text-zinc-300 rounded-2xl px-4 py-3 text-[11px] select-all">
{`rm -rf .next && npm run dev`}
            </pre>
          </div>
        )}
      </div>

    </div>
  );
}
