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

type TabKey = "all" | "notice";
const TABS: { key: TabKey; label: string }[] = [
  { key: "all",    label: "すべて" },
  { key: "notice", label: "全体へのお知らせ" },
];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function getInitial(name: string): string { return name.charAt(0).toUpperCase(); }

function AvatarCircle({ name }: { name: string }) {
  const colors = ["bg-blue-500","bg-indigo-500","bg-violet-500","bg-emerald-500","bg-orange-500","bg-teal-500"];
  const color  = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className={`w-10 h-10 ${color} rounded-full flex items-center justify-center text-white text-[15px] font-bold flex-shrink-0`}>
      {getInitial(name)}
    </div>
  );
}

function ChevronRightIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="9 18 15 12 9 6"/></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}

function PinIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>;
}

export default function NoticesClient({ notices, readIds, isAdmin }: Props) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set(readIds));
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [search, setSearch]       = useState("");
  const [expanded, setExpanded]   = useState<string | null>(null);

  const [, startReadTrans] = useTransition();
  const handleConfirm = (id: string) => {
    setConfirmed(prev => new Set([...prev, id]));
    startReadTrans(async () => { await markNoticeReadAction(id); });
  };

  // 追加モーダル
  const [showAdd, setShowAdd]   = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addBody, setAddBody]   = useState("");
  const [addPinned, setAddPinned] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
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
  const [, startDeleteTrans] = useTransition();
  const handleDelete = (id: string) => {
    if (!confirm("このお知らせを削除しますか？")) return;
    setDeletingId(id);
    const fd = new FormData(); fd.set("id", id);
    startDeleteTrans(async () => { await deleteNoticeAction(fd); setDeletingId(null); router.refresh(); });
  };

  // フィルタリング
  const filtered = notices.filter(n => {
    const matchSearch = !search || n.title.toLowerCase().includes(search.toLowerCase()) || n.body.toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  const unreadCount   = notices.filter(n => !confirmed.has(n.id)).length;
  const pinnedCount   = notices.filter(n => n.is_pinned).length;
  const popularTop3   = [...notices].slice(0, 3);

  return (
    <>
      <main className="flex-1 flex flex-col bg-[#f4f6fa] dark:bg-zinc-950 overflow-hidden min-h-0">

        {/* ── 固定ヘッダー ── */}
        <div className="flex-shrink-0 w-full px-4 md:px-8 pt-5 pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <h1 className="text-[22px] font-bold text-[#0d1b35] dark:text-white">周知事項</h1>
              {/* タブ */}
              <div className="flex items-center gap-1 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-1">
                {TABS.map(({ key, label }) => (
                  <button key={key} type="button" onClick={() => setActiveTab(key)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors whitespace-nowrap ${
                      activeTab === key ? "bg-[#0d1b35] text-white shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
                    }`}>
                    {label}
                    {key === "all" && unreadCount > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-blue-500 text-white text-[9px] font-bold">{unreadCount}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* 検索 */}
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"><SearchIcon /></span>
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="検索"
                  className="w-44 pl-9 pr-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[13px] text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0d1b35]/20" />
              </div>
              {isAdmin && (
                <button type="button" onClick={openAdd}
                  className="px-4 py-2 rounded-xl bg-[#0d1b35] text-white text-[13px] font-semibold hover:bg-[#162b50] transition-colors">
                  ＋ 追加
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── スクロールエリア ── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 pb-6">
          <div className="flex gap-5 items-start">

            {/* ── メインフィード ── */}
            <div className="flex-1 min-w-0 space-y-3">
              {filtered.length === 0 ? (
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-12 text-center">
                  <p className="text-[13px] text-zinc-400">お知らせはありません</p>
                </div>
              ) : filtered.map(n => {
                const isRead = confirmed.has(n.id);
                const isOpen = expanded === n.id;

                return (
                  <article key={n.id}
                    className={`bg-white dark:bg-zinc-900 rounded-2xl border shadow-sm transition-all ${
                      n.is_pinned ? "border-blue-200 dark:border-blue-800" : "border-zinc-100 dark:border-zinc-800"
                    }`}>
                    {/* カードヘッダー */}
                    <button type="button" className="w-full text-left p-5"
                      onClick={() => { setExpanded(isOpen ? null : n.id); if (!isRead) handleConfirm(n.id); }}>
                      <div className="flex items-start gap-3">
                        <AvatarCircle name={n.posterName} />
                        <div className="flex-1 min-w-0">
                          {/* 投稿者 + タグ + 日時 */}
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-[13px] font-bold text-zinc-800 dark:text-zinc-100">{n.posterName}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                              n.is_pinned ? "bg-blue-100 text-blue-700" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                            }`}>
                              {n.is_pinned ? "📌 重要" : "全体へのお知らせ"}
                            </span>
                            <span className="text-[11px] text-zinc-400 tabular-nums">{fmtDateTime(n.created_at)}</span>
                          </div>
                          {/* タイトル */}
                          <p className="text-[15px] font-bold text-zinc-800 dark:text-zinc-100 leading-snug mb-1">{n.title}</p>
                          {/* プレビュー（折りたたみ時） */}
                          {!isOpen && (
                            <p className="text-[12px] text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">{n.body}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          {!isRead && (
                            <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                          )}
                          {isRead && (
                            <span className="text-[10px] text-zinc-400 font-medium">確認済</span>
                          )}
                          <ChevronRightIcon />
                        </div>
                      </div>
                    </button>

                    {/* 展開コンテンツ */}
                    {isOpen && (
                      <div className="px-5 pb-5 border-t border-zinc-50 dark:border-zinc-800">
                        <p className="text-[13px] text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed pt-4">{n.body}</p>
                        {isAdmin && (
                          <div className="flex justify-end mt-4">
                            <button type="button" onClick={() => handleDelete(n.id)} disabled={deletingId === n.id}
                              className="text-[11px] text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors">
                              {deletingId === n.id ? "削除中…" : "削除する"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            {/* ── サイドバー ── */}
            <div className="hidden lg:flex flex-col gap-4 w-64 flex-shrink-0">

              {/* お知らせサマリー */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 shadow-sm">
                <h3 className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200 mb-3">お知らせサマリー</h3>
                <div className="space-y-0">
                  {[
                    { label: "未読のお知らせ", count: unreadCount, color: "bg-blue-500" },
                    { label: "全体へのお知らせ", count: notices.length, color: "bg-zinc-400" },
                    { label: "重要なお知らせ", count: pinnedCount, color: "bg-red-500" },
                  ].map(({ label, count, color }) => (
                    <div key={label} className="flex items-center justify-between py-2.5 border-b border-zinc-50 dark:border-zinc-800 last:border-0">
                      <div className="flex items-center gap-2 text-[13px] text-zinc-500 dark:text-zinc-400">
                        <span className={`w-1.5 h-1.5 rounded-full ${color} flex-shrink-0`} />
                        {label}
                      </div>
                      <span className={`text-[14px] font-bold tabular-nums ${count > 0 ? "text-[#0d1b35] dark:text-white" : "text-zinc-300"}`}>
                        {count}件
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 人気のお知らせ */}
              {popularTop3.length > 0 && (
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 shadow-sm">
                  <h3 className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200 mb-3">人気のお知らせ</h3>
                  <div className="space-y-3">
                    {popularTop3.map((n, i) => (
                      <div key={n.id} className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-[#0d1b35] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] text-zinc-700 dark:text-zinc-200 leading-snug font-medium line-clamp-2">{n.title}</p>
                          <p className="text-[10px] text-zinc-400 mt-0.5">{fmtDateTime(n.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </main>

      {/* 追加モーダル */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold text-zinc-900 dark:text-zinc-50">周知事項を追加</h2>
            <div>
              <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">タイトル <span className="text-red-500">*</span></label>
              <input type="text" value={addTitle} onChange={e => setAddTitle(e.target.value)} placeholder="タイトルを入力"
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[13px]" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">本文 <span className="text-red-500">*</span></label>
              <textarea value={addBody} onChange={e => setAddBody(e.target.value)} placeholder="内容を入力してください" rows={5}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[13px] resize-none" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={addPinned} onChange={e => setAddPinned(e.target.checked)} className="w-4 h-4 rounded accent-blue-600" />
              <span className="text-[13px] text-zinc-700 dark:text-zinc-300">重要（常に上部に固定）</span>
            </label>
            {addError && <p className="text-[12px] text-red-600 dark:text-red-400">{addError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowAdd(false)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-[13px] text-zinc-600 hover:bg-zinc-50 transition-colors">
                キャンセル
              </button>
              <button type="button" onClick={handleCreate} disabled={isAdding}
                className="flex-1 py-2.5 rounded-xl bg-[#0d1b35] hover:bg-[#162b50] disabled:opacity-50 text-white text-[13px] font-semibold transition-colors">
                {isAdding ? "投稿中..." : "投稿する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
