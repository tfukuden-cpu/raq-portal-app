"use client";

import { useState, useTransition, useMemo, useRef } from "react";
import { ChevronRightIcon } from "@/components/icons";
import { createNoticeAction } from "../actions";

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
  attachment_url: string | null;
  attachment_name: string | null;
};

type ModalState =
  | { type: "none" }
  | { type: "create" };

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

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"]);

function isImageFile(name: string | null): boolean {
  if (!name) return false;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
  );
}

function XSmallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}

// ── 投稿・編集モーダル ──────────────────────────────────────────
function NoticeModal({
  members, onClose,
}: {
  modal: ModalState;
  members: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError]            = useState<string | null>(null);
  const [title, setTitle]            = useState("");
  const [body, setBody]              = useState("");
  const [isPinned, setIsPinned]      = useState(false);
  const [targetMode, setTargetMode]  = useState<"all" | "person">("all");
  const [targetStaffId, setTargetStaffId] = useState("");
  const [memberSearch, setMemberSearch]   = useState("");
  const [sendLine, setSendLine]      = useState(true);
  const [useCustomDate, setUseCustomDate] = useState(false);
  const [customDate, setCustomDate]  = useState("");

  // 添付ファイル
  const [attachFile, setAttachFile]      = useState<File | null>(null);
  const [attachPreview, setAttachPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return members;
    return members.filter(m => m.name.includes(memberSearch.trim()));
  }, [members, memberSearch]);

  const selectedMember = members.find(m => m.id === targetStaffId);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    setAttachFile(file);
    if (isImageFile(file.name)) {
      setAttachPreview(URL.createObjectURL(file));
    } else {
      setAttachPreview(null);
    }
    e.target.value = "";
  };

  const clearAttachment = () => {
    if (attachPreview) URL.revokeObjectURL(attachPreview);
    setAttachFile(null);
    setAttachPreview(null);
  };

  const handleSubmit = (formData: FormData) => {
    setError(null);
    if (targetMode === "person" && !targetStaffId) {
      setError("送信先のスタッフを選択してください");
      return;
    }
    formData.set("title", title);
    formData.set("body", body);
    formData.set("isPinned", String(isPinned));
    formData.set("sendLine", String(sendLine));
    formData.set("targetStaffId", targetMode === "person" ? targetStaffId : "");
    formData.set("customDate", useCustomDate ? customDate : "");
    if (attachFile) formData.set("attachment", attachFile);

    startTransition(async () => {
      const r = await createNoticeAction(formData);
      if (!r.success) setError(r.message ?? "失敗しました");
      else { clearAttachment(); onClose(); }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-20 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl max-w-lg w-full p-5 shadow-xl max-h-[92dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-bold mb-4 text-zinc-900 dark:text-zinc-50">
          お知らせを投稿
        </h2>
        <form action={handleSubmit} className="space-y-4">
          {/* 宛先選択 */}
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

          {/* 添付ファイル */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">添付ファイル（画像・PDF 等、最大 20MB）</label>
            {attachFile ? (
              <div className="space-y-2">
                {attachPreview ? (
                  <div className="relative inline-block">
                    <img src={attachPreview} alt="プレビュー"
                      className="max-h-40 rounded-xl border border-zinc-200 dark:border-zinc-700 object-cover" />
                    <button type="button" onClick={clearAttachment}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-zinc-700 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors">
                      <XSmallIcon />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <PaperclipIcon />
                    <span className="text-xs text-zinc-700 dark:text-zinc-300 flex-1 truncate">{attachFile.name}</span>
                    <button type="button" onClick={clearAttachment}
                      className="text-zinc-400 hover:text-red-500 transition-colors flex-shrink-0">
                      <XSmallIcon />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer transition-colors text-xs">
                <PaperclipIcon />
                クリックしてファイルを選択
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
              </label>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={isPinned} onChange={e => setIsPinned(e.target.checked)}
              className="w-4 h-4 rounded accent-blue-600" />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">上部に固定する</span>
          </label>

          {/* 過去日時指定 */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
              <input type="checkbox" checked={useCustomDate} onChange={e => setUseCustomDate(e.target.checked)}
                className="w-4 h-4 rounded accent-blue-600" />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">過去の日時を指定する</span>
            </label>
            {useCustomDate && (
              <input
                type="datetime-local"
                value={customDate}
                onChange={e => setCustomDate(e.target.value)}
                max={new Date().toISOString().slice(0, 16)}
                required={useCustomDate}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
              />
            )}
          </div>

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
          {sendLine && (
            <p className="text-[11px] text-zinc-400 -mt-2 ml-6">
              「内容を見る」ボタン付きで送信されます
            </p>
          )}

          {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm">
              キャンセル
            </button>
            <button type="submit" disabled={isPending}
              className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium">
              {isPending ? "送信中..." : "投稿"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── メインコンポーネント ──────────────────────────────────────────
export default function NoticesManageClient({
  notices,
  members,
}: {
  notices: Notice[];
  members: { id: string; name: string }[];
}) {
  const [modal, setModal]               = useState<ModalState>({ type: "none" });
  const [recipientSearch, setRecipientSearch] = useState("");
  const [expandedIds, setExpandedIds]   = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = recipientSearch.trim();
    if (!q) return notices;
    return notices.filter(n => {
      const target = n.target_name ?? "全員";
      const poster = n.poster_name;
      return target.includes(q) || poster.includes(q) || n.title.includes(q);
    });
  }, [notices, recipientSearch]);

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
            placeholder="宛先・送信者・件名で検索…"
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

      {/* 件数 */}
      {filtered.length > 0 && (
        <p className="text-[11px] text-zinc-400 mb-2 tabular-nums">
          {filtered.length} 件
        </p>
      )}

      {/* 送信履歴一覧 */}
      <div className="space-y-2">
        {filtered.length > 0 ? (
          filtered.map(n => {
            const isExpanded = expandedIds.has(n.id);
            const hasAttachment = !!n.attachment_url;
            return (
              <div
                key={n.id}
                className={`rounded-xl border bg-white dark:bg-zinc-950 transition-colors overflow-hidden ${
                  n.is_pinned
                    ? "border-blue-200 dark:border-blue-800"
                    : "border-zinc-100 dark:border-zinc-800"
                }`}
              >
                {/* 行1: 送信時間 · 送信先 · 送信者 */}
                <div className="flex items-center gap-2 px-3 pt-2.5 pb-0 flex-wrap">
                  <span className="text-[11px] text-zinc-400 tabular-nums font-medium">
                    {formatDateTime(n.created_at)}
                  </span>
                  <span className="text-zinc-300 dark:text-zinc-600 text-[11px]">·</span>
                  {n.target_name ? (
                    <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                      {n.target_name}
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-400">全員</span>
                  )}
                  <span className="text-zinc-300 dark:text-zinc-600 text-[11px]">·</span>
                  <span className="text-[11px] text-zinc-400">{n.poster_name}</span>
                  {hasAttachment && (
                    <span className="text-[10px] text-zinc-400 flex items-center gap-0.5 ml-1">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
                        strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                      </svg>
                      添付
                    </span>
                  )}
                  {n.is_pinned && (
                    <span className="text-[10px] font-semibold text-blue-500 border border-blue-200 dark:border-blue-700 rounded px-1.5 py-0.5 leading-none ml-auto">
                      固定
                    </span>
                  )}
                </div>

                {/* 行2: 件名 + トグル */}
                <button
                  type="button"
                  onClick={() => toggleExpand(n.id)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                >
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate flex-1">
                    {n.title}
                  </span>
                  <svg
                    className={`w-4 h-4 text-zinc-400 flex-shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* 行3: 投稿内容（展開時） */}
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-zinc-100 dark:border-zinc-800">
                    <pre className="text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-300 leading-relaxed font-sans py-3 max-h-60 overflow-y-auto">
                      {n.body}
                    </pre>
                    {/* 添付ファイル */}
                    {n.attachment_url && (
                      <div className="mt-2">
                        {isImageFile(n.attachment_name) ? (
                          <a href={n.attachment_url} target="_blank" rel="noopener noreferrer">
                            <img src={n.attachment_url} alt={n.attachment_name ?? "添付画像"}
                              className="max-h-60 rounded-xl border border-zinc-200 dark:border-zinc-700 object-cover hover:opacity-95 transition-opacity" />
                          </a>
                        ) : (
                          <a href={n.attachment_url} target="_blank" rel="noopener noreferrer"
                            download={n.attachment_name ?? undefined}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
                              strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 flex-shrink-0">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="7 10 12 15 17 10"/>
                              <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            {n.attachment_name ?? "添付ファイルをダウンロード"}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-10 text-center">
            {recipientSearch ? (
              <p className="text-sm text-zinc-500">「{recipientSearch}」に該当する送信履歴がありません</p>
            ) : (
              <>
                <p className="text-sm text-zinc-500">まだ周知事項がありません</p>
                <button type="button" onClick={() => setModal({ type: "create" })}
                  className="text-sm text-blue-600 hover:text-blue-700 mt-2 inline-block">
                  <span className="inline-flex items-center gap-1">
                    最初のお知らせを投稿する
                    <ChevronRightIcon className="w-3.5 h-3.5" />
                  </span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 投稿モーダル */}
      {modal.type === "create" && (
        <NoticeModal modal={modal} members={members} onClose={() => setModal({ type: "none" })} />
      )}
    </>
  );
}
