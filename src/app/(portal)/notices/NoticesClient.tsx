"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  markNoticeReadAction,
  createNoticeAction,
  deleteNoticeAction,
  addNoticeCommentAction,
  deleteNoticeCommentAction,
} from "./actions";
import {
  dotGothic,
  RPG_PAGE_BG,
  RPG_KEYFRAMES,
  RpgWindow,
  RpgStarfield,
} from "@/components/rpg-ui";

type Notice = {
  id: string;
  title: string;
  body: string;
  is_pinned: boolean;
  created_at: string;
  posterName: string;
  attachment_url: string | null;
  attachment_name: string | null;
};

type Comment = {
  id: string;
  noticeId: string;
  staffId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

type Props = {
  notices: Notice[];
  readIds: string[];
  comments: Comment[];
  myStaffId: string;
  isAdmin: boolean;
  initialOpenId?: string | null;
};

type TabKey = "all" | "unread";
const TABS: { key: TabKey; label: string }[] = [
  { key: "all",    label: "すべて" },
  { key: "unread", label: "みかくにん" },
];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"]);
function isImageFile(name: string | null): boolean {
  if (!name) return false;
  return IMAGE_EXTS.has(name.split(".").pop()?.toLowerCase() ?? "");
}

export default function NoticesClient({
  notices, readIds, comments, myStaffId, isAdmin, initialOpenId,
}: Props) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set(readIds));
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [search, setSearch]       = useState("");
  const [expanded, setExpanded]   = useState<string | null>(initialOpenId ?? null);

  // initialOpenId のカードに自動スクロール
  const articleRefs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (!initialOpenId) return;
    const el = articleRefs.current[initialOpenId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [initialOpenId]);

  const [, startReadTrans] = useTransition();
  const handleConfirm = (id: string) => {
    setConfirmed(prev => new Set([...prev, id]));
    startReadTrans(async () => { await markNoticeReadAction(id); });
  };

  // ── コメント ──────────────────────────────────────────
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [commentMsg, setCommentMsg]   = useState<{ ok: boolean; text: string } | null>(null);
  const [postingId, setPostingId]     = useState<string | null>(null);
  const [, startCommentTrans]         = useTransition();

  const commentsByNotice = (id: string) => comments.filter(c => c.noticeId === id);

  const handleAddComment = (noticeId: string) => {
    const text = (commentText[noticeId] ?? "").trim();
    if (!text) return;
    setPostingId(noticeId);
    const fd = new FormData();
    fd.set("noticeId", noticeId);
    fd.set("body", text);
    startCommentTrans(async () => {
      const r = await addNoticeCommentAction(fd);
      setPostingId(null);
      if (r.success) {
        setCommentText(prev => ({ ...prev, [noticeId]: "" }));
        setCommentMsg({ ok: true, text: "コメントを送信しました（管理者へ通知）" });
        router.refresh();
      } else {
        setCommentMsg({ ok: false, text: r.message ?? "送信に失敗しました" });
      }
    });
  };

  const handleDeleteComment = (id: string) => {
    if (!window.confirm("このコメントを削除しますか？")) return;
    const fd = new FormData();
    fd.set("id", id);
    startCommentTrans(async () => {
      await deleteNoticeCommentAction(fd);
      router.refresh();
    });
  };

  useEffect(() => {
    if (!commentMsg) return;
    const t = setTimeout(() => setCommentMsg(null), 4000);
    return () => clearTimeout(t);
  }, [commentMsg]);

  // ── 追加モーダル（管理者） ──────────────────────────────
  const [showAdd, setShowAdd]     = useState(false);
  const [addTitle, setAddTitle]   = useState("");
  const [addBody, setAddBody]     = useState("");
  const [addPinned, setAddPinned] = useState(false);
  const [addError, setAddError]   = useState<string | null>(null);
  const [isAdding, startAddTrans] = useTransition();

  const openAdd = () => { setAddTitle(""); setAddBody(""); setAddPinned(false); setAddError(null); setShowAdd(true); };

  const handleCreate = () => {
    if (!addTitle.trim() || !addBody.trim()) { setAddError("タイトルと本文は必須です"); return; }
    setAddError(null);
    const fd = new FormData();
    fd.set("title", addTitle.trim()); fd.set("body", addBody.trim()); fd.set("isPinned", String(addPinned));
    startAddTrans(async () => {
      const result = await createNoticeAction(fd);
      if (!result.success) setAddError(result.message ?? "投稿失敗");
      else { setShowAdd(false); router.refresh(); }
    });
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDeleteTrans]        = useTransition();
  const handleDelete = (id: string) => {
    if (!confirm("このお知らせを削除しますか？")) return;
    setDeletingId(id);
    const fd = new FormData(); fd.set("id", id);
    startDeleteTrans(async () => { await deleteNoticeAction(fd); setDeletingId(null); router.refresh(); });
  };

  // ── フィルタリング ─────────────────────────────────────
  const filtered = notices.filter(n => {
    const matchSearch = !search || n.title.toLowerCase().includes(search.toLowerCase()) || n.body.toLowerCase().includes(search.toLowerCase());
    const matchTab    = activeTab === "all" || !confirmed.has(n.id);
    return matchSearch && matchTab;
  });

  const unreadCount = notices.filter(n => !confirmed.has(n.id)).length;

  return (
    <>
      <main
        className={`min-h-[100dvh] md:h-dvh md:overflow-hidden flex flex-col ${dotGothic.className}`}
        style={{ background: RPG_PAGE_BG, backgroundAttachment: "fixed" }}
      >
        <style>{RPG_KEYFRAMES}</style>

        {/* ── 固定ヘッダー ── */}
        <div className="relative shrink-0 w-full px-4 md:px-8 pt-5 pb-3 overflow-hidden">
          <RpgStarfield />
          <div className="relative flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[20px] md:text-[22px] text-white">★ おしらせ</h1>
              {/* タブ */}
              <div className="flex items-center gap-1 rounded-lg border border-white/40 bg-[#000846]/80 p-1">
                {TABS.map(({ key, label }) => (
                  <button key={key} type="button" onClick={() => setActiveTab(key)}
                    className={`px-3 py-1 rounded-md text-[12px] transition-colors whitespace-nowrap ${
                      activeTab === key ? "bg-white text-[#000846] font-bold" : "text-white/70 hover:text-white"
                    }`}>
                    {label}
                    {key === "unread" && unreadCount > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold tabular-nums">{unreadCount}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="けんさく"
                className="w-36 md:w-44 px-3 py-2 rounded-lg border border-white/40 bg-[#000846]/80 text-[13px] text-white placeholder-white/40 focus:outline-none focus:border-white" />
              {isAdmin && (
                <button type="button" onClick={openAdd}
                  className="px-3 md:px-4 py-2 rounded-lg border-2 border-white text-white text-[13px] hover:bg-white/10 active:scale-95 transition">
                  ＋ ついか
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── スクロールエリア ── */}
        <div className="flex-1 md:min-h-0 md:overflow-y-auto px-4 md:px-8 pb-32 md:pb-8">
          <div className="max-w-3xl mx-auto space-y-4 pt-2">
            {filtered.length === 0 ? (
              <RpgWindow>
                <div className="px-5 py-10 text-center">
                  <p className="text-[14px] text-white/60">
                    {activeTab === "unread" ? "みかくにんの おしらせは ない" : "おしらせは ない"}
                  </p>
                </div>
              </RpgWindow>
            ) : filtered.map(n => {
              const isRead = confirmed.has(n.id);
              const isOpen = expanded === n.id;
              const cmts   = commentsByNotice(n.id);

              return (
                <article key={n.id} ref={el => { articleRefs.current[n.id] = el; }}>
                  <RpgWindow
                    title={n.is_pinned ? "じゅうよう" : undefined}
                    className={n.is_pinned ? "drop-shadow-[0_0_6px_rgba(252,211,77,0.35)]" : ""}
                  >
                    {/* カードヘッダー */}
                    <button type="button" className="w-full text-left px-4 py-4 md:px-5"
                      onClick={() => { setExpanded(isOpen ? null : n.id); if (!isRead) handleConfirm(n.id); }}>
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            {n.is_pinned && <span className="text-amber-300 text-[12px]">★</span>}
                            <span className="text-[12px] text-amber-300">{n.posterName}</span>
                            {n.attachment_url && (
                              <span className="text-[10px] text-cyan-300 border border-cyan-300/50 rounded px-1.5 py-0.5">📎 そえつけ</span>
                            )}
                            {cmts.length > 0 && (
                              <span className="text-[10px] text-white/70 border border-white/30 rounded px-1.5 py-0.5 tabular-nums">💬 {cmts.length}</span>
                            )}
                            <span className="text-[11px] text-white/40 tabular-nums">{fmtDateTime(n.created_at)}</span>
                          </div>
                          <p className="text-[15px] md:text-[16px] text-white leading-snug">{n.title}</p>
                          {!isOpen && (
                            <p className="text-[12px] text-white/50 line-clamp-2 leading-relaxed mt-1">{n.body}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {!isRead ? (
                            <span className="text-[10px] text-red-300 border border-red-400/60 rounded px-1.5 py-0.5">みかくにん</span>
                          ) : (
                            <span className="text-[10px] text-emerald-300">かくにんずみ</span>
                          )}
                          <span className="text-white/60 text-[13px]">{isOpen ? "▲" : "▼"}</span>
                        </div>
                      </div>
                    </button>

                    {/* 展開コンテンツ */}
                    {isOpen && (
                      <div className="px-4 pb-4 md:px-5 border-t border-white/15">
                        <p className="text-[13px] text-white/85 whitespace-pre-wrap leading-relaxed pt-4">{n.body}</p>

                        {/* 添付ファイル */}
                        {n.attachment_url && (
                          <div className="mt-4">
                            {isImageFile(n.attachment_name) ? (
                              <a href={n.attachment_url} target="_blank" rel="noopener noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={n.attachment_url} alt={n.attachment_name ?? "添付画像"}
                                  className="max-h-72 rounded-lg border border-white/20 object-cover cursor-pointer hover:opacity-90 transition-opacity" />
                              </a>
                            ) : (
                              <a href={n.attachment_url} target="_blank" rel="noopener noreferrer"
                                download={n.attachment_name ?? undefined}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/40 text-[12px] text-white hover:bg-white/10 transition-colors">
                                ▶ {n.attachment_name ?? "そえつけファイルを ダウンロード"}
                              </a>
                            )}
                          </div>
                        )}

                        {/* ── コメント欄 ── */}
                        <div className="mt-5 pt-4 border-t border-white/15">
                          <p className="text-[12px] text-cyan-300 mb-2.5">💬 コメント（{cmts.length}）</p>

                          {cmts.length > 0 && (
                            <div className="space-y-2 mb-3">
                              {cmts.map(c => {
                                const canDelete = isAdmin || c.staffId === myStaffId;
                                return (
                                  <div key={c.id} className="rounded-lg border border-white/15 bg-[#02061c]/60 px-3 py-2">
                                    <div className="flex items-center justify-between gap-2 mb-0.5">
                                      <span className="text-[11px] text-amber-300">{c.authorName}</span>
                                      <span className="flex items-center gap-2">
                                        <span className="text-[10px] text-white/40 tabular-nums">{fmtDateTime(c.createdAt)}</span>
                                        {canDelete && (
                                          <button type="button" onClick={() => handleDeleteComment(c.id)}
                                            className="text-[10px] text-red-300/80 hover:text-red-300 transition-colors">✕</button>
                                        )}
                                      </span>
                                    </div>
                                    <p className="text-[12.5px] text-white/85 whitespace-pre-wrap leading-relaxed">{c.body}</p>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* 入力 */}
                          <div className="flex items-end gap-2">
                            <textarea
                              value={commentText[n.id] ?? ""}
                              onChange={e => setCommentText(prev => ({ ...prev, [n.id]: e.target.value }))}
                              placeholder="コメントを かく…（送信すると管理者へ通知されます）"
                              rows={2}
                              className="flex-1 px-3 py-2 rounded-lg border border-white/30 bg-[#000846]/80 text-[12.5px] text-white placeholder-white/40 resize-none focus:outline-none focus:border-white"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddComment(n.id)}
                              disabled={postingId === n.id || !(commentText[n.id] ?? "").trim()}
                              className="shrink-0 h-[42px] px-3 rounded-lg border-2 border-white text-[12px] text-white hover:bg-white/10 active:scale-95 transition disabled:opacity-40"
                            >
                              {postingId === n.id ? "送信中…" : "▶ そうしん"}
                            </button>
                          </div>
                        </div>

                        {isAdmin && (
                          <div className="flex justify-end mt-4">
                            <button type="button" onClick={() => handleDelete(n.id)} disabled={deletingId === n.id}
                              className="text-[11px] text-red-300/80 hover:text-red-300 disabled:opacity-40 transition-colors">
                              {deletingId === n.id ? "さくじょ中…" : "▶ このおしらせを さくじょ"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </RpgWindow>
                </article>
              );
            })}
          </div>
        </div>
      </main>

      {/* ── コメント送信トースト ── */}
      {commentMsg && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] whitespace-nowrap px-5 py-3 rounded-lg border-2 text-[13px] shadow-2xl ${dotGothic.className} ${
          commentMsg.ok ? "bg-[#000846] border-white text-white" : "bg-red-700 border-white text-white"
        }`}>
          {commentMsg.text}
        </div>
      )}

      {/* ── 追加モーダル（管理者） ── */}
      {showAdd && (
        <div className={`fixed inset-0 bg-black/75 z-50 flex items-end sm:items-center justify-center p-4 ${dotGothic.className}`} onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-md" onClick={e => e.stopPropagation()}>
            <RpgWindow>
              <div className="px-5 py-4 space-y-4">
                <h2 className="text-[15px] text-white">★ おしらせを ついか</h2>
                <div>
                  <label className="block text-[11px] text-white/60 mb-1">タイトル <span className="text-red-400">*</span></label>
                  <input type="text" value={addTitle} onChange={e => setAddTitle(e.target.value)} placeholder="タイトルを にゅうりょく"
                    className="w-full px-3 py-2 rounded-lg border border-white/30 bg-[#000846]/80 text-[13px] text-white placeholder-white/40 focus:outline-none focus:border-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-white/60 mb-1">本文 <span className="text-red-400">*</span></label>
                  <textarea value={addBody} onChange={e => setAddBody(e.target.value)} placeholder="ないようを にゅうりょく" rows={5}
                    className="w-full px-3 py-2 rounded-lg border border-white/30 bg-[#000846]/80 text-[13px] text-white placeholder-white/40 resize-none focus:outline-none focus:border-white" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={addPinned} onChange={e => setAddPinned(e.target.checked)} className="w-4 h-4 rounded accent-amber-400" />
                  <span className="text-[13px] text-white/80">じゅうよう（じょうぶに こていする）</span>
                </label>
                {addError && <p className="text-[12px] text-red-300">{addError}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowAdd(false)}
                    className="flex-1 py-2.5 rounded-lg border border-white/40 text-[13px] text-white/80 hover:bg-white/10 transition-colors">
                    やめる
                  </button>
                  <button type="button" onClick={handleCreate} disabled={isAdding}
                    className="flex-1 py-2.5 rounded-lg border-2 border-white bg-white/5 hover:bg-white/15 disabled:opacity-50 text-white text-[13px] transition-colors">
                    {isAdding ? "とうこう中..." : "▶ とうこうする"}
                  </button>
                </div>
              </div>
            </RpgWindow>
          </div>
        </div>
      )}
    </>
  );
}
