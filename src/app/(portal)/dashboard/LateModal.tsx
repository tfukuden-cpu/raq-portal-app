"use client";

import { useState } from "react";

const ETA_OPTS = [
  { label: "すぐ着く", value: 5 },  { label: "10分", value: 10 },
  { label: "20分",     value: 20 },  { label: "30分", value: 30 },
  { label: "45分",     value: 45 },  { label: "1時間以上", value: 60 },
];

export function LateModal({ onClose, onSubmit, isPending }: {
  onClose: () => void;
  onSubmit: (reason: string, etaMinutes: number) => void;
  isPending: boolean;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [reason, setReason] = useState("");
  const [eta, setEta] = useState(30);

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl w-full max-w-sm mx-4 p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {step === 1 && (<>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50">遅刻を報告する</h2>
            <span className="text-[12px] text-zinc-400">1 / 2</span>
          </div>
          <p className="text-[13px] text-zinc-400 mb-4">遅刻の理由を入力してください</p>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="例：電車遅延のため"
            rows={4}
            autoFocus
            className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[16px] resize-none mb-4 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          />
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-[17px] font-semibold text-zinc-600 dark:text-zinc-300">
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!reason.trim()}
              className="flex-1 py-3 rounded-2xl bg-amber-500 text-white text-[17px] font-semibold disabled:opacity-50"
            >次へ</button>
          </div>
        </>)}
        {step === 2 && (<>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50">到着予定</h2>
            <span className="text-[12px] text-zinc-400">2 / 2</span>
          </div>
          <p className="text-[13px] text-zinc-400 mb-5">何分後に到着予定ですか？</p>
          <div className="grid grid-cols-3 gap-2 mb-5">
            {ETA_OPTS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => setEta(value)}
                className={`py-2.5 rounded-xl text-[15px] font-semibold active:opacity-70 ${
                  eta === value
                    ? "bg-amber-500 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
                }`}
              >{label}</button>
            ))}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(1)}
              className="flex-1 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-[17px] font-semibold text-zinc-600 dark:text-zinc-300">
              戻る
            </button>
            <button
              type="button"
              onClick={() => onSubmit(reason, eta)}
              disabled={isPending}
              className="flex-1 py-3 rounded-2xl bg-amber-500 text-white text-[17px] font-semibold disabled:opacity-50"
            >{isPending ? "送信中..." : "報告する"}</button>
          </div>
        </>)}
      </div>
    </div>
  );
}
