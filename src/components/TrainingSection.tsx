"use client";

import { useState, useTransition } from "react";
import { addTrainingDateAction, removeTrainingDateAction } from "@/app/(portal)/admin/[projectId]/settings/training-actions";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

export type TrainingDate = { id: string; training_date: string };

interface Props {
  staffId: string;
  initialDates: TrainingDate[];
}

const DOW_JP = ["日", "月", "火", "水", "木", "金", "土"];

function toYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fmtLabel(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

export default function TrainingSection({ staffId, initialDates }: Props) {
  const now = new Date();
  const [dates, setDates]         = useState<TrainingDate[]>(initialDates);
  const [viewYear, setViewYear]   = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-based
  const [error, setError]         = useState<string | null>(null);
  const [isPending, startTrans]   = useTransition();

  // date string → id  (for quick lookup)
  const savedMap = new Map(dates.map(d => [d.training_date, d.id]));

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  function handleToggle(day: number) {
    const dateStr = toYMD(viewYear, viewMonth, day);
    const existingId = savedMap.get(dateStr);
    setError(null);

    if (existingId) {
      // 削除
      startTrans(async () => {
        const r = await removeTrainingDateAction(existingId);
        if (r.success) {
          setDates(prev => prev.filter(d => d.id !== existingId));
        } else {
          setError(r.message ?? "削除できませんでした");
        }
      });
    } else {
      // 追加
      startTrans(async () => {
        const r = await addTrainingDateAction(staffId, dateStr);
        if (r.success && r.id) {
          setDates(prev =>
            [...prev, { id: r.id!, training_date: dateStr }]
              .sort((a, b) => a.training_date.localeCompare(b.training_date))
          );
        } else {
          setError(r.message ?? "追加できませんでした");
        }
      });
    }
  }

  // カレンダー構築
  const firstDow = new Date(viewYear, viewMonth, 1).getDay(); // 0=日
  const lastDay  = new Date(viewYear, viewMonth + 1, 0).getDate();
  // cells: null=空欄, number=日
  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: lastDay }, (_, i) => i + 1),
  ];

  return (
    <div className="space-y-2">
      {/* 月ナビゲーション */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          disabled={isPending}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors disabled:opacity-40"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums select-none">
          {viewYear}年{viewMonth + 1}月
        </span>
        <button
          type="button"
          onClick={nextMonth}
          disabled={isPending}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors disabled:opacity-40"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>

      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7">
        {DOW_JP.map((w, i) => (
          <div
            key={w}
            className={`text-center text-[10px] font-semibold pb-1 select-none ${
              i === 0 ? "text-red-400"
              : i === 6 ? "text-blue-400"
              : "text-zinc-400 dark:text-zinc-500"
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 日付グリッド */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, idx) => {
          if (!day) return <div key={`e-${idx}`} />;
          const dateStr    = toYMD(viewYear, viewMonth, day);
          const isSelected = savedMap.has(dateStr);
          const dowIdx     = (firstDow + day - 1) % 7; // 0=日
          const isSun      = dowIdx === 0;
          const isSat      = dowIdx === 6;

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => handleToggle(day)}
              disabled={isPending}
              title={dateStr}
              className={[
                "mx-auto flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-all tabular-nums",
                isSelected
                  ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-400/30"
                  : isSun
                  ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                  : isSat
                  ? "text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                isPending ? "opacity-50 cursor-wait" : "cursor-pointer",
              ].join(" ")}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* 登録済み一覧 */}
      {dates.length > 0 && (
        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <p className="text-[9px] text-zinc-400 font-semibold uppercase tracking-wide mb-1 select-none">
            登録済み（{dates.length}日）
          </p>
          <div className="flex flex-wrap gap-1">
            {dates.map(d => (
              <span
                key={d.id}
                className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-[11px] font-medium border border-blue-200 dark:border-blue-800"
              >
                {fmtLabel(d.training_date)}
              </span>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
      {isPending && (
        <p className="text-[11px] text-zinc-400 animate-pulse">処理中…</p>
      )}
    </div>
  );
}
