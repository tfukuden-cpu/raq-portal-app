"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import {
  submitMyOffRequestAction,
  withdrawMyOffRequestAction,
  fetchMyOffRequestsForMonthAction,
} from "./staff-off-request-actions";

const WD = ["日", "月", "火", "水", "木", "金", "土"];

const PRIORITIES = [
  { key: "第一希望休", label: "第1希望", color: "bg-blue-600 text-white" },
  { key: "第二希望休", label: "第2希望", color: "bg-indigo-500 text-white" },
  { key: "第三希望休", label: "第3希望", color: "bg-purple-500 text-white" },
  { key: "第四希望休", label: "第4希望", color: "bg-zinc-500 text-white" },
];

const PRIORITY_CELL_COLOR: Record<string, string> = {
  "第一希望休": "bg-blue-500 text-white",
  "第二希望休": "bg-indigo-400 text-white",
  "第三希望休": "bg-purple-400 text-white",
  "第四希望休": "bg-zinc-400 text-white",
};
const PRIORITY_SHORT: Record<string, string> = {
  "第一希望休": "第1", "第二希望休": "第2", "第三希望休": "第3", "第四希望休": "第4",
};

type Request = { id: string; request_date: string; priority: string };

type Modal =
  | { type: "none" }
  | { type: "apply"; date: string }
  | { type: "withdraw"; req: Request };

