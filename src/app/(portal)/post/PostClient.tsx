"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPostAction, deletePostAction } from "./actions";

type Post = {
  id: string;
  body: string;
  image_url: string | null;
  created_at: string;
  staffId: string;
  posterName: string;
};

type Props = {
  posts: Post[];
  currentStaffId: string;
  currentStaffName: string;
  isAdmin: boolean;
  todayCount: number;
};

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}


function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

function AvatarCircle({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "w-12 h-12 text-[18px]" : size === "sm" ? "w-7 h-7 text-[11px]" : "w-10 h-10 text-[15px]";
  const colors = ["bg-blue-500","bg-indigo-500","bg-violet-500","bg-emerald-500","bg-orange-500","bg-pink-500","bg-teal-500"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className={`${sizeClass} ${color} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {getInitial(name)}
    </div>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}

function LikeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/>
      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}

export default function PostClient({ posts, currentStaffId, currentStaffName, isAdmin, todayCount }: Props) {
  const router = useRouter();
  const [body, setBody]             = useState("");
  const [imageFile, setImageFile]   = useState<File | null>(null);
  const [imagePreview, setPreview]  = useState<string | null>(null);
  const [searchQuery, setSearch]    = useState("");
  const [formError, setFormError]   = useState<string | null>(null);
  const [isPosting, startPostTrans] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDeleteTrans]        = useTransition();
  const [likes, setLikes]           = useState<Record<string, boolean>>({});
  const [openMenu, setOpenMenu]     = useState<string | null>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setPreview(url);
    e.target.value = "";
  };

  const clearImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setPreview(null);
  };

  const handlePost = () => {
    if (!body.trim() && !imageFile) { setFormError("本文か画像を入力してください"); return; }
    setFormError(null);
    const fd = new FormData();
    fd.set("body", body.trim());
    if (imageFile) fd.set("image", imageFile);
    startPostTrans(async () => {
      const result = await createPostAction(fd);
      if (!result.success) { setFormError(result.message ?? "投稿失敗"); }
      else { setBody(""); clearImage(); router.refresh(); }
    });
  };

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

  const toggleLike = (id: string) => setLikes(prev => ({ ...prev, [id]: !prev[id] }));

  // フィルタリング
  const filtered = posts.filter(p => {
    const matchSearch = !searchQuery || p.body.toLowerCase().includes(searchQuery.toLowerCase()) || p.posterName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchSearch;
  });

  // サイドバー統計
  const todayPosts = posts.filter(p => {
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    return p.created_at.startsWith(today);
  });
  const popularPosts = [...posts].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3);

  return (
    <main className="flex-1 flex flex-col bg-[#f4f6fa] dark:bg-zinc-950 md:overflow-hidden min-h-0">

      {/* ── 固定ヘッダー ── */}
      <div className="flex-shrink-0 w-full px-4 md:px-8 pt-5 pb-3">

        {/* ── タイトル + タブ + 検索 ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-[22px] font-bold text-[#0d1b35] dark:text-white">掲示板</h1>
          <div className="flex items-center gap-3">
            {/* 検索 */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none">
                <SearchIcon />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearch(e.target.value)}
                placeholder="キーワードで検索"
                className="w-52 pl-9 pr-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[13px] text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0d1b35]/20"
              />
            </div>
          </div>
        </div>

      </div>{/* /固定ヘッダー */}

      {/* ── スクロールエリア ── */}
      <div className="flex-1 md:min-h-0 overflow-y-auto px-4 md:px-8 pb-6">
        {/* ── 2カラムレイアウト ── */}
        <div className="flex gap-5 items-start">

          {/* ── メインフィード ── */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* 投稿フォーム */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 shadow-sm">
              <div className="flex gap-3">
                <AvatarCircle name={currentStaffName} size="md" />
                <div className="flex-1 min-w-0">
                  <textarea
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    placeholder="今日の報告や連絡を入力してください..."
                    rows={3}
                    maxLength={2000}
                    className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-[13px] text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 resize-none focus:outline-none focus:ring-2 focus:ring-[#0d1b35]/20 transition"
                  />
                  {/* 画像プレビュー */}
                  {imagePreview && (
                    <div className="relative mt-2 inline-block">
                      <img src={imagePreview} alt="添付画像" className="max-h-40 rounded-xl border border-zinc-200 dark:border-zinc-700 object-cover" />
                      <button type="button" onClick={clearImage}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-zinc-700 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors">
                        <XIcon />
                      </button>
                    </div>
                  )}

                  {formError && <p className="text-[11px] text-red-500 mt-1">{formError}</p>}

                  <div className="flex items-center justify-between mt-2.5">
                    {/* 画像添付ボタン */}
                    <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer transition-colors text-[12px] font-medium">
                      <PaperclipIcon />
                      写真を添付
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                    </label>
                    <button
                      type="button"
                      onClick={handlePost}
                      disabled={isPosting || !body.trim()}
                      className="px-5 py-2 rounded-xl bg-[#0d1b35] hover:bg-[#162b50] disabled:opacity-40 text-white text-[13px] font-semibold transition-colors"
                    >
                      {isPosting ? "投稿中…" : "投稿する"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 投稿フィード */}
            {filtered.length === 0 ? (
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-12 text-center">
                <p className="text-[13px] text-zinc-400">投稿はまだありません</p>
              </div>
            ) : (
              filtered.map((p) => {
                const isOwn    = p.staffId === currentStaffId;
                const canDelete = isOwn || isAdmin;
                const liked    = likes[p.id] ?? false;
                const lines    = p.body.split("\n").filter(Boolean);
                const title    = lines[0] ?? "";
                const rest     = lines.slice(1).join("\n");

                return (
                  <article key={p.id} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5 shadow-sm">
                    {/* ヘッダー */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <AvatarCircle name={p.posterName} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-bold text-zinc-800 dark:text-zinc-100">{p.posterName}</span>
                            {isOwn && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 font-bold">自分</span>
                            )}
                          </div>
                          <p className="text-[11px] text-zinc-400 tabular-nums mt-0.5">{fmtDateTime(p.created_at)}</p>
                        </div>
                      </div>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setOpenMenu(openMenu === p.id ? null : p.id)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        >
                          <MoreIcon />
                        </button>
                        {openMenu === p.id && canDelete && (
                          <div className="absolute right-0 top-8 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg z-20 min-w-[100px] overflow-hidden">
                            <button
                              type="button"
                              onClick={() => { handleDelete(p.id); setOpenMenu(null); }}
                              disabled={deletingId === p.id}
                              className="w-full px-4 py-2.5 text-left text-[12px] text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                            >
                              {deletingId === p.id ? "削除中…" : "削除する"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 本文 */}
                    {title && (
                      <p className="text-[15px] font-bold text-zinc-800 dark:text-zinc-100 mb-1">{title}</p>
                    )}
                    {rest && (
                      <p className="text-[13px] text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">{rest}</p>
                    )}
                    {!title && !rest && p.body && (
                      <p className="text-[13px] text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">{p.body}</p>
                    )}

                    {/* 添付画像 */}
                    {p.image_url && (
                      <div className="mt-3">
                        <a href={p.image_url} target="_blank" rel="noopener noreferrer">
                          <img src={p.image_url} alt="添付画像" className="max-h-72 rounded-xl border border-zinc-100 dark:border-zinc-800 object-cover cursor-pointer hover:opacity-95 transition-opacity" />
                        </a>
                      </div>
                    )}

                    {/* フッター */}
                    <div className="flex items-center gap-4 mt-4 pt-3 border-t border-zinc-50 dark:border-zinc-800">
                      <button
                        type="button"
                        onClick={() => toggleLike(p.id)}
                        className={`flex items-center gap-1.5 text-[12px] font-medium transition-colors ${liked ? "text-blue-600 dark:text-blue-400" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"}`}
                      >
                        <LikeIcon />
                        いいね {liked ? 1 : 0}
                      </button>
                      <button type="button" className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
                        <CommentIcon />コメント
                      </button>
                      <div className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-300 dark:text-zinc-600">
                        <EyeIcon />既読
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* ── サイドバー ── */}
          <div className="hidden lg:flex flex-col gap-4 w-72 flex-shrink-0">

            {/* お知らせサマリー */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 shadow-sm">
              <h3 className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200 mb-3">お知らせサマリー</h3>
              <div className="space-y-0">
                {[
                  { label: "全投稿数", count: posts.length, icon: "📋" },
                  { label: "本日の投稿", count: todayCount, icon: "📝" },
                  { label: "自分の投稿", count: posts.filter(p => p.staffId === currentStaffId).length, icon: "👤" },
                ].map(({ label, count, icon }) => (
                  <div key={label} className="flex items-center justify-between py-2.5 border-b border-zinc-50 dark:border-zinc-800 last:border-0">
                    <div className="flex items-center gap-2 text-[13px] text-zinc-500 dark:text-zinc-400">
                      <span>{icon}</span>{label}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-[14px] font-bold tabular-nums ${count > 0 ? "text-[#0d1b35] dark:text-white" : "text-zinc-300 dark:text-zinc-600"}`}>
                        {count}件
                      </span>
                      <ChevronRightIcon />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 最近の投稿 */}
            {popularPosts.length > 0 && (
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 shadow-sm">
                <h3 className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200 mb-3">最近の投稿</h3>
                <div className="space-y-3">
                  {popularPosts.map(p => (
                    <div key={p.id} className="flex items-start gap-2.5">
                      <AvatarCircle name={p.posterName} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-zinc-700 dark:text-zinc-200 leading-snug line-clamp-2">{p.body}</p>
                        <p className="text-[10px] text-zinc-400 mt-0.5">{p.posterName}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>{/* /スクロールエリア */}
    </main>
  );
}
