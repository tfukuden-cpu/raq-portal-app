"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveShiftRequestAction, rejectShiftRequestAction } from "./actions";

type ShiftRequest = {
  id: string;
  staff_name: string;
  request_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  reason: string | null;
  status: string;
};

type Props = { requests: ShiftRequest[] };

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

function fmt5(t: string | null) { return t ? t.slice(0, 5) : ""; }

export default function ShiftRequestsAdmin({ requests }: Props) {
  const router = useRouter();
  const [isPending, startTrans] = useTransition();
  const [feedback, setFeedback] = useState<{ id: string; ok: boolean; msg: string } | null>(null);
  const [open, setOpen] = useState(true);

  const pendingCount = requests.filter(r => r.status === "pending").length;

  const handle = (id: string, action: "approve" | "reject") => {
    setFeedback(null);
    startTrans(async () => {
      const res = action === "approve"
        ? await approveShiftRequestAction(id)
        : await rejectShiftRequestAction(id);
      setFeedback({ id, ok: res.success, msg: res.message ?? "" });
      if (res.success) router.refresh();
    });
  };

  if (requests.length === 0) return null;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">追加申請</span>
          {pendingCount > 0 && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
              審査中 {pendingCount}件
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border-t border-zinc-100 dark:border-zinc-800">
          {requests.map(req => {
            const d = new Date(req.request_date + "T00:00:00+09:00");
            const [, mm, dd] = req.request_date.split("-");
            const dow = WEEKDAY[d.getDay()];
            return (
              <div key={req.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono tabular-nums text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {Number(mm)}/{Number(dd)}（{dow}）
                      </span>
                      {req.shift_name && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                          {req.shift_name}
                        </span>
                      )}
                      {req.shift_start && req.shift_end && (
                        <span className="text-xs font-mono tabular-nums text-zinc-500">
                          {fmt5(req.shift_start)}〜{fmt5(req.shift_end)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">{req.staff_name}</p>
                    {req.reason && (
                      <p className="text-xs text-zinc-400 mt-0.5">{req.reason}</p>
                    )}
                  </div>

                  {req.status === "pending" && (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handle(req.id, "approve")}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
                      >
                        承認
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handle(req.id, "reject")}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                      >
                        却下
                      </button>
                    </div>
                  )}

                  {req.status !== "pending" && (
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${
                      req.status === "approved"
                        ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                        : "bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                    }`}>
                      {req.status === "approved" ? "承認済" : "却下"}
                    </span>
                  )}
                </div>

                {feedback?.id === req.id && (
                  <p className={`text-xs mt-1.5 ${feedback.ok ? "text-emerald-600" : "text-red-500"}`}>
                    {feedback.msg}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
