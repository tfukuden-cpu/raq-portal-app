"use client";

/**
 * magic link のトークンをセッションに変換してダッシュボードへリダイレクト
 */
import { useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function AuthConfirmPage() {
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // URL fragment から access_token を取得してセッションを確立
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        window.location.href = "/dashboard";
      }
    });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black">
      <p className="text-sm text-zinc-500">ログイン中...</p>
    </div>
  );
}
