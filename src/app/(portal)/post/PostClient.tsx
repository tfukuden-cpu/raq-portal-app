"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPostAction, deletePostAction } from "./actions";

type Post = {
  id: string;
  body: string;
  created_at: string;
  staffId: string;
  posterName: string;
};

type Props = {
  posts: Post[];
  currentStaffId: string;
  isAdmin: boolean;
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function PostClient({ posts, currentStaffId, isAdmin }: Props) {
  const router = useRouter();

  // 投稿フォーム
  const [body, setBody]             = useState("");
  const [formError, setFormError]   = useState<string | null>(null);
  const [isPosting, startPostTrans] = useTransition();

  const handlePost = () => {
    if (!body.trim()) { setFormError("本文を入力してください"); return; }
    setFormError(null);
    const fd = new FormData();
    fd.set("body", body.trim());
    startPostTrans(async () => {
      const result = await createPostAction(fd);
      if (!result.success) {
        setFormError(result.message ?? "投稿失敗");
      } else {
        setBody("");
        router.refresh();
      }
    });
  };

  // 削除
  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const [, startDeleteTrans]            = useTransition();

  const handleDelete = (id: string) => {
    if (!confirm("この投稿を削除しますか？")) return;
    setDeletingId(id);
    const fd = new FormData();
    fd.set("id", id);
    startDeleteTrans(async () => {
      await deletePostAction(fd);
      setDeletingId(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">

      {/* 投稿フォーム */}
      <div className="bg-zinc-50 dark:bg-zinc-900 rounded-2xl p-4 space-y-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="今日の報告や連絡を入力してください…"
          rows={4}
          maxLength={2000}
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-400 tabular-nums">{body.length} / 2000</span>
          <div className="flex items-center gap-2">
            {formError && <p className="text-xs text-red-500">{formError}</p>}
            <button
              type="button"
              onClick={handlePost}
              disabled={isPosting || !body.trim()}
              className="text-sm font-semibold px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white transition-colors"
            >
              {isPosting ? "投稿中…" : "投稿する"}
            </button>
          </div>
        </div>
      </div>

      {/* 投稿一覧 */}
      {posts.length === 0 ? (
        <div className="bg-zinc-50 dark:bg-zinc-900 rounded-2xl p-10 text-center">
          <p className="text-sm text-zinc-400">投稿はまだありません</p>
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => {
            const isOwn = p.staffId === currentStaffId;
            const canDelete = isOwn || isAdmin;
            return (
              <article
                key={p.id}
                className="bg-zinc-50 dark:bg-zinc-900 rounded-2xl px-5 py-4 space-y-2"
              >
                {/* ヘッダー：投稿者・日時 */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                      {p.posterName}
                    </span>
                    {isOwn && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 font-medium">
                        自分
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-400 tabular-nums">
                      {formatDateTime(p.created_at)}
                    </span>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id)}
                        disabled={deletingId === p.id}
                        className="text-xs text-zinc-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 transition-colors"
                      >
                        {deletingId === p.id ? "削除中…" : "削除"}
                      </button>
                    )}
                  </div>
                </div>

                {/* 本文 */}
                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                  {p.body}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
