/**
 * 欠勤者 経過報告ページ
 * 当日欠勤スタッフが翌日出勤可否を報告する
 */
"use client";

import { useState, useTransition } from "react";
import { submitFollowupAction } from "./actions";

export default function AbsenceFollowupPage() {
  const [nextAvail, setNextAvail]   = useState<boolean | null>(null);
  const [symptoms,  setSymptoms]    = useState("");
  const [done,      setDone]        = useState(false);
  const [error,     setError]       = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 今日の日付（JST）
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  const handleSubmit = () => {
    if (nextAvail === null) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("next_day_available", String(nextAvail));
      fd.set("symptoms", symptoms);
      fd.set("absence_date", today);
      const res = await submitFollowupAction(fd);
      if (res.success) {
        setDone(true);
      } else {
        setError(res.message ?? "エラーが発生しました");
      }
    });
  };

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">経過報告を送信しました</h2>
          <p className="text-sm text-zinc-500">管理者に通知されました。</p>
          <a href="/dashboard" className="inline-block mt-2 text-sm text-blue-600 hover:underline">
            ホームに戻る
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4">
      <div className="max-w-sm mx-auto pt-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">経過報告</h1>
          <p className="text-sm text-zinc-500 mt-1">翌日の出勤状況をご報告ください</p>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-5">

          {/* 翌日出勤可否 */}
          <div>
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
              明日は出勤できますか？
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setNextAvail(true)}
                className={[
                  "py-3 rounded-xl text-sm font-semibold border-2 transition-colors",
                  nextAvail === true
                    ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-500 text-emerald-700 dark:text-emerald-300"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300",
                ].join(" ")}
              >
                出勤できます
              </button>
              <button
                type="button"
                onClick={() => setNextAvail(false)}
                className={[
                  "py-3 rounded-xl text-sm font-semibold border-2 transition-colors",
                  nextAvail === false
                    ? "bg-red-50 dark:bg-red-900/30 border-red-500 text-red-700 dark:text-red-300"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300",
                ].join(" ")}
              >
                出勤できません
              </button>
            </div>
          </div>

          {/* 症状詳細（不可の場合） */}
          {nextAvail === false && (
            <div>
              <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                症状・状況（任意）
              </label>
              <textarea
                value={symptoms}
                onChange={e => setSymptoms(e.target.value)}
                rows={3}
                placeholder="例：発熱38度、倦怠感あり"
                className="w-full px-3 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <p className="text-xs text-zinc-400 mt-1">
                ※ 翌日欠勤として記録されます
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={nextAvail === null || isPending}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-semibold transition-colors"
          >
            {isPending ? "送信中..." : "報告する"}
          </button>
        </div>
      </div>
    </main>
  );
}
