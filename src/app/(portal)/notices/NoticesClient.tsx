"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markNoticeReadAction, createNoticeAction, deleteNoticeAction } from "./actions";

type Notice = {
  id: string;
  title: string;
  body: string;
  is_pinned: boolean;
  created_at: string;
  posterName: string;
};

type Props = {
  notices: Notice[];
  readIds: string[];
  isAdmin: boolean;
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function NoticesClient({ notices, readIds, isAdmin }: Props) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set(readIds));

  // 確認済み
  const [, startReadTransition] = useTransition();
  const handleConfirm = (noticeId: string) => {
    setConfirmed((prev) => new Set([...prev, noticeId]));
    startReadTransition(async () => {
      await markNoticeReadAction(noticeId);
    });
  };

  // 追加モーダル
  const [showAdd, setShowAdd]   = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addBody, setAddBody]   = useState("");
  const [addPinned, setAddPinned] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, startAddTransition] = useTransition();

  const openAdd = () => {
    setAddTitle(""); setAddBody(""); setAddPinned(false); setAddError(null);
    setShowAdd(true);
  };
  const closeAdd = () => setShowAdd(false);

  const handleCreate = () => {
    if (!addTitle.trim() || !addBody.trim()) {
      setAddError("タイトルと本文は必須です");
      return;
    }
    setAddError(null);
    const fd = new FormData();
    fd.set("title", addTitle.trim());
    fd.set("body", addBody.trim());
    fd.set("isPinned", String(addPinned));
    startAddTransition(async () => {
      const result = await createNoticeAction(fd);
      if (!result.success) {
        setAddError(result.message ?? "投稿失敗");
      } else {
        setShowAdd(false);
        router.refresh();
      }
    });
  };

  // 削除
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDeleteTransition] = useTransition();

  const handleDelete = (id: string) => {
    if (!confirm("このお知らせを削除しますか？")) return;
    setDeletingId(id);
    const fd = new FormData();
    fd.set("id", id);
    startDeleteTransition(async () => {
      await deleteNoticeAction(fd);
      setDeletingId(null);
      router.refresh();
    });
  };

  return (
    <>
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-[#F5F5F7]/90 dark:bg-zinc-950/90 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-5 pt-5 pb-4 flex items-center justify-between gap-3">
          <h1 className="text-[26px] font-bold tracking-tight text-zinc-900 dark:text-zinc-50">お知らせ</h1>
          {isAdmin && (
            <button
              type="button"
              onClick={openAdd}
              className="text-[13px] font-semibold px-4 py-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 transition-colors active:bg-zinc-700"
            >
              ＋ 追加
            </button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pt-4 pb-24 space-y-2.5">
      {notices.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 rounded-2xl p-12 text-center shadow-sm">
          <p className="text-[14px] text-zinc-400">お知らせはありません</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {notices.map((n) => {
            const isRead = confirmed.has(n.id);
            return (
              <article
                key={n.id}
                className={`rounded-2xl p-5 border shadow-sm transition-opacity ${
                  n.is_pinned
                    ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200/70 dark:border-blue-900"
                    : "bg-white dark:bg-zinc-900 border-zinc-200/70 dark:border-zinc-800"
                } ${isRead ? "opacity-50" : ""}`}
              >
                {/* タイトル行 */}
                <div className="flex items-start gap-2 mb-2">
                  {n.is_pinned && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500 text-white font-bold flex-shrink-0 mt-0.5 tracking-wide">
                      固定
                    </span>
                  )}
                  <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 leading-snug flex-1">
                    {n.title}
                  </h2>
                </div>

                {/* 本文 */}
                <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed mb-4">
                  {n.body}
                </p>

                {/* フッター */}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-zinc-400">
                    {n.posterName} · {formatDateTime(n.created_at)}
                    {isRead && <span className="ml-2 text-emerald-500">✓ 確認済</span>}
                  </p>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDelete(n.id)}
                        disabled={deletingId === n.id}
                        className="text-xs text-zinc-400 hover:text-red-500 disabled:opacity-40 transition-colors"
                      >
                        {deletingId === n.id ? "削除中…" : "削除"}
                      </button>
                    )}
                    {!isRead ? (
                      <button
                        type="button"
                        onClick={() => handleConfirm(n.id)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 transition-colors"
                      >
                        確認
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* 追加モーダル */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          onClick={closeAdd}
        >
          <div
            className="bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 rounded-2xl w-full max-w-md p-5 shadow-2xl shadow-black/20 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">お知らせを追加</h2>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                タイトル <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
                placeholder="お知らせのタイトル"
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                本文 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={addBody}
                onChange={(e) => setAddBody(e.target.value)}
                placeholder="お知らせの内容を入力してください"
                rows={5}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={addPinned}
                onChange={(e) => setAddPinned(e.target.checked)}
                className="w-4 h-4 rounded accent-blue-600"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">ピン留めする（常に上部に固定）</span>
            </label>

            {addError && <p className="text-sm text-red-600 dark:text-red-400">{addError}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeAdd}
                className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={isAdding}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {isAdding ? "投稿中..." : "投稿する"}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>{/* /max-w-5xl content */}
    </>
  );
}
