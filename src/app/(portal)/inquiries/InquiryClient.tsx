"use client";

import { useState, useTransition } from "react";
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

export function InquiryClient({ inquiries }: { inquiries: Inquiry[] }) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const fd = new FormData();
    fd.set("title", title);
    fd.set("body", body);
    startTransition(async () => {
      const r = await submitInquiryAction(fd);
      if (r.success) {
        setTitle(""); setBody(""); setShowForm(false);
        setMsg({ ok: true, text: r.message ?? "送信しました" });
      } else {
        setMsg({ ok: false, text: r.message ?? "エラー" });
      }
    });
  };

  return (
    <div className="space-y-4">
      {msg && (
        <p className={`text-sm px-3 py-2 rounded-xl ${
          msg.ok ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600"
                 : "bg-red-50 dark:bg-red-950/20 text-red-500"
        }`}>
          {msg.text}
        </p>
      )}

      <button
        onClick={() => setShowForm(v => !v)}
        className="w-full py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors"
      >
        {showForm ? "キャンセル" : "新しい問い合わせを送る"}
      </button>

      {showForm && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">件名</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="例：シフトについて"
              className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">内容</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={4}
              placeholder="お問い合わせ内容を入力してください"
              className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 resize-none"
            />
          </div>
          <button
            onClick={submit}
            disabled={isPending || !title || !body}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-medium text-sm transition-colors"
          >
            {isPending ? "送信中..." : "送信する"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {inquiries.length === 0 && (
          <p className="text-sm text-zinc-400 text-center py-8">問い合わせ履歴はありません</p>
        )}
        {inquiries.map(inq => (
          <div key={inq.id} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{inq.title}</p>
              <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                inq.status === "closed"
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
                  : "bg-blue-100 dark:bg-blue-950 text-blue-600"
              }`}>
                {inq.status === "closed" ? "返信済" : "未返信"}
              </span>
            </div>
            <p className="text-xs text-zinc-500 whitespace-pre-wrap">{inq.body}</p>
            <p className="text-[10px] text-zinc-400 tabular-nums">
              {new Date(inq.created_at).toLocaleDateString("ja-JP")}
            </p>
            {inq.reply && (
              <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-[10px] font-medium text-zinc-400 mb-1">管理者からの返信</p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{inq.reply}</p>
                {inq.replied_at && (
                  <p className="text-[10px] text-zinc-400 mt-1 tabular-nums">
                    {new Date(inq.replied_at).toLocaleDateString("ja-JP")}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
