"use client";

import { useState, useTransition } from "react";
import { reviewHolidayAction } from "../actions";

type Request = {
  id: string;
  request_date: string;
  status: string;
  note: string | null;
  review_note: string | null;
  created_at: string;
  staff_id: string;
  staff_name: string;
};

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300",
  approved: "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300",
  rejected: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "審査中", approved: "承認", rejected: "却下",
};

type FilterType = "all" | "pending" | "approved" | "rejected";

export default function HolidayReviewClient({ requests }: { requests: Request[] }) {
  const [filter, setFilter] = useState<FilterType>("pending");
  const [modal, setModal] = useState<{ request: Request; action: "approve" | "reject" } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  const handleReview = () => {
    if (!modal) return;
    setError(null);
    const fd = new FormData();
    fd.set("id", modal.request.id);
    fd.set("status", modal.action === "approve" ? "approved" : "rejected");
    fd.set("reviewNote", reviewNote);
    startTransition(async () => {
      const r = await reviewHolidayAction(fd);
      if (!r.success) { setError(r.message ?? "失敗しました"); }
      else { setModal(null); }
    });
  };

  return (
    <>
      {/* フィルター */}
      <div className="flex gap-2 mb-4">
        {(["pending", "all", "approved", "rejected"] as FilterType[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === f
                ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-50"
                : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}>
            {f === "all" ? "すべて" : STATUS_LABEL[f]}
            {f === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 bg-red-500 text-white rounded-full px-1.5 text-[10px]">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* 一覧 */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-10 text-center text-sm text-zinc-500">
          {filter === "pending" ? "審査待ちの申請はありません" : "申請がありません"}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const d = new Date(r.request_date + "T00:00:00+09:00");
            return (
              <li key={r.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                        {d.getMonth() + 1}/{d.getDate()}（{WEEKDAY_JP[d.getDay()]}）
                      </span>
                      <span className="text-xs text-zinc-500">{r.staff_name}</span>
                    </div>
                    {r.note && <p className="text-xs text-zinc-500 truncate">📝 {r.note}</p>}
                  </div>
                  {r.status === "pending" && (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button type="button"
                        onClick={() => { setReviewNote(""); setError(null); setModal({ request: r, action: "approve" }); }}
                        className="text-xs px-2.5 py-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white">
                        承認
                      </button>
                      <button type="button"
                        onClick={() => { setReviewNote(""); setError(null); setModal({ request: r, action: "reject" }); }}
                        className="text-xs px-2.5 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white">
                        却下
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 承認・却下モーダル */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-20 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-lg max-w-sm w-full p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className={`text-base font-bold mb-3 ${modal.action === "approve" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
              {modal.action === "approve" ? "✅ 承認しますか？" : "❌ 却下しますか？"}
            </h2>
            {(() => {
              const d = new Date(modal.request.request_date + "T00:00:00+09:00");
              return (
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-3">
                  {modal.request.staff_name} / {d.getMonth() + 1}/{d.getDate()}（{WEEKDAY_JP[d.getDay()]}）
                </p>
              );
            })()}
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">コメント（任意）</label>
            <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)}
              rows={2} className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none mb-3" />
            {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setModal(null)}
                className="flex-1 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm">キャンセル</button>
              <button type="button" onClick={handleReview} disabled={isPending}
                className={`flex-1 py-2 rounded-md text-white text-sm font-medium disabled:opacity-50 ${
                  modal.action === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}>
                {isPending ? "処理中..." : modal.action === "approve" ? "承認する" : "却下する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
