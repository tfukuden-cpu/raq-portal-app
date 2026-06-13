"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitInquiryAction } from "./actions";

type Inquiry = {
  id: string;
  title: string;
  body: string;
  status: string;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
};

const CATEGORIES = [
  "シフト・勤務", "休暇・申請", "勤怠・打刻", "アカウント・ログイン", "その他",
];

type Priority = "高" | "中" | "低";
const PRIORITIES: { value: Priority; label: string; desc: string; color: string }[] = [
  { value: "高", label: "高", desc: "早急な対応を希望",       color: "text-red-500 border-red-400"    },
  { value: "中", label: "中", desc: "通常の対応で問題ありません", color: "text-amber-500 border-amber-400" },
  { value: "低", label: "低", desc: "時間に余裕があります",     color: "text-blue-500 border-blue-400"  },
];

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

/** タイトルからカテゴリを抽出（例：[シフト・勤務] タイトル） */
function parseTitle(raw: string): { category: string | null; title: string } {
  const m = raw.match(/^\[([^\]]+)\]\s*/);
  if (m) return { category: m[1], title: raw.slice(m[0].length) };
  return { category: null, title: raw };
}

function StatusBadge({ status, hasReply }: { status: string; hasReply: boolean }) {
  if (status === "closed" || hasReply)
    return <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 border border-emerald-200">解決済み</span>;
  return <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 border border-amber-200">受付中</span>;
}


function PaperclipIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-zinc-400"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>;
}

