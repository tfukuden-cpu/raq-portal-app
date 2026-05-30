"use client";

import { useState } from "react";

const ETA_OPTS = [
  { label: "すぐ着く", value: 5 },  { label: "10分", value: 10 },
  { label: "20分",     value: 20 },  { label: "30分", value: 30 },
  { label: "45分",     value: 45 },  { label: "1時間以上", value: 60 },
];

function DepartureIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>
    </svg>
  );
}

export function DepartureModal({ onClose, onSubmit, isPending }: {
  onClose: () => void;
  onSubmit: (etaMinutes: number) => void;
  isPending: boolean;
}) {
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
        <div className="flex items-center gap-2 mb-1">
          <DepartureIcon className="w-5 h-5 text-blue-600" />
          <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50">出発を報告する</h2>
        </div>
        <p className="text-[13px] text-zinc-400 mb-5">到着予定を選んでください</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {ETA_OPTS.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => setEta(value)}
              className={`py-2.5 rounded-xl text-[15px] font-semibold active:opacity-70 ${
                eta === value
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
              }`}
            >{label}</button>
          ))}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-[17px] font-semibold text-zinc-600 dark:text-zinc-300"
          >キャンセル</button>
          <button
            type="button"
            onClick={() => onSubmit(eta)}
            disabled={isPending}
            className="flex-1 py-3 rounded-2xl bg-blue-600 text-white text-[17px] font-semibold disabled:opacity-50"
          >報告する</button>
        </div>
      </div>
    </div>
  );
}
