"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { departStaffAction } from "@/app/(portal)/admin/[projectId]/settings/actions";

type Props = {
  staffId: string;
  staffName: string;
  projectId: string;
  onClose: () => void;
};

export default function StaffPopupMenu({ staffId, staffName, projectId, onClose }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<"menu" | "departure">("menu");
  const [departDate, setDepartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDepart() {
    setError(null);
    startTransition(async () => {
      const result = await departStaffAction(projectId, staffId, departDate);
      if (result.success) {
        router.refresh();
        onClose();
      } else {
        setError(result.message ?? "エラーが発生しました");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-t-2xl overflow-hidden"
        style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {step === "menu" && (
          <>
            {/* ヘッダー */}
            <div className="px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">スタッフ</p>
              <p className="text-base font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">{staffName}</p>
            </div>

            {/* メニュー */}
            <div className="p-2">
              <Link
                href={`/admin/${projectId}/settings?tab=members&edit=${staffId}`}
                onClick={onClose}
                className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">メンバー設定</span>
              </Link>

              <button
                type="button"
                onClick={() => setStep("departure")}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-red-600 dark:text-red-400">離脱処理</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 text-sm font-semibold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors border-t border-zinc-100 dark:border-zinc-800"
            >
              キャンセル
            </button>
          </>
        )}

        {step === "departure" && (
          <>
            <div className="px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">{staffName} の離脱処理</p>
              <p className="text-xs text-zinc-400 mt-0.5">最終出勤日の翌日以降のシフトが削除されます</p>
            </div>

            <div className="px-4 pt-4 pb-2">
              <label className="text-xs font-semibold text-zinc-500 block mb-1.5">最終出勤日（この日までシフトを保持）</label>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() - 1);
                    setDepartDate(d.toISOString().slice(0, 10));
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800"
                >
                  即時（今すぐ）
                </button>
              </div>
              <input
                type="date"
                value={departDate}
                onChange={(e) => setDepartDate(e.target.value)}
                className="w-full border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              />
              {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
            </div>

            <div className="flex gap-2 px-4 pt-2 pb-4">
              <button
                type="button"
                onClick={() => setStep("menu")}
                className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                戻る
              </button>
              <button
                type="button"
                onClick={handleDepart}
                disabled={isPending || !departDate}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold disabled:opacity-40 transition-colors"
              >
                {isPending ? "処理中…" : "離脱を確定"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
