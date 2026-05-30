"use client";

import { useState, useTransition, useMemo } from "react";
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
  target_staff_id: string | null;
  target_name: string | null;
};

type ModalState =
  | { type: "none" }
  | { type: "create" }
  | { type: "edit"; notice: Notice }
  | { type: "delete"; notice: Notice }
  | { type: "detail"; notice: Notice };

function formatDate(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

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
  modal, members, onClose,
}: {
  modal: ModalState;
  members: { id: string; name: string }[];
  onClose: () => void;
}) {
  const isEdit = modal.type === "edit";
  const existing = isEdit ? (modal as { type: "edit"; notice: Notice }).notice : null;

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [isPinned, setIsPinned] = useState(existing?.is_pinned ?? false);
  // 新規投稿のみの追加フィールド
  const [targetMode, setTargetMode] = useState<"all" | "person">("all");
  const [targetStaffId, setTargetStaffId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [sendLine, setSendLine] = useState(true);

  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return members;
    return members.filter(m => m.name.includes(memberSearch.trim()));
  }, [members, memberSearch]);

  const selectedMember = members.find(m => m.id === targetStaffId);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    if (!isEdit && targetMode === "person" && !targetStaffId) {
      setError("送信先のスタッフを選択してください");
      return;
    }
    formData.set("title", title);
    formData.set("body", body);
    formData.set("isPinned", String(isPinned));
    if (isEdit) {
      formData.set("id", existing!.id);
    } else {
      formData.set("sendLine", String(sendLine));
      formData.set("targetStaffId", targetMode === "person" ? targetStaffId : "");
    }

    startTransition(async () => {
      const r = isEdit ? await updateNoticeAction(formData) : await createNoticeAction(formData);
      if (!r.success) setError(r.message ?? "失敗しました");
      else onClose();
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-20 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl max-w-lg w-full p-5 shadow-xl max-h-[92dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-bold mb-4 text-zinc-900 dark:text-zinc-50">
          {isEdit ? "お知らせを編集" : "お知らせを投稿"}
        </h2>
        <form action={handleSubmit} className="space-y-4">
          {/* 宛先選択（新規のみ） */}
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">宛先</label>
              <div className="flex gap-2 mb-2">
                <button type="button"
                  onClick={() => { setTargetMode("all"); setTargetStaffId(""); }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    targetMode === "all"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}>
                  全員
                </button>
                <button type="button"
                  onClick={() => setTargetMode("person")}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    targetMode === "person"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}>
                  特定のスタッフ
                </button>
              </div>
              {targetMode === "person" && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={e => setMemberSearch(e.target.value)}
                    placeholder="名前で検索…"
                    className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
                  />
                  {selectedMember && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                      <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 flex-1">{selectedMember.name}</span>
                      <button type="button" onClick={() => setTargetStaffId("")} className="text-blue-400 hover:text-blue-600 text-xs">✕</button>
                    </div>
                  )}
                  {!selectedMember && filteredMembers.length > 0 && (
                    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden max-h-36 overflow-y-auto">
                      {filteredMembers.map(m => (
                        <button key={m.id} type="button"
                          onClick={() => { setTargetStaffId(m.id); setMemberSearch(""); }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 text-zinc-700 dark:text-zinc-300">
                          {m.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">タイトル</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="例：〇〇のお知らせ"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">本文</label>
            <textarea value={body} onChange={e => setBody(e.target.value)}
              placeholder="お知らせの内容を入力してください" rows={5}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none" required />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={isPinned} onChange={e => setIsPinned(e.target.checked)}
              className="w-4 h-4 rounded accent-blue-600" />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">📌 上部に固定する</span>
          </label>

          {/* LINE通知（新規のみ） */}
          {!isEdit && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={sendLine} onChange={e => setSendLine(e.target.checked)}
                className="w-4 h-4 rounded accent-blue-600" />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                LINEでも通知する
                <span className="text-xs text-zinc-400 ml-1">
                  （{targetMode === "all" ? "全LINE連携スタッフ" : selectedMember ? selectedMember.name : "選択中の1人"}へ）
                </span>
              </span>
            </label>
          )}

          {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm">
              キャンセル
            </button>
            <button type="submit" disabled={isPending}
              className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium">
              {isPending ? "保存中..." : isEdit ? "更新" : "投稿"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function NoticesManageClient({ notices, members }: { notices: Notice[]; members: { id: string; name: string }[] }) {
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [isPending, startTransition] = useTransition();
  const [recipientSearch, setRecipientSearch] = useState("");

  const filtered = useMemo(() => {
    const q = recipientSearch.trim();
    if (!q) return notices;
    return notices.filter(n => {
      const target = n.target_name ?? "全員";
      return target.includes(q);
    });
  }, [notices, recipientSearch]);

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
      {/* 検索 + 投稿ボタン */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={recipientSearch}
            onChange={e => setRecipientSearch(e.target.value)}
            placeholder="宛先で検索…（名前 または「全員」）"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {recipientSearch && (
            <button onClick={() => setRecipientSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button type="button" onClick={() => setModal({ type: "create" })}
          className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">
          ＋ 投稿
        </button>
      </div>

      {/* ヘッダー行 */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-[6rem_7rem_1fr_auto] gap-x-3 px-3 py-1.5 mb-1">
          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">送信日時</span>
          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">宛先</span>
          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">お知らせ</span>
          <span />
        </div>
      )}

      {/* 一覧 */}
      <div className="space-y-1.5">
        {filtered.length > 0 ? (
          filtered.map(n => (
            <div
              key={n.id}
              className={`grid grid-cols-[6rem_7rem_1fr_auto] gap-x-3 items-start px-3 py-3 rounded-xl border bg-white dark:bg-zinc-950 transition-colors cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                n.is_pinned
                  ? "border-blue-200 dark:border-blue-800"
                  : "border-zinc-100 dark:border-zinc-800"
              }`}
              onClick={() => setModal({ type: "detail", notice: n })}
            >
              {/* 送信日時 */}
              <div className="flex flex-col tabular-nums">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{formatDate(n.created_at)}</span>
                <span className="text-[11px] text-zinc-400">{formatTime(n.created_at)}</span>
              </div>

              {/* 宛先 */}
              <div className="flex items-start pt-0.5">
                {n.target_name ? (
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 truncate">
                    {n.target_name}
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">全員</span>
                )}
              </div>

              {/* お知らせ */}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {n.is_pinned && (
                    <span className="text-[10px] text-blue-500 flex-shrink-0">📌</span>
                  )}
                  <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">{n.title}</p>
                </div>
                <p className="text-[11px] text-zinc-400 truncate mt-0.5">{n.body.split("\n")[0]}</p>
              </div>

              {/* 操作 */}
              <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                <button type="button" onClick={() => setModal({ type: "edit", notice: n })}
                  className="text-[11px] text-zinc-400 hover:text-blue-600 px-2 py-1 rounded">
                  編集
                </button>
                <button type="button" onClick={() => setModal({ type: "delete", notice: n })}
                  disabled={isPending}
                  className="text-[11px] text-zinc-400 hover:text-red-500 disabled:opacity-50 px-2 py-1 rounded">
                  削除
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-10 text-center">
            {recipientSearch ? (
              <p className="text-sm text-zinc-500">「{recipientSearch}」に該当するお知らせがありません</p>
            ) : (
              <>
                <p className="text-sm text-zinc-500">まだお知らせがありません</p>
                <button type="button" onClick={() => setModal({ type: "create" })}
                  className="text-sm text-blue-600 hover:text-blue-700 mt-2 inline-block">
                  <span className="inline-flex items-center gap-1">最初のお知らせを投稿する <ChevronRightIcon className="w-3.5 h-3.5" /></span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 詳細モーダル */}
      {modal.type === "detail" && (
        <div className="fixed inset-0 bg-black/50 z-20 flex items-center justify-center p-4" onClick={() => setModal({ type: "none" })}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-lg w-full p-5 shadow-xl space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1 flex-1 min-w-0">
                <p className="text-xs text-zinc-400">
                  {formatDateTime(modal.notice.created_at)} · {modal.notice.poster_name}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">{modal.notice.title}</h3>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                    modal.notice.target_name
                      ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                  }`}>
                    宛先：{modal.notice.target_name ?? "全員"}
                  </span>
                </div>
              </div>
              <button onClick={() => setModal({ type: "none" })} className="text-zinc-400 hover:text-zinc-600 p-1 flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <pre className="text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 leading-relaxed font-sans bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3 max-h-64 overflow-y-auto">
              {modal.notice.body}
            </pre>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setModal({ type: "edit", notice: modal.notice })}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                編集
              </button>
              <button type="button" onClick={() => setModal({ type: "delete", notice: modal.notice })}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20">
                削除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 投稿・編集モーダル */}
      {(modal.type === "create" || modal.type === "edit") && (
        <NoticeModal modal={modal} members={members} onClose={() => setModal({ type: "none" })} />
      )}

      {/* 削除確認モーダル */}
      {modal.type === "delete" && (
        <div className="fixed inset-0 bg-black/50 z-20 flex items-center justify-center p-4" onClick={() => setModal({ type: "none" })}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-sm w-full p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 mb-2">お知らせを削除しますか？</h2>
            <p className="text-sm text-zinc-500 mb-5 line-clamp-2">「{modal.notice.title}」を削除します。この操作は元に戻せません。</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setModal({ type: "none" })}
                className="flex-1 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm">
                キャンセル
              </button>
              <button type="button" onClick={() => handleDeleteConfirm(modal.notice)} disabled={isPending}
                className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium">
                {isPending ? "削除中..." : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
