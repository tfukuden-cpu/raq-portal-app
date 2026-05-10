"use client";

import { useState, useTransition } from "react";
import { createProjectAction } from "./[projectId]/settings/actions";
import { PlusIcon } from "@/components/icons";

export default function NewProjectModal() {
  const [open, setOpen]               = useState(false);
  const [step, setStep]               = useState<1 | 2>(1);
  const [name, setName]               = useState("");
  const [managerName, setManagerName] = useState("");
  const [error, setError]             = useState<string | null>(null);
  const [isPending, startTransition]  = useTransition();

  const reset = () => { setName(""); setManagerName(""); setError(null); setStep(1); };
  const close = () => { setOpen(false); reset(); };

  const handleSubmit = () => {
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("managerName", managerName);

    startTransition(async () => {
      const r = await createProjectAction(fd);
      if (r.success) {
        window.location.href = "/admin";
      } else {
        setError(r.message ?? "エラーが発生しました");
        if (r.projectId) setTimeout(() => { window.location.href = "/admin"; }, 3000);
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
      >
        <PlusIcon className="w-4 h-4" />
        新規案件
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-end sm:items-center justify-center p-4"
          onClick={close}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex gap-1.5">
                  {([1, 2] as const).map((s) => (
                    <span
                      key={s}
                      className={`w-6 h-1.5 rounded-full transition-colors ${step >= s ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-700"}`}
                    />
                  ))}
                </div>
                <span className="text-xs text-zinc-400">{step} / 2</span>
              </div>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                {step === 1 ? "新規案件を作成" : "管理者アカウント"}
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {step === 1
                  ? "案件名を入力してください"
                  : "この案件を管理する管理者アカウントを発行します"}
              </p>
            </div>

            {/* コンテンツ */}
            <div className="px-6 py-5">

              {/* Step 1: 案件名 */}
              {step === 1 && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                    案件名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && name) setStep(2); }}
                    placeholder="例：〇〇ビル新築工事"
                    className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
              )}

              {/* Step 2: 管理者 */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3 text-xs text-blue-700 dark:text-blue-300 space-y-1">
                    <p>・社員IDは自動生成（A + 案件名頭文字 + 3桁）</p>
                    <p>・初期パスワード: <span className="font-mono font-bold">raq-init-2026</span></p>
                    <p>・空欄のまま作成し、後から案件設定で追加もできます</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                      管理者氏名
                    </label>
                    <input
                      type="text"
                      value={managerName}
                      onChange={(e) => setManagerName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                      placeholder="例：山田 太郎"
                      className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>
                </div>
              )}
            </div>

            {/* フッター */}
            <div className="px-6 pb-6 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2.5">
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={step === 1 ? close : () => setStep(1)}
                  className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  {step === 1 ? "キャンセル" : "← 戻る"}
                </button>
                {step === 1 ? (
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    disabled={!name.trim()}
                    className="flex-1 py-3 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold disabled:opacity-40 transition-colors"
                  >
                    次へ →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isPending}
                    className="flex-1 py-3 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold disabled:opacity-40 transition-colors"
                  >
                    {isPending ? "作成中…" : "作成する"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
