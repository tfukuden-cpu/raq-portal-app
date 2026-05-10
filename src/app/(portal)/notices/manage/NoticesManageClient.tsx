"use client";

import { useState, useTransition } from "react";
import { ChevronRightIcon } from "@/components/icons";
import { createNoticeAction, updateNoticeAction, deleteNoticeAction } from "../actions";

type Notice = {
  id: string;
  title: string;
  body: string;
  is_pinned: boolean;
  created_at: string;
  posted_by: string;
  poster_name: string;
};

type ModalState =
  | { type: "none" }
  | { type: "create" }
  | { type: "edit"; notice: Notice }
  | { type: "delete"; notice: Notice };

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

function NoticeModal({
  modal,
  onClose,
}: {
  modal: ModalState;
  onClose: () => void;
}) {
  const isEdit = modal.type === "edit";
  const existing = isEdit ? modal.notice : null;

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [isPinned, setIsPinned] = useState(existing?.is_pinned ?? false);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    formData.set("title", title);
    formData.set("body", body);
    formData.set("isPinned", String(isPinned));
    if (isEdit) formData.set("id", existing!.id);

    startTransition(async () => {
      const r = isEdit
        ? await updateNoticeAction(formData)
        : await createNoticeAction(formData);
      if (!r.success) {
        setError(r.message ?? "失敗しました");
      } else {
        onClose();
      }
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-20 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-lg max-w-lg w-full p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4 text-zinc-900 dark:text-zinc-50">
          {isEdit ? "お知らせを編集" : "お知らせを投稿"}
        </h2>

        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              タイトル
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：〇〇のお知らせ"
              className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              本文
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="お知らせの内容を入力してください"
              rows={5}
              className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none"
              required
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(e) => setIsPinned(e.target.checked)}
              className="w-4 h-4 rounded accent-blue-600"
            />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              📌 上部に固定する
            </span>
          </label>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium"
            >
              {isPending ? "保存中..." : isEdit ? "更新" : "投稿"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function NoticesManageClient({ notices }: { notices: Notice[] }) {
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [isPending, startTransition] = useTransition();

  const handleDeleteConfirm = (notice: Notice) => {
    const fd = new FormData();
    fd.set("id", notice.id);
    startTransition(async () => {
      await deleteNoticeAction(fd);
      setModal({ type: "none" });
    });
  };

  return (
    <>
      {/* 投稿ボタン */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setModal({ type: "create" })}
          className="text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white"
        >
          ＋ 投稿
        </button>
      </div>

      {/* 一覧 */}
      <div className="space-y-3">
        {notices.length > 0 ? (
          notices.map((n) => (
            <div
              key={n.id}
              className={`bg-white dark:bg-zinc-900 border rounded-lg p-4 ${
                n.is_pinned
                  ? "border-blue-300 dark:border-blue-700"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  {n.is_pinned && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 flex-shrink-0 mt-0.5">
                      📌
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50 truncate">
                      {n.title}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2 whitespace-pre-wrap">
                      {n.body}
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">
                      {n.poster_name} · {formatDateTime(n.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setModal({ type: "edit", notice: n })}
                    className="text-xs text-zinc-400 hover:text-blue-600 px-2 py-1"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal({ type: "delete", notice: n })}
                    disabled={isPending}
                    className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50 px-2 py-1"
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-10 text-center">
            <p className="text-sm text-zinc-500">まだお知らせがありません</p>
            <button
              type="button"
              onClick={() => setModal({ type: "create" })}
              className="text-sm text-blue-600 hover:text-blue-700 mt-2 inline-block"
            >
              <span className="inline-flex items-center gap-1">最初のお知らせを投稿する <ChevronRightIcon className="w-3.5 h-3.5" /></span>
            </button>
          </div>
        )}
      </div>

      {/* 投稿・編集モーダル */}
      {(modal.type === "create" || modal.type === "edit") && (
        <NoticeModal modal={modal} onClose={() => setModal({ type: "none" })} />
      )}

      {/* 削除確認モーダル */}
      {modal.type === "delete" && (
        <div
          className="fixed inset-0 bg-black/50 z-20 flex items-center justify-center p-4"
          onClick={() => setModal({ type: "none" })}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-lg max-w-sm w-full p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 mb-2">
              お知らせを削除しますか？
            </h2>
            <p className="text-sm text-zinc-500 mb-5 line-clamp-2">
              「{modal.notice.title}」を削除します。この操作は元に戻せません。
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setModal({ type: "none" })}
                className="flex-1 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => handleDeleteConfirm(modal.notice)}
                disabled={isPending}
                className="flex-1 py-2 rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium"
              >
                {isPending ? "削除中..." : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
