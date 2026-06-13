"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import {
  submitMyOffRequestAction,
  withdrawMyOffRequestAction,
  fetchMyOffRequestsForMonthAction,
} from "./staff-off-request-actions";

const WD = ["日", "月", "火", "水", "木", "金", "土"];

// 夜空背景に映えるRPG配色
const PRIORITIES = [
  { key: "第一希望休", label: "第1希望", color: "bg-amber-400 text-[#000846]" },
  { key: "第二希望休", label: "第2希望", color: "bg-cyan-400 text-[#000846]" },
  { key: "第三希望休", label: "第3希望", color: "bg-purple-400 text-white" },
  { key: "第四希望休", label: "第4希望", color: "bg-zinc-400 text-[#000846]" },
];

const PRIORITY_CELL_COLOR: Record<string, string> = {
  "第一希望休": "bg-amber-400 text-[#000846]",
  "第二希望休": "bg-cyan-400 text-[#000846]",
  "第三希望休": "bg-purple-400 text-white",
  "第四希望休": "bg-zinc-400 text-[#000846]",
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
    <div className="space-y-3 p-4 text-white">
      {/* 月ナビ */}
      <div className="flex items-center justify-between">
        <button onClick={() => goMonth(-1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/40 text-white/80 hover:bg-white/10 active:scale-95 transition">
          ◀
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-amber-300 tabular-nums">{year}年 {month}月</p>
          {maxDaysPerMonth !== null && (
            <p className={`text-[11px] tabular-nums ${(remaining ?? 0) <= 0 ? "text-red-300 font-bold" : "text-white/50"}`}>
              申請枠: 残{remaining ?? 0}/{maxDaysPerMonth}日
            </p>
          )}
        </div>
        <button onClick={() => goMonth(1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/40 text-white/80 hover:bg-white/10 active:scale-95 transition">
          ▶
        </button>
      </div>

      {/* バナー */}
      {beforeOpen && isCurrentMonth && openDay !== null && (
        <div className="text-xs rounded-lg px-3 py-2 border border-cyan-400/40 bg-cyan-400/10 text-cyan-200">
          申請受付は毎月{openDay}日から開始します（現在{todayD}日）
        </div>
      )}
      {pastDeadline && (
        <div className="text-xs rounded-lg px-3 py-2 border border-amber-300/40 bg-amber-300/10 text-amber-200">
          申請期日（{deadlineDay}日）を過ぎたため今月の申請・取り下げはできません
        </div>
      )}
      {!beforeOpen && !pastDeadline && deadlineDay !== null && isCurrentMonth && (
        <div className="text-xs text-white/50 px-1">
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
          <div key={w} className={`text-[11px] font-bold pb-1 ${i === 0 ? "text-red-300" : i === 6 ? "text-sky-300" : "text-white/60"}`}>{w}</div>
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
            cls += dow === 0 ? "text-red-300/30" : dow === 6 ? "text-sky-300/30" : "text-white/20";
          } else {
            cls += `cursor-pointer ${dow === 0 ? "text-red-300 hover:bg-white/10" : dow === 6 ? "text-sky-300 hover:bg-white/10" : "text-white hover:bg-white/10"}`;
          }

          return (
            <div key={ds} className={cls} onClick={() => handleCellClick(ds)}>
              <div>{d}</div>
              {req && <div className="text-[8px] font-bold leading-none mt-0.5 opacity-90">{PRIORITY_SHORT[req.priority] ?? ""}</div>}
            </div>
          );
        })}
      </div>

      {loading && <p className="text-xs text-white/40 text-center">読み込み中...</p>}
      {error && <p className="text-xs text-red-300 text-center">{error}</p>}

      {/* 申請モーダル */}
      {modal.type === "apply" && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-end sm:items-center justify-center p-4"
          onClick={() => setModal({ type: "none" })}>
          <div className="rounded-lg border-2 border-white bg-[#000846] p-[3px] max-w-sm w-full"
            onClick={e => e.stopPropagation()}>
            <div className="rounded-md border border-white/80 bg-[#000846] p-5">
              <p className="text-xs text-white/50 mb-1">きゅうかを もうしでる</p>
              <p className="text-xl font-bold text-amber-300 mb-4">{fmtDate(modal.date)}</p>
              <p className="text-xs font-semibold text-cyan-300 mb-2">▼ ゆうせんどを えらぶ</p>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {PRIORITIES.map(p => (
                  <button key={p.key} type="button"
                    onClick={() => handleSubmit(p.key)}
                    disabled={isPending}
                    className={`py-3 rounded-lg text-sm font-bold transition-opacity disabled:opacity-50 active:scale-95 ${p.color}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setModal({ type: "none" })}
                className="w-full py-2.5 rounded-lg border-2 border-white text-sm text-white hover:bg-white/10 active:scale-[0.98] transition">
                ▶ キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 取り下げモーダル */}
      {modal.type === "withdraw" && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-end sm:items-center justify-center p-4"
          onClick={() => setModal({ type: "none" })}>
          <div className="rounded-lg border-2 border-white bg-[#000846] p-[3px] max-w-sm w-full"
            onClick={e => e.stopPropagation()}>
            <div className="rounded-md border border-white/80 bg-[#000846] p-5">
              <p className="text-xs text-white/50 mb-1">もうしでずみの きゅうか</p>
              <p className="text-xl font-bold text-amber-300 mb-2">{fmtDate(modal.req.request_date)}</p>
              <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${PRIORITY_CELL_COLOR[modal.req.priority] ?? "bg-zinc-400 text-white"}`}>
                {PRIORITY_SHORT[modal.req.priority] ?? modal.req.priority}
              </span>

              {!withdrawable(modal.req) && (
                <p className="mt-3 text-xs text-amber-200 border border-amber-300/40 bg-amber-300/10 rounded-lg px-3 py-2">
                  申請期日を過ぎているため取り下げできません
                </p>
              )}

              <div className="flex gap-2 mt-4">
                {withdrawable(modal.req) && (
                  <button type="button" onClick={handleWithdraw} disabled={isPending}
                    className="flex-1 py-2.5 rounded-lg border-2 border-red-400 text-red-200 hover:bg-red-400/15 disabled:opacity-50 text-sm font-semibold active:scale-95 transition">
                    {isPending ? "処理中..." : "▶ とりさげる"}
                  </button>
                )}
                <button type="button" onClick={() => setModal({ type: "none" })}
                  className="flex-1 py-2.5 rounded-lg border-2 border-white text-sm text-white hover:bg-white/10 active:scale-[0.98] transition">
                  ▶ とじる
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
