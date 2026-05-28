"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleBreakAction } from "./actions";
import { getSeatBgClass, formatSectionShift } from "@/lib/seatColors";

export type WallData = {
  x1Pct: number;
  y1Pct: number;
  x2Pct: number;
  y2Pct: number;
};

export type SeatData = {
  id: string;
  label: string;
  xPct: number;
  yPct: number;
  section: string | null;
  seatType: "normal" | "free" | "disabled";
  staffId: string | null;
  staffName: string | null;
  accountNumber: string | null;
  shiftSlot: string | null;  // 席のシフト帯設定（早番/遅番）
  shiftName: string | null;  // 配置スタッフの実際のシフト名（優先）
  status: "not_arrived" | "working" | "on_break" | "clocked_out" | "absent" | null;
};

const STATUS_BG: Record<NonNullable<SeatData["status"]>, string> = {
  not_arrived: "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-600",
  working:     "bg-green-100 dark:bg-green-900/60 border-green-400 dark:border-green-600",
  on_break:    "bg-amber-100 dark:bg-amber-900/60 border-amber-400 dark:border-amber-600",
  clocked_out: "bg-zinc-100 dark:bg-zinc-700 border-zinc-300 dark:border-zinc-500",
  absent:      "bg-red-100 dark:bg-red-900/60 border-red-400 dark:border-red-600",
};

const STATUS_TEXT: Record<NonNullable<SeatData["status"]>, string> = {
  not_arrived: "text-zinc-400",
  working:     "text-green-800 dark:text-green-200",
  on_break:    "text-amber-800 dark:text-amber-200",
  clocked_out: "text-zinc-400 dark:text-zinc-400",
  absent:      "text-red-700 dark:text-red-300",
};

const STATUS_LABEL: Record<NonNullable<SeatData["status"]>, string> = {
  not_arrived: "未出勤",
  working:     "勤務中",
  on_break:    "休憩中",
  clocked_out: "退勤済",
  absent:      "欠勤",
};

