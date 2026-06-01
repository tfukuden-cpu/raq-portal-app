"use client";

import { useState } from "react";
import Link from "next/link";

type FaqItem = {
  q: string;
  a: string;
  category: string[];
};

const FAQ_ITEMS: FaqItem[] = [
  { q: "シフトが表示されていない",       category: ["すべて","シフト"],
    a: "管理者がまだシフトを登録していない可能性があります。管理者にお問い合わせください。" },
  { q: "打刻時刻が間違っていた",         category: ["すべて","打刻"],
    a: "勤怠実績ページの修正申請ボタン、または My → 打刻補正申請 から申請できます。管理者が承認すると勤怠実績に反映されます。" },
  { q: "希望休が申請できない",           category: ["すべて","申請"],
    a: "今月の締切日を過ぎているか、月の申請上限に達している可能性があります。締切日・上限は案件によって異なりますので管理者にご確認ください。" },
  { q: "欠勤・遅刻報告はどこからする？", category: ["すべて","申請"],
    a: "ホーム画面の「欠勤報告」「遅刻報告」ボタンからご利用ください。出発前のタイミングで入力してください。" },
  { q: "LINEで通知を受け取りたい",       category: ["すべて","通知・連携"],
    a: "My → LINE連携 からLINEアカウントを連携すると、シフト変更や申請審査の通知をLINEで受け取れます。" },
  { q: "パスワードを忘れた",             category: ["すべて","アカウント"],
    a: "管理者にパスワードリセットを依頼してください。" },
  { q: "アプリをホーム画面に追加したい", category: ["すべて","アカウント"],
    a: "iOS：Safariで開いて「共有」→「ホーム画面に追加」／Android：Chromeで開いて「メニュー」→「ホーム画面に追加」" },
  { q: "出勤・退勤の打刻はどこからする？", category: ["すべて","打刻"],
    a: "現場の共有端末（打刻ページ）から打刻できます。URLは管理者にご確認ください。" },
  { q: "シフト追加申請の方法を知りたい", category: ["すべて","シフト","申請"],
    a: "シフトページ → 追加申請タブ から空きシフトへの申請が可能です。管理者の承認後にシフトが確定します。" },
];

const CATEGORIES = ["すべて", "シフト", "打刻", "申請", "アカウント", "通知・連携"];

function StepsIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-blue-600"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}
function BookIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-indigo-600"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>;
}
function VideoIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-violet-600"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>;
}
function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-zinc-400"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}
function MailIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-blue-500"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
}
function ChevronRightIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="9 18 15 12 9 6"/></svg>;
}

const GUIDES = [
  { icon: <StepsIcon />, title: "ステップ別操作ガイド",    desc: "出退勤・シフト・申請の使い方",  href: "/help/manual-staff",  bg: "bg-blue-50",   border: "border-blue-100" },
  { icon: <BookIcon />,  title: "はじめての方向けガイド", desc: "初期設定や基本機能の使い方",     href: "/help/manual-staff",  bg: "bg-indigo-50", border: "border-indigo-100" },
  { icon: <VideoIcon />, title: "動画マニュアル",          desc: "はじめての方向け使い方ガイド",  href: "/help/manual-staff",  bg: "bg-violet-50", border: "border-violet-100" },
];

export default function HelpClient() {
  const [search,   setSearch]   = useState("");
  const [category, setCategory] = useState("すべて");
  const [openIdx,  setOpenIdx]  = useState<number | null>(null);

  const filtered = FAQ_ITEMS.filter(item => {
    const matchCat    = item.category.includes(category);
    const matchSearch = !search || item.q.includes(search) || item.a.includes(search);
    return matchCat && matchSearch;
  });

  return (
    <div className="min-h-screen bg-[#f4f6fa] dark:bg-zinc-950 px-4 md:px-8 pt-6 pb-16">

      {/* ── タイトル + サブタイトル ── */}
      <div className="mb-6">
        <h1 className="text-[24px] font-bold text-[#0d1b35] dark:text-white">ヘルプ</h1>
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">ご不明な点は、まずこちらをご確認ください</p>
      </div>

      {/* ── 検索バー ── */}
      <div className="relative mb-8">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"><SearchIcon /></span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="キーワードで検索（例：打刻、シフト、申請）"
          className="w-full pl-12 pr-4 py-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[14px] text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0d1b35]/20 shadow-sm"
        />
      </div>

      {/* ── 操作ガイド ── */}
      <div className="mb-8">
        <h2 className="text-[16px] font-bold text-[#0d1b35] dark:text-white mb-4">操作ガイド</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {GUIDES.map(g => (
            <Link key={g.title} href={g.href}
              className={`flex items-center gap-4 p-5 rounded-2xl border ${g.bg} ${g.border} hover:shadow-md transition-all group`}>
              <div className="flex-shrink-0">{g.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-[#0d1b35] dark:text-zinc-100">{g.title}</p>
                <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5">{g.desc}</p>
              </div>
              <ChevronRightIcon />
            </Link>
          ))}
        </div>
      </div>

      {/* ── よくある質問 ── */}
      <div>
        <h2 className="text-[16px] font-bold text-[#0d1b35] dark:text-white mb-4">よくある質問</h2>

        <div className="flex gap-5 items-start">

          {/* FAQ リスト */}
          <div className="flex-1 min-w-0">
            {/* カテゴリタブ */}
            <div className="flex items-center gap-2 flex-wrap mb-4">
              {CATEGORIES.map(cat => (
                <button key={cat} type="button" onClick={() => { setCategory(cat); setOpenIdx(null); }}
                  className={`px-4 py-1.5 rounded-full text-[13px] font-semibold transition-colors ${
                    category === cat
                      ? "bg-[#0d1b35] text-white"
                      : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50"
                  }`}>
                  {cat}
                </button>
              ))}
            </div>

            {/* アコーディオン */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm overflow-hidden">
              {filtered.length === 0 ? (
                <p className="px-6 py-8 text-[13px] text-zinc-400 text-center">該当する質問が見つかりませんでした</p>
              ) : filtered.map((item, i) => (
                <div key={i} className={i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : ""}>
                  <button
                    type="button"
                    onClick={() => setOpenIdx(openIdx === i ? null : i)}
                    className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  >
                    <span className="text-[14px] text-zinc-800 dark:text-zinc-100 font-medium">
                      <span className="text-blue-500 font-bold mr-2">Q.</span>{item.q}
                    </span>
                    <span className={`text-[20px] font-light text-zinc-400 flex-shrink-0 ml-4 transition-transform ${openIdx === i ? "rotate-45" : ""}`}>＋</span>
                  </button>
                  {openIdx === i && (
                    <div className="px-6 pb-5 pt-1">
                      <p className="text-[13px] text-zinc-600 dark:text-zinc-300 leading-relaxed pl-6">{item.a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 解決しない場合カード */}
          <div className="hidden lg:block w-64 flex-shrink-0 sticky top-6">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm p-6 flex flex-col items-center text-center gap-4">
              <div className="w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                <MailIcon />
              </div>
              <div>
                <p className="text-[15px] font-bold text-[#0d1b35] dark:text-white mb-1">解決しない場合</p>
                <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  解決しない場合は、<br />問い合わせフォームから<br />お問い合わせください。
                </p>
              </div>
              <Link href="/inquiries"
                className="w-full flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl bg-[#0d1b35] text-white text-[13px] font-semibold hover:bg-[#162b50] transition-colors">
                問い合わせフォームへ
                <ChevronRightIcon />
              </Link>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
