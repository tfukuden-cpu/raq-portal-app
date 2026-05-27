"use client";

import { useState, useTransition } from "react";
import { addTrainingDateAction, removeTrainingDateAction } from "@/app/(portal)/admin/[projectId]/settings/training-actions";
import { PlusIcon, XIcon } from "@/components/icons";

export type TrainingDate = { id: string; training_date: string };

interface Props {
  staffId: string;
  initialDates: TrainingDate[];
}

function fmt(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${y}/${parseInt(m)}/${parseInt(d)}`;
}

export default function TrainingSection({ staffId, initialDates }: Props) {
  const [dates, setDates]       = useState<TrainingDate[]>(initialDates);
  const [input, setInput]       = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [isPending, startTrans] = useTransition();

  function handleAdd() {
    if (!input) return;
    setError(null);
    startTrans(async () => {
      const r = await addTrainingDateAction(staffId, input);
      if (r.success && r.id) {
        setDates(prev => [...prev, { id: r.id!, training_date: input }]
          .sort((a, b) => a.training_date.localeCompare(b.training_date)));
        setInput("");
      } else {
        setError(r.message ?? "追加できませんでした");
      }
    });
  }

  function handleRemove(id: string) {
    startTrans(async () => {
      const r = await removeTrainingDateAction(id);
      if (r.success) {
        setDates(prev => prev.filter(d => d.id !== id));
      }
    });
  }

  return (
    <div className="space-y-2">
      <label className="text-[10px] text-zinc-500 font-semibold">導入研修日</label>

      {/* 登録済み日付チップ */}
      {dates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {dates.map(d => (
            <span
              key={d.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-[11px] font-medium border border-blue-200 dark:border-blue-800"
            >
              {fmt(d.training_date)}
              <button
                type="button"
                onClick={() => handleRemove(d.id)}
                disabled={isPending}
                className="text-blue-400 hover:text-blue-700 dark:hover:text-blue-200 transition-colors"
              >
                <XIcon className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 日付追加 */}
      <div className="flex gap-1.5">
        <input
          type="date"
          value={input}
          onChange={e => { setInput(e.target.value); setError(null); }}
          className="flex-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!input || isPending}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          追加
        </button>
      </div>

      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