function dateStr(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function fmtDate(ds: string) {
  const d = new Date(ds + "T00:00:00+09:00");
  return `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
}

export default function StaffOffRequestCalendar({
  initialYear,
  initialMonth,
  deadlineDay = null,
  openDay = null,
  maxDaysPerMonth = null,
}: {
  initialYear: number;
  initialMonth: number;
  deadlineDay?: number | null;
  openDay?: number | null;
  maxDaysPerMonth?: number | null;
}) {
  const [year, setYear]       = useState(initialYear);
  const [month, setMonth]     = useState(initialMonth);
  const [requests, setRequests] = useState<Request[]>([]);
  const [modal, setModal]     = useState<Modal>({ type: "none" });
  const [isPending, startTr]  = useTransition();
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const today     = new Date();
  const todayY    = today.getFullYear();
  const todayM    = today.getMonth() + 1;
  const todayD    = today.getDate();

  const isCurrentMonth = year === todayY && month === todayM;
  const pastDeadline   = deadlineDay !== null && isCurrentMonth && todayD > deadlineDay;
  const beforeOpen     = openDay !== null && isCurrentMonth && todayD < openDay;

  const loadRequests = useCallback(async () => {
    setLoading(true);
    const data = await fetchMyOffRequestsForMonthAction(year, month);
    setRequests(data);
    setLoading(false);
  }, [year, month]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const reqMap = new Map(requests.map(r => [r.request_date, r]));
  const monthStr   = `${year}-${String(month).padStart(2, "0")}`;
  const thisMonthCount = requests.filter(r => r.request_date.startsWith(monthStr)).length;
  const remaining  = maxDaysPerMonth !== null ? maxDaysPerMonth - thisMonthCount : null;

  const firstDow   = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const goMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const handleCellClick = (ds: string) => {
    const existing = reqMap.get(ds);
    if (existing) {
      setModal({ type: "withdraw", req: existing });
      return;
    }
    const dow = new Date(ds + "T00:00:00").getDay();
    const isPast = ds < `${todayY}-${String(todayM).padStart(2,"0")}-${String(todayD).padStart(2,"0")}`;
    if (isPast || pastDeadline || beforeOpen) return;
    if (remaining !== null && remaining <= 0) return;
    setError(null);
    setModal({ type: "apply", date: ds });
  };

  const handleSubmit = (priority: string) => {
    if (modal.type !== "apply") return;
    startTr(async () => {
      const r = await submitMyOffRequestAction(modal.date, priority);
      if (!r.success) { setError(r.message ?? "申請に失敗しました"); return; }
      await loadRequests();
      setModal({ type: "none" });
    });
  };

  const handleWithdraw = () => {
    if (modal.type !== "withdraw") return;
    startTr(async () => {
      const r = await withdrawMyOffRequestAction(modal.req.id);
      if (!r.success) { setError(r.message ?? "取り下げに失敗しました"); return; }
      await loadRequests();
      setModal({ type: "none" });
    });
  };

  // 期日チェック（取り下げ）
  const withdrawable = (req: Request) => {
    if (deadlineDay === null) return true;
    const reqM = parseInt(req.request_date.slice(5, 7));
    const reqY = parseInt(req.request_date.slice(0, 4));
    const isReqCurrentMonth = reqY === todayY && reqM === todayM;
    return !(isReqCurrentMonth && todayD > deadlineDay);
  };

  return (
    <div className="space-y-3">
      {/* 月ナビ */}
      <div className="flex items-center justify-between">
        <button onClick={() => goMonth(-1)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
          <ChevronLeftIcon className="w-4 h-4 text-zinc-500" />
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{year}年 {month}月</p>
          {maxDaysPerMonth !== null && (
            <p className={`text-[11px] tabular-nums ${(remaining ?? 0) <= 0 ? "text-red-500 font-bold" : "text-zinc-400"}`}>
              申請枠: 残{remaining ?? 0}/{maxDaysPerMonth}日
            </p>
          )}
        </div>
        <button onClick={() => goMonth(1)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
          <ChevronRightIcon className="w-4 h-4 text-zinc-500" />
        </button>
      </div>

      {/* バナー */}
      {beforeOpen && isCurrentMonth && openDay !== null && (
        <div className="text-xs rounded-xl px-3 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
          申請受付は毎月{openDay}日から開始します（現在{todayD}日）
        </div>
      )}
      {pastDeadline && (
        <div className="text-xs rounded-xl px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
          申請期日（{deadlineDay}日）を過ぎたため今月の申請・取り下げはできません
        </div>
      )}
      {!beforeOpen && !pastDeadline && deadlineDay !== null && isCurrentMonth && (
        <div className="text-xs text-zinc-400 px-1">
          申請受付: {openDay !== null ? `${openDay}日〜` : ""}{deadlineDay}日
        </div>
      )}

      {/* 凡例 */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        {PRIORITIES.map(p => (
          <span key={p.key} className={`px-2 py-0.5 rounded font-bold ${p.color}`}>{p.label}</span>
        ))}
      </div>

      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {WD.map((w, i) => (
          <div key={w} className={`text-[11px] font-bold pb-1 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-zinc-500"}`}>{w}</div>
        ))}
      </div>

      {/* カレンダー本体 */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
          const ds  = dateStr(year, month, d);
          const req = reqMap.get(ds);
          const dow = new Date(year, month - 1, d).getDay();
          const isPast = ds < `${todayY}-${String(todayM).padStart(2,"0")}-${String(todayD).padStart(2,"0")}`;
          const isBlocked = isPast || (pastDeadline && isCurrentMonth) || beforeOpen;

          let cls = "rounded-lg py-1.5 text-[13px] font-medium transition-colors select-none ";
          if (req) {
            cls += `${PRIORITY_CELL_COLOR[req.priority] ?? "bg-zinc-400 text-white"} cursor-pointer`;
          } else if (isBlocked || (remaining !== null && remaining <= 0)) {
            cls += dow === 0 ? "text-red-300 dark:text-red-900" : dow === 6 ? "text-blue-300 dark:text-blue-900" : "text-zinc-300 dark:text-zinc-700";
          } else {
            cls += `cursor-pointer ${dow === 0 ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" : dow === 6 ? "text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20" : "text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`;
          }

          return (
            <div key={ds} className={cls} onClick={() => handleCellClick(ds)}>
              <div>{d}</div>
              {req && <div className="text-[8px] font-bold leading-none mt-0.5 opacity-90">{PRIORITY_SHORT[req.priority] ?? ""}</div>}
            </div>
          );
        })}
      </div>

      {loading && <p className="text-xs text-zinc-400 text-center">読み込み中...</p>}
      {error && <p className="text-xs text-red-500 text-center">{error}</p>}

      {/* 申請モーダル */}
      {modal.type === "apply" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-4"
          onClick={() => setModal({ type: "none" })}>
          <div className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <p className="text-xs font-medium text-zinc-400 mb-1">希望休を申請</p>
            <p className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">{fmtDate(modal.date)}</p>
            <p className="text-xs font-semibold text-zinc-500 mb-2">優先度を選択</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {PRIORITIES.map(p => (
                <button key={p.key} type="button"
                  onClick={() => handleSubmit(p.key)}
                  disabled={isPending}
                  className={`py-3 rounded-xl text-sm font-bold transition-opacity disabled:opacity-50 ${p.color}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button onClick={() => setModal({ type: "none" })}
              className="w-full py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-400">
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* 取り下げモーダル */}
      {modal.type === "withdraw" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-4"
          onClick={() => setModal({ type: "none" })}>
          <div className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <p className="text-xs font-medium text-zinc-400 mb-1">申請済みの希望休</p>
            <p className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">{fmtDate(modal.req.request_date)}</p>
            <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${PRIORITY_CELL_COLOR[modal.req.priority] ?? "bg-zinc-400 text-white"}`}>
              {PRIORITY_SHORT[modal.req.priority] ?? modal.req.priority}
            </span>

            {!withdrawable(modal.req) && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2">
                申請期日を過ぎているため取り下げできません
              </p>
            )}

            <div className="flex gap-2 mt-4">
              {withdrawable(modal.req) && (
                <button type="button" onClick={handleWithdraw} disabled={isPending}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold">
                  {isPending ? "処理中..." : "取り下げる"}
                </button>
              )}
              <button type="button" onClick={() => setModal({ type: "none" })}
                className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-400">
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
