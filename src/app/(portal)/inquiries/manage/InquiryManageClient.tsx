"use client";

import { useState, useTransition } from "react";
import { replyInquiryAction } from "../actions";

type Inquiry = {
  id: string;
  staffName: string;
  title: string;
  body: string;
  status: string;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
};

export function InquiryManageClient({ inquiries }: { inquiries: Inquiry[] }) {
  const [selected, setSelected] = useState<Inquiry | null>(null);
  const [reply, setReply] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | "open" | "closed">("open");

  const filtered = inquiries.filter(inq =>
    filter === "all" ? true : inq.status === filter
  );
  const openCount = inquiries.filter(i => i.status === "open").length;

  const submitReply = () => {
    if (!selected) return;
    const fd = new FormData();
    fd.set("id", selected.id);
    fd.set("reply", reply);
    startTransition(async () => {
      const r = await replyInquiryAction(fd);
      setMsg({ ok: r.success, text: r.message ?? "" });
      if (r.success) { setSelected(null); setReply(""); }
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

      {/* フィルタータブ */}
      <div className="flex gap-2">
        {(["open", "closed", "all"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 py-2 text-sm font-medium rounded-xl transition-colors ${
              filter === f
                ? "bg-blue-600 text-white"
                : "bg-white dark:bg-zinc-900 text-zinc-500 border border-zinc-200 dark:border-zinc-800"
            }`}>
            {f === "open" ? `未返信 ${openCount > 0 ? `(${openCount})` : ""}` : f === "closed" ? "返信済" : "すべて"}
          </button>
        ))}
      </div>

      {/* 返信モーダル */}
      {selected && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-blue-200 dark:border-blue-900 p-4 space-y-3">
          <p className="text-xs font-medium text-blue-600">返信中：{selected.title}</p>
          <div className="bg-zinc-50 dark:bg-zinc-950 rounded-xl px-3 py-2">
            <p className="text-xs text-zinc-500 whitespace-pre-wrap">{selected.body}</p>
          </div>
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            rows={4}
            placeholder="返信内容を入力..."
            className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 resize-none"
          />
          <div className="flex gap-2">
            <button onClick={() => { setSelected(null); setReply(""); }}
              className="flex-1 py-2 text-sm text-zinc-500 border border-zinc-200 dark:border-zinc-700 rounded-xl">
              キャンセル
            </button>
            <button onClick={submitReply} disabled={isPending || !reply}
              className="flex-1 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white rounded-xl transition-colors">
              {isPending ? "送信中..." : "返信する"}
            </button>
          </div>
        </div>
      )}

      {/* 一覧 */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <p className="text-sm text-zinc-400 text-center py-8">該当する問い合わせはありません</p>
        )}
        {filtered.map(inq => (
          <div key={inq.id} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-zinc-400">{inq.staffName}</p>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{inq.title}</p>
              </div>
              <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                inq.status === "closed"
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
                  : "bg-orange-100 dark:bg-orange-950 text-orange-600"
              }`}>
                {inq.status === "closed" ? "返信済" : "未返信"}
              </span>
            </div>
            <p className="text-xs text-zinc-500 whitespace-pre-wrap">{inq.body}</p>
            <p className="text-[10px] text-zinc-400 tabular-nums">
              {new Date(inq.created_at).toLocaleDateString("ja-JP")}
            </p>
            {inq.reply && (
              <div className="mt-1 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-[10px] font-medium text-zinc-400 mb-1">返信済み</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{inq.reply}</p>
              </div>
            )}
            {inq.status === "open" && (
              <button onClick={() => { setSelected(inq); setReply(""); }}
                className="w-full mt-1 py-2 text-sm font-medium text-blue-600 border border-blue-200 dark:border-blue-900 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors">
                返信する
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
