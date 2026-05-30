"use client";

import { useState, useTransition } from "react";
import { ChevronLeftIcon } from "@/components/icons";
import { withdrawHolidayAction } from "@/app/(portal)/holidays/actions";
import HolidayCalendar from "@/app/(portal)/holidays/HolidayCalendar";
import MyOffRequestsCard from "./MyOffRequestsCard";

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

const STATUS_STYLE: Record<string, string> = {
  pending:  "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300",
  approved: "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300",
  rejected: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "申請中", approved: "承認済", rejected: "却下",
};

type HolidayRequest = {
  id: string;
  request_date: string;
  status: string;
  note: string | null;
};

type Props = {
  projectId: string;
  holidayRequests: HolidayRequest[];
  initialYear: number;
  initialMonth: number;
  openDay?: number | null;
  deadlineDay?: number | null;
  maxDaysPerMonth?: number | null;
  weekendLimit?: number | null;
};

export default function HolidayTab({
  projectId,
  holidayRequests,
  initialYear,
  initialMonth,
  openDay = null,
  deadlineDay = null,
  maxDaysPerMonth = null,
  weekendLimit = null,
}: Props) {
  const [view, setView] = useState<"list" | "apply">("list");
  const [selected, setSelected] = useState<HolidayRequest | null>(null);
  const [localRequests, setLocalRequests] = useState<HolidayRequest[]>(holidayRequests);
  const [isPending, startTransition] = useTransition();

  const today = new Date();
  const todayYear  = today.getFullYear();
  const todayMonth = today.getMonth() + 1;
  const todayDay   = today.getDate();

  function handleWithdraw(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      await withdrawHolidayAction(fd);
      setLocalRequests(prev => prev.filter(r => r.id !== id));
      setSelected(null);
    });
  }

  // 申請画面：月ナビは親（ShiftsTabs）が担うので hideNav=true
  if (view === "apply") {
    return (
      <div className="h-full overflow-y-auto">
        <button
          type="button"
          onClick={() => setView("list")}
          className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-blue-500 transition-colors mb-3"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
          一覧に戻る
        </button>
        <HolidayCalendar
          initialYear={initialYear}
          initialMonth={initialMonth}
          appliedRequests={localRequests}
          openDay={openDay}
          deadlineDay={deadlineDay}
          maxDaysPerMonth={maxDaysPerMonth}
          weekendLimit={weekendLimit}
          hideNav={true}
        />
      </div>
    );
  }

  // 一覧ビュー
  const upcoming = localRequests
    .filter(r => r.request_date >= `${todayYear}-${String(todayMonth).padStart(2, "0")}-01`)
    .sort((a, b) => a.request_date.localeCompare(b.request_date));

  return (
    <div className="h-full overflow-y-auto space-y-3">
      {/* 提出済み希望休（Googleフォーム経由インポートデータ） */}
      <MyOffRequestsCard
        projectId={projectId}
        initialYear={initialYear}
        initialMonth={initialMonth}
      />

      {/* 申請ボタン */}
      <button
        type="button"
        onClick={() => setView("apply")}
        className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-colors"
      >
        希望休を申請する
      </button>

      {/* 一覧 */}
      {upcoming.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-10 text-center text-sm text-zinc-400">
          申請済みの希望休はありません
        </div>
      ) : (
        <ul className="space-y-2">
          {upcoming.map(r => {
            const d = new Date(r.request_date + "T00:00:00+09:00");
            const m = d.getMonth() + 1;
            const day = d.getDate();
            const dow = WEEKDAY_JP[d.getDay()];
            const isCurrentMonth = d.getFullYear() === todayYear && m === todayMonth;
            const pastDeadline = deadlineDay !== null && isCurrentMonth && todayDay > deadlineDay;
            const canWithdraw = (r.status === "pending" || r.status === "approved") && !pastDeadline;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => canWithdraw ? setSelected(r) : undefined}
                  className={`w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-left transition-colors ${
                    canWithdraw ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/60 active:bg-zinc-100" : ""
                  }`}
                >
                  <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 tabular-nums flex-1">
                    {m}月{day}日
                    <span className={`ml-1 text-xs font-medium ${d.getDay() === 0 ? "text-red-500" : d.getDay() === 6 ? "text-blue-500" : "text-zinc-400"}`}>
                      （{dow}）
                    </span>
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLE[r.status] ?? ""}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  {canWithdraw && (
                    <span className="text-xs text-zinc-300 dark:text-zinc-600">取り下げ →</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* 取り下げ確認ボトムシート */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {(() => {
              const d = new Date(selected.request_date + "T00:00:00+09:00");
              const m = d.getMonth() + 1;
              const day = d.getDate();
              const dow = WEEKDAY_JP[d.getDay()];
              return (
                <>
                  <p className="text-xs text-zinc-400 mb-1">希望休の取り下げ</p>
                  <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">
                    {m}月{day}日（{dow}）
                  </p>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLE[selected.status] ?? ""}`}>
                    {STATUS_LABEL[selected.status] ?? selected.status}
                  </span>
                  {selected.note && (
                    <p className="mt-3 text-sm text-zinc-500 bg-zinc-50 dark:bg-zinc-950 rounded-xl px-3 py-2">
                      {selected.note}
                    </p>
                  )}
                  <div className="flex gap-2 mt-5">
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-400"
                    >キャンセル</button>
                    <button
                      type="button"
                      onClick={() => handleWithdraw(selected.id)}
                      disabled={isPending}
                      className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold"
                    >{isPending ? "処理中..." : "取り下げる"}</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