function InquiryHistory({
  inquiries, latestReply, expanded, setExpanded,
}: {
  inquiries: Inquiry[];
  latestReply: Inquiry | undefined;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* 問い合わせ履歴 */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="px-4 py-3.5 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200">問い合わせ履歴 / 返信状況</h3>
        </div>
        {inquiries.length === 0 ? (
          <p className="px-4 py-6 text-[12px] text-zinc-400 text-center">問い合わせ履歴はありません</p>
        ) : (
          <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {inquiries.slice(0, 5).map(inq => {
              const { category: cat, title } = parseTitle(inq.title);
              const isOpen = expanded === inq.id;
              return (
                <div key={inq.id}>
                  <button type="button" className="w-full text-left px-4 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    onClick={() => setExpanded(isOpen ? null : inq.id)}>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100 leading-snug flex-1">{title}</p>
                      <StatusBadge status={inq.status} hasReply={!!inq.reply} />
                    </div>
                    <div className="flex items-center gap-2 mb-1.5">
                      {cat && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300 font-semibold border border-blue-100">
                          {cat}
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-400 tabular-nums">🕐 {fmtDate(inq.created_at)}</span>
                    </div>
                    {inq.reply && (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1">返信：{inq.reply}</p>
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-3.5 pt-1 bg-zinc-50 dark:bg-zinc-800/30 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
                      <p className="text-[12px] text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                        {inq.body.replace(/^【緊急度：[^】]*】[\r\n]*/m, "")}
                      </p>
                      {inq.reply && (
                        <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                          <p className="text-[10px] font-semibold text-zinc-400 mb-1">管理者からの返信</p>
                          <p className="text-[12px] text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{inq.reply}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 直近の返信 */}
      {latestReply && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm p-4">
          <h3 className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200 mb-3">直近の返信</h3>
          <div className="space-y-2">
            <p className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">{parseTitle(latestReply.title).title}</p>
            {latestReply.replied_at && (
              <p className="text-[11px] text-zinc-400 tabular-nums">返信日時 {fmtDate(latestReply.replied_at)}</p>
            )}
            <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3">
              <p className="text-[12px] text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {latestReply.reply}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function InquiryClient({ inquiries }: { inquiries: Inquiry[] }) {
  const router = useRouter();
  const [category,  setCategory]  = useState("");
  const [subject,   setSubject]   = useState("");
  const [body,      setBody]      = useState("");
  const [priority,  setPriority]  = useState<Priority>("中");
  const [msg,       setMsg]       = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTrans]   = useTransition();
  const [expanded,  setExpanded]  = useState<string | null>(null);

  const clearForm = () => { setCategory(""); setSubject(""); setBody(""); setPriority("中"); setMsg(null); };

  const submit = () => {
    if (!category) { setMsg({ ok: false, text: "お問い合わせ種別を選択してください" }); return; }
    if (!subject.trim()) { setMsg({ ok: false, text: "件名を入力してください" }); return; }
    if (!body.trim())    { setMsg({ ok: false, text: "詳細内容を入力してください" }); return; }

    const fd = new FormData();
    fd.set("title", `[${category}] ${subject.trim()}`);
    fd.set("body",  `【緊急度：${priority}】\n\n${body.trim()}`);
    startTrans(async () => {
      const r = await submitInquiryAction(fd);
      if (r.success) { clearForm(); setMsg({ ok: true, text: r.message ?? "送信しました" }); router.refresh(); }
      else setMsg({ ok: false, text: r.message ?? "エラー" });
    });
  };

  // 最新返信
  const latestReply = inquiries.find(i => i.reply);

  return (
    <main className="flex-1 flex flex-col bg-[#f4f6fa] dark:bg-zinc-950 md:overflow-hidden min-h-0">

      {/* ── 固定タイトルバー ── */}
      <div className="flex-shrink-0 px-4 md:px-8 pt-5 pb-3">
        <h1 className="text-[22px] font-bold text-[#0d1b35] dark:text-white">問い合わせ</h1>
      </div>

      {/* ── スクロールエリア ── */}
      <div className="flex-1 md:min-h-0 overflow-y-auto px-4 md:px-8 pb-6">
        <div className="flex gap-5 items-start">

          {/* ── LEFT: フォーム ── */}
          <div className="flex-1 min-w-0 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm p-6">
            <h2 className="text-[16px] font-bold text-[#0d1b35] dark:text-white mb-1">お問い合わせフォーム</h2>
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mb-6">ご不明点やお困りごとがございましたら、以下のフォームよりお問い合わせください。</p>

            {/* 結果メッセージ */}
            {msg && (
              <div className={`mb-4 px-4 py-3 rounded-xl text-[13px] font-medium ${
                msg.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-200"
              }`}>{msg.text}</div>
            )}

            <div className="space-y-5">
              {/* 種別 */}
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 mb-1.5">
                  お問い合わせ種別 <span className="text-red-500 text-[10px] px-1.5 py-0.5 rounded bg-red-50 ml-1">必須</span>
                </label>
                <div className="relative">
                  <select value={category} onChange={e => setCategory(e.target.value)}
                    className="w-full appearance-none px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[13px] text-zinc-700 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-[#0d1b35]/20 pr-10">
                    <option value="">選択してください</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">▼</span>
                </div>
              </div>

              {/* 件名 */}
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 mb-1.5">
                  件名 <span className="text-red-500 text-[10px] px-1.5 py-0.5 rounded bg-red-50 ml-1">必須</span>
                </label>
                <input type="text" value={subject} onChange={e => setSubject(e.target.value)} 
                  placeholder="お問い合わせの件名を入力してください"
                  className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[13px] text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0d1b35]/20" />
              </div>

              {/* 詳細内容 */}
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 mb-1.5">
                  詳細内容 <span className="text-red-500 text-[10px] px-1.5 py-0.5 rounded bg-red-50 ml-1">必須</span>
                </label>
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} 
                  placeholder="お問い合わせ内容を詳しく入力してください"
                  className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[13px] text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 resize-none focus:outline-none focus:ring-2 focus:ring-[#0d1b35]/20" />
                <p className="text-[11px] text-zinc-400 mt-1 text-right tabular-nums">{body.length} / 2000</p>
              </div>

              {/* 添付ファイル */}
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 mb-1.5">添付ファイル（任意）</label>
                <label className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 cursor-pointer hover:border-zinc-300 transition-colors">
                  <PaperclipIcon />
                  <span className="text-[13px] text-zinc-500">ファイルをドラッグ＆ドロップ</span>
                  <span className="text-[12px] text-zinc-400">または <span className="text-blue-500 font-medium">ファイルを選択</span></span>
                  <input type="file" className="hidden" multiple />
                </label>
                <p className="text-[11px] text-zinc-400 mt-1">※ ファイルは合計10MBまで添付できます。</p>
              </div>

              {/* 緊急度 */}
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 mb-2">
                  緊急度 <span className="text-red-500 text-[10px] px-1.5 py-0.5 rounded bg-red-50 ml-1">必須</span>
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  {PRIORITIES.map(p => (
                    <label key={p.value} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="priority" value={p.value} checked={priority === p.value}
                        onChange={() => setPriority(p.value)} className="accent-blue-600 w-4 h-4" />
                      <span className={`text-[13px] font-bold ${p.color.split(" ")[0]}`}>{p.label}</span>
                      <span className="text-[12px] text-zinc-500">（{p.desc}）</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* ボタン */}
            <div className="flex items-center justify-between mt-8 pt-5 border-t border-zinc-100 dark:border-zinc-800">
              <button type="button" onClick={clearForm}
                className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-[13px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                入力内容をクリア
              </button>
              <button type="button" onClick={submit} disabled={isPending}
                className="px-6 py-2.5 rounded-xl bg-[#0d1b35] hover:bg-[#162b50] disabled:opacity-50 text-white text-[13px] font-semibold transition-colors">
                {isPending ? "送信中..." : "この内容で送信する"}
              </button>
            </div>
          </div>

          {/* ── RIGHT: 履歴（PC） ── */}
          <div className="hidden lg:flex flex-col gap-4 w-80 flex-shrink-0">
            <InquiryHistory inquiries={inquiries} latestReply={latestReply} expanded={expanded} setExpanded={setExpanded} />
          </div>

        </div>

        {/* ── 履歴（モバイル・タブレット：フォームの下） ── */}
        <div className="lg:hidden mt-4">
          <InquiryHistory inquiries={inquiries} latestReply={latestReply} expanded={expanded} setExpanded={setExpanded} />
        </div>

      </div>
    </main>
  );
}