export default function SeatingClient({
  projectId, today, seats, walls = [], isAdmin, myStaffId, embedded = false,
}: {
  projectId: string;
  today: string;
  seats: SeatData[];
  walls?: WallData[];
  isAdmin: boolean;
  myStaffId: string;
  embedded?: boolean;
}) {
  const [statuses, setStatuses] = useState<Map<string, NonNullable<SeatData["status"]>>>(() => {
    const m = new Map<string, NonNullable<SeatData["status"]>>();
    seats.forEach(s => { if (s.staffId && s.status) m.set(s.staffId, s.status); });
    return m;
  });
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();

  function handleTap(seat: SeatData) {
    if (!seat.staffId) return;
    const status = statuses.get(seat.staffId) ?? seat.status;
    // 出勤中 or 休憩中のみトグル可
    if (status !== "working" && status !== "on_break") return;
    // 自分の席 or 管理者のみ
    if (!isAdmin && seat.staffId !== myStaffId) return;

    startTransition(async () => {
      const res = await toggleBreakAction(projectId, seat.staffId!);
      if (res.success && res.newStatus) {
        setStatuses(prev => new Map(prev).set(seat.staffId!, res.newStatus!));
        setToast(res.newStatus === "on_break" ? "休憩開始" : "休憩終了");
        setTimeout(() => setToast(null), 2000);
      }
    });
  }

  const [, monthStr, dayStr] = today.split("-");
  const dateLabel = `${parseInt(monthStr)}/${parseInt(dayStr)}`;

  return (
    <div className={embedded ? "" : "min-h-screen bg-zinc-50 dark:bg-zinc-950"}>
      {/* ヘッダー（スタンドアロン時のみ） */}
      {!embedded && (
        <div className="sticky top-0 z-20 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800 px-4 py-3 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-bold text-zinc-800 dark:text-zinc-100">座席表</h1>
            <p className="text-xs text-zinc-400 tabular-nums">{dateLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <a
                href="/seating/plan"
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 hover:bg-blue-100 transition-colors"
              >
                翌日配置
              </a>
            )}
            <button
              onClick={() => router.refresh()}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700"
            >
              更新
            </button>
          </div>
        </div>
      )}

      {/* 凡例 */}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${embedded ? "" : "px-4"}`}>
        {(Object.entries(STATUS_LABEL) as [NonNullable<SeatData["status"]>, string][]).map(([s, label]) => (
          <div key={s} className="flex items-center gap-1">
            <span className={`w-2.5 h-2.5 rounded-sm border-2 ${STATUS_BG[s]}`} />
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</span>
          </div>
        ))}
        <span className="text-[11px] text-zinc-400">・タップで休憩切替</span>
      </div>

      {/* キャンバス */}
      <div className={`overflow-x-auto ${embedded ? "px-3 pb-4" : "px-3 pb-28"}`}>
        <div
          className="relative bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
          style={{ width: "max(100%, 1800px)", aspectRatio: "3/2" }}
        >
          {seats.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <p className="text-sm text-zinc-400">座席が設定されていません</p>
              {isAdmin && (
                <a href="/admin" className="text-xs text-blue-600 dark:text-blue-400 underline">
                  案件設定 → 座席タブで設定
                </a>
              )}
            </div>
          )}

          {/* 壁 */}
          {walls.length > 0 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {walls.map((w, i) => (
                <line
                  key={i}
                  x1={`${w.x1Pct}%`} y1={`${w.y1Pct}%`}
                  x2={`${w.x2Pct}%`} y2={`${w.y2Pct}%`}
                  stroke="#71717a"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ))}
            </svg>
          )}

          {seats.map(seat => {
            const isDisabled = seat.seatType === "disabled";
            const isFree     = seat.seatType === "free";
            const status = (!isDisabled && seat.staffId)
              ? (statuses.get(seat.staffId) ?? seat.status ?? "not_arrived")
              : null;
            const tappable =
              !isDisabled &&
              seat.staffId &&
              (status === "working" || status === "on_break") &&
              (isAdmin || seat.staffId === myStaffId);

            if (isDisabled) {
              return (
                <div
                  key={seat.id}
                  style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
                  className="absolute w-[70px] h-[58px] rounded-xl border-2 border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800 opacity-50 flex flex-col items-center justify-center overflow-hidden"
                >
                  {/* ハッチング */}
                  <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
                    <defs>
                      <pattern id={`hatch-${seat.id}`} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" strokeWidth="1.5" className="text-zinc-300 dark:text-zinc-600" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill={`url(#hatch-${seat.id})`} />
                  </svg>
                  <span className="relative text-[9px] text-zinc-400 leading-none z-10">{seat.label}</span>
                  <span className="relative text-[9px] text-zinc-400 leading-none z-10 mt-0.5">無効</span>
                </div>
              );
            }

            return (
              <button
                key={seat.id}
                onClick={() => handleTap(seat)}
                disabled={isPending || !tappable}
                style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
                className={[
                  "absolute flex flex-col items-center justify-center gap-px",
                  "w-[70px] h-[58px] rounded-xl border-2 text-center transition-all shadow-sm select-none overflow-hidden",
                  status ? STATUS_BG[status]
                    : isFree
                    ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-700"
                    : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700",
                  tappable ? "cursor-pointer active:scale-95" : "cursor-default",
                  isPending ? "opacity-60" : "",
                ].join(" ")}
              >
                {/* セクション色バー（上部）：スタッフのシフト名優先、なければ席のシフト帯設定 */}
                {seat.section && !isFree && (
                  <div className={`absolute top-0 left-0 right-0 h-1 rounded-t-[10px] ${getSeatBgClass(seat.section, seat.shiftName ?? seat.shiftSlot)}`} />
                )}
                <span className="text-[9px] text-zinc-400 leading-none">{seat.label}</span>
                {seat.staffName ? (
                  <>
                    <span className="text-[10px] font-mono text-zinc-400 tabular-nums leading-none">
                      {seat.accountNumber ?? ""}
                    </span>
                    <span className={`text-[11px] font-bold leading-tight px-0.5 w-full truncate text-center ${status ? STATUS_TEXT[status] : ""}`}>
                      {seat.staffName}
                    </span>
                    {(() => {
                      const label = formatSectionShift(seat.section, seat.shiftName ?? seat.shiftSlot);
                      return label ? (
                        <span className="text-[9px] leading-none text-zinc-500 dark:text-zinc-400 truncate px-0.5 w-full text-center">
                          {label}
                        </span>
                      ) : null;
                    })()}
                  </>
                ) : (
                  <span className={`text-[10px] mt-0.5 ${isFree ? "text-emerald-400 dark:text-emerald-600" : "text-zinc-300 dark:text-zinc-600"}`}>
                    {isFree ? "FREE" : "空席"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* トースト */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
