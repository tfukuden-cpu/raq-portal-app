import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isGSheetsConfigured } from "@/lib/gsheets";
import OAuthClient from "./OAuthClient";

export default async function GSheetOAuthPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: s } = await supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  if (s?.global_role !== "executive") redirect("/dashboard");

  const configured = isGSheetsConfigured();

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Google Sheets 連携設定</h1>
            <p className="text-sm font-semibold text-zinc-400 mt-0.5">OAuth2認証でスプレッドシートの自動作成・同期を有効にします</p>
          </div>
          {configured ? (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              設定済み
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-xs font-semibold text-amber-700 dark:text-amber-300 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              未設定
            </span>
          )}
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-10 space-y-6">
        {configured && (
          <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-5 py-4">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">✓ Google Sheets 連携が有効です</p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">新規案件作成時にスプレッドシートが自動で発行されます。</p>
          </div>
        )}

        {!configured && (
          <Suspense fallback={<div className="text-sm text-zinc-400">読み込み中…</div>}>
            <OAuthClient />
          </Suspense>
        )}
      </div>
    </main>
  );
}

