"use client";

import { useState, useTransition } from "react";
import { submitCorrectionAction, withdrawCorrectionAction } from "./actions";

type Correction = {
  id: string;
  target_date: string;
  corrected_in: string | null;
  corrected_out: string | null;
  reason: string;
  status: string;
  review_note: string | null;
  created_at: string;
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

export default function CorrectionFormClient({ corrections }: { corrections: Correction[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [targetDate, setTargetDate] = useState("");
  const [correctedIn, setCorrectedIn] = useState("");
  const [correctedOut, setCorrectedOut] = useState("");
  const [reason, setReason] = useState("");
  const [deleteModal, setDeleteModal] = useState<Correction | null>(null);

  const handleSubmit = () => {
    setError(null);
    setSuccess(false);
    const fd = new FormData();
    fd.set("targetDate", targetDate);
    fd.set("correctedIn", correctedIn);
    fd.set("correctedOut", correctedOut);
    fd.set("reason", reason);
    startTransition(async () => {
      const r = await submitCorrectionAction(fd);
      if (!r.success) { setError(r.message ?? "申請失敗"); }
      else {
        setSuccess(true);
        setTargetDate(""); setCorrectedIn(""); setCorrectedOut(""); setReason("");
      }
    });
  };

  const handleWithdraw = (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      await withdrawCorrectionAction(fd);
      setDeleteModal(null);
    });
  };

  return (
    <>
      {/* 申請フォーム */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-500">新規申請</h2>

        <div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">対象日</label>
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">修正後の出勤時刻</label>
            <input type="time" value={correctedIn} onChange={(e) => setCorrectedIn(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">修正後の退勤時刻</label>
            <input type="time" value={correctedOut} onChange={(e) => setCorrectedOut(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm" />
          </div>
        </div>
        <p className="text-xs text-zinc-400 -mt-2">変更が必要な方のみ入力してください</p>

        <div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">修正理由 <span className="text-red-500">*</span></label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="例：打刻忘れ、機器不具合など"
            rows={3} className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none" />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {success && <p className="text-sm text-green-600 dark:text-green-400">✅ 申請しました</p>}

        <button type="button" onClick={handleSubmit} disabled={isPending}
          className="w-full py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium">
          {isPending ? "申請中..." : "申請する"}
        </button>
      </div>

      {/* 申請履歴 */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-zinc-500 mb-3">申請履歴</h2>
        {corrections.length === 0 ? (
          <p className="text-sm text-zinc-500">申請履歴はありません</p>
        ) : (
          <ul className="space-y-3">
            {corrections.map((c) => {
              const d = new Date(c.target_date + "T00:00:00+09:00");
              return (
                <li key={c.id} className="border border-zinc-200 dark:border-zinc-800 rounded-md p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLE[c.status]}`}>
                          {STATUS_LABEL[c.status]}
                        </span>
                        <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                          {d.getMonth() + 1}/{d.getDate()}（{WEEKDAY_JP[d.getDay()]}）
                        </span>
                      </div>
                      {(c.corrected_in || c.corrected_out) && (
                        <p className="text-xs text-zinc-500 font-mono">
                          {c.corrected_in?.slice(0, 5) ?? "--:--"} → {c.corrected_out?.slice(0, 5) ?? "--:--"}
                        </p>
                      )}
                      <p className="text-xs text-zinc-500 mt-0.5 truncate">理由：{c.reason}</p>
                      {c.review_note && (
                        <p className="text-xs text-zinc-400 mt-0.5">コメント：{c.review_note}</p>
                      )}
                    </div>
                    {c.status === "pending" && (
                      <button type="button" onClick={() => setDeleteModal(c)}
                        className="text-xs text-zinc-400 hover:text-red-600 flex-shrink-0 px-2 py-1">
                        取り下げ
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 取り下げ確認モーダル */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/50 z-20 flex items-center justify-center p-4" onClick={() => setDeleteModal(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-lg max-w-sm w-full p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-2 text-zinc-900 dark:text-zinc-50">申請を取り下げますか？</h2>
            {(() => {
              const d = new Date(deleteModal.target_date + "T00:00:00+09:00");
              return <p className="text-sm text-zinc-500 mb-4">{d.getMonth() + 1}/{d.getDate()}（{WEEKDAY_JP[d.getDay()]}）の補正申請</p>;
            })()}
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteModal(null)}
                className="flex-1 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm">キャンセル</button>
              <button type="button" onClick={() => handleWithdraw(deleteModal.id)} disabled={isPending}
                className="flex-1 py-2 rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium">
                {isPending ? "処理中..." : "取り下げる"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
