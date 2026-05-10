"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProjectAction } from "./actions";
import { GridIcon, CloseIcon } from "@/components/icons";

type Project = { id: string; name: string; sheetUrl: string | null };

function SheetIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

export default function ProjectList({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const confirmProject = projects.find((p) => p.id === confirmId);

  const handleDelete = () => {
    if (!confirmId) return;
    const fd = new FormData();
    fd.set("projectId", confirmId);
    startTransition(async () => {
      const r = await deleteProjectAction(fd);
      if (r.success) {
        setConfirmId(null);
        router.refresh();
      } else {
        setError(r.message ?? "削除に失敗しました");
      }
    });
  };

  if (projects.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl p-12 text-center">
        <GridIcon className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
        <p className="text-sm text-zinc-400">アクティブな案件がありません</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2.5">
        {projects.map((p) => (
          <div key={p.id} className="relative">
            {/* カード全体がリンク */}
            <a
              href={`/admin/${p.id}`}
              className="flex items-center gap-4 bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl shadow-sm px-5 py-4 hover:shadow-md hover:-translate-y-0.5 transition-all pr-14"
            >
              <div className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 flex items-center justify-center flex-shrink-0">
                <GridIcon className="w-4 h-4 text-zinc-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-zinc-900 dark:text-zinc-50 truncate leading-tight">
                  {p.name}
                </p>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">{p.id}</p>
                {p.sheetUrl && (
                  <span className="inline-flex items-center gap-1 mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                    <SheetIcon className="w-3 h-3" />
                    スプシ連携済み
                  </span>
                )}
              </div>
            </a>

            {/* 削除ボタン（絶対配置でリンクの外に出す） */}
            <button
              type="button"
              onClick={() => { setConfirmId(p.id); setError(null); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-950/50 hover:border-red-100 dark:hover:border-red-900 transition-colors group"
              title="削除"
            >
              <CloseIcon className="w-3.5 h-3.5 text-zinc-400 group-hover:text-red-500 transition-colors" />
            </button>
          </div>
        ))}
      </div>

      {/* 削除確認モーダル */}
      {confirmId && confirmProject && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => !isPending && setConfirmId(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">
              案件を削除しますか？
            </h2>
            <p className="text-sm text-zinc-500 mb-1">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">{confirmProject.name}</span>
            </p>
            <p className="text-xs text-zinc-400 mb-5">
              削除すると案件一覧から非表示になります。
            </p>

            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmId(null)}
                disabled={isPending}
                className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500 disabled:opacity-40"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="flex-1 py-3 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold disabled:opacity-40 transition-colors"
              >
                {isPending ? "削除中…" : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
