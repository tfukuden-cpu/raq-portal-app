"use client";

import { useState, useTransition } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { submitHolidayAction, withdrawHolidayAction } from "./actions";

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

type AppliedRequest = {
  id: string;
  request_date: string;
  status: string;
  note: string | null;
};

type ModalState =
  | { type: "none" }
  | { type: "apply"; dates: string[] }
  | { type: "detail"; request: AppliedRequest };

function dateKey(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:  { label: "審査中", color: "text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20" },
  approved: { label: "承認",   color: "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20" },
  rejected: { label: "却下",   color: "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20" },
};

export default function HolidayCalendar({
  initialYear,
  initialMonth,
  appliedRequests,
  openDay = null,
  deadlineDay = null,
  maxDaysPerMonth = null,
  weekendLimit = null,
  hideNav = false,
}: {
  initialYear: number;
  initialMonth: number;
  appliedRequests: AppliedRequest[];
  openDay?: number | null;
  deadlineDay?: number | null;
  maxDaysPerMonth?: number | null;
  weekendLimit?: number | null;
  hideNav?: boolean;
}) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const today = new Date();
  const todayDay = today.getDate();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;

  const afterDeadline = deadlineDay !== null && todayDay > deadlineDay;
  const maxApplyYear  = afterDeadline ? (todayMonth === 12 ? todayYear + 1 : todayYear) : todayYear;
  const maxApplyMonth = afterDeadline ? (todayMonth === 12 ? 1 : todayMonth + 1) : todayMonth;
  const canGoNext = !(year === maxApplyYear && month >= maxApplyMonth);

  const beforeOpen = openDay !== null && todayDay < openDay;
  const appliedMap = new Map(appliedRequests.map((r) => [r.request_date, r]));

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const approvedThisMonth = appliedRequests.filter(
    r => r.request_date.startsWith(monthStr) && r.status === "approved"
  ).length;
  const remaining = maxDaysPerMonth !== null ? maxDaysPerMonth - approvedThisMonth : null;

  const approvedWeekendThisMonth = appliedRequests.filter(r => {
    if (!r.request_date.startsWith(monthStr) || r.status !== "approved") return false;
    const dow = new Date(r.request_date + "T00:00:00").getDay();
    return dow === 0 || dow === 6;
  }).length;
  const remainingWeekend = weekendLimit !== null ? weekendLimit - approvedWeekendThisMonth : null;

  const isCurrentMonth = year === todayYear && month === todayMonth;
  const pastDeadline = deadlineDay !== null && isCurrentMonth && todayDay > deadlineDay;
  const isFutureBlocked = year > maxApplyYear || (year === maxApplyYear && month > maxApplyMonth);
  const isPastMonth = year < todayYear || (year === todayYear && month < todayMonth);

  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const goMonth = (delta: number) => {
    setSelected([]);
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const toggleDate = (ds: string) => {
    if (appliedMap.has(ds)) {
      setModal({ type: "detail", request: appliedMap.get(ds)! });
      return;
    }
    if (beforeOpen || pastDeadline || isFutureBlocked || isPastMonth) return;
    if (remaining !== null && remaining <= 0 && !selected.includes(ds)) return;
    const dow = new Date(ds + "T00:00:00").getDay();
    const isWd = dow === 0 || dow === 6;
    if (isWd && remainingWeekend !== null && remainingWeekend <= 0 && !selected.includes(ds)) return;
    setSelected((prev) =>
      prev.includes(ds) ? prev.filter((d) => d !== ds) : [...prev, ds]
    );
  };

  const handleApply = () => {
    if (selected.length === 0) return;
    if (remaining !== null && selected.length > remaining) {
      setError(`この月の残り申請枠は${remaining}日です`);
      return;
    }
    if (remainingWeekend !== null) {
      const newWeekend = selected.filter(ds => {
        const dow = new Date(ds + "T00:00:00").getDay();
        return dow === 0 || dow === 6;
      }).length;
      if (newWeekend > remainingWeekend) {
        setError(`この月の土日残り申請枠は${remainingWeekend}日です`);
        return;
      }
    }
    setNote("");
    setError(null);
    setModal({ type: "apply", dates: [...selected].sort() });
  };

  const handleSubmit = () => {
    setError(null);
    const fd = new FormData();
    fd.set("dates", JSON.stringify(modal.type === "apply" ? modal.dates : []));
    fd.set("note", note);
    startTransition(async () => {
      const r = await submitHolidayAction(fd);
      if (!r.success) {
        setError(r.message ?? "申請失敗");
      } else {
        setSelected([]);
        setModal({ type: "none" });
      }
    });
  };

  const handleWithdraw = (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      await withdrawHolidayAction(fd);
      setModal({ type: "none" });
    });
  };

  // 優先度付きバナー（最高優先度1件のみ表示）
  type Banner = { msg: string; cls: string };
  let banner: Banner | null = null;
  if (beforeOpen && isCurrentMonth) {
    banner = {
      msg: `申請受付は毎月${openDay}日から開始します（現在${todayDay}日）`,
      cls: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20",
    };
  } else if (pastDeadline) {
    banner = {
      msg: `申請終了期日（${deadlineDay}日）を過ぎているため、今月分の新規申請・取り下げはできません`,
      cls: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20",
    };
  } else if (remaining !== null && remaining <= 0) {
    banner = {
      msg: `この月の申請上限（${maxDaysPerMonth}日）に達しています`,
      cls: "text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20",
    };
  } else if (remainingWeekend !== null && remainingWeekend <= 0) {
    banner = {
      msg: `この月の土日申請上限（${weekendLimit}日）に達しています`,
      cls: "text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20",
    };
  }

  // バナーがない場合の締切情報（控えめ表示）
  const deadlineInfo = !banner && !pastDeadline && !beforeOpen && deadlineDay !== null && isCurrentMonth
    ? `申請受付: 毎月${openDay !== null ? `${openDay}日〜` : ""}${deadlineDay}日`
    : null;

  return (
    <>
      <div className="space-y-3">

        {/* 月切替（hideNav=false の場合のみ） */}
        {!hideNav && (
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => goMonth(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors">
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <div className="text-center">
              <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{year}年 {month}月</p>
              {maxDaysPerMonth !== null && (
                <p className={`text-[11px] tabular-nums ${(remaining ?? 0) <= 0 ? "text-red-500 font-bold" : "text-zinc-400"}`}>
                  申請枠: 残{remaining ?? 0}/{maxDaysPerMonth}日
                </p>
              )}
              {weekendLimit !== null && (
                <p className={`text-[11px] tabular-nums ${(remainingWeekend ?? 0) <= 0 ? "text-amber-500 font-bold" : "text-zinc-400"}`}>
                  土日枠: 残{remainingWeekend ?? 0}/{weekendLimit}日
                </p>
              )}
            </div>
            <button type="button" onClick={() => canGoNext && goMonth(1)} disabled={!canGoNext}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors disabled:opacity-20">
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* hideNav 時の枠残表示（月ナビは親が担うため枠数だけ表示） */}
        {hideNav && (maxDaysPerMonth !== null || weekendLimit !== null) && (
          <div className="flex gap-3 justify-center text-[11px] tabular-nums">
            {maxDaysPerMonth !== null && (
              <span className={(remaining ?? 0) <= 0 ? "text-red-500 font-bold" : "text-zinc-400"}>
                申請枠: 残{remaining ?? 0}/{maxDaysPerMonth}日
              </span>
            )}
            {weekendLimit !== null && (
              <span className={(remainingWeekend ?? 0) <= 0 ? "text-amber-500 font-bold" : "text-zinc-400"}>
                土日枠: 残{remainingWeekend ?? 0}/{weekendLimit}日
              </span>
            )}
          </div>
        )}

        {/* バナー（優先度最高1件） */}
        {banner && (
          <div className={`text-xs rounded-xl px-3 py-2.5 ${banner.cls}`}>
            {banner.msg}
          </div>
        )}
        {deadlineInfo && (
          <div className="text-xs text-zinc-400 px-1">{deadlineInfo}</div>
        )}

        {/* カレンダー曜日行 */}
        <div className="grid grid-cols-7 gap-1 text-center mb-1">
          {WEEKDAY_JP.map((w, i) => (
            <div key={w} className={`text-xs font-bold pb-1 ${
              i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-zinc-500"
            }`}>{w}</div>
          ))}
        </div>

        {/* カレンダー本体 */}
        <div className="grid grid-cols-7 gap-1 text-center">
          {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
            const ds = dateKey(year, month, d);
            const applied = appliedMap.get(ds);
            const isSelected = selected.includes(ds);
            const dow = new Date(year, month - 1, d).getDay();
            const atLimit = remaining !== null && remaining <= 0 && !isSelected;
            const isWd = dow === 0 || dow === 6;
            const atWeekendLimit = isWd && remainingWeekend !== null && remainingWeekend <= 0 && !isSelected;

            let cellClass = "rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer select-none ";
            if (applied) {
              cellClass +=
                applied.status === "approved"
                  ? "bg-green-500 text-white"
                  : applied.status === "rejected"
                  ? "bg-red-200 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                  : "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900";
            } else if (isSelected) {
              cellClass += "bg-blue-600 text-white";
            } else if (beforeOpen || pastDeadline || atLimit || atWeekendLimit) {
              cellClass += "text-zinc-300 dark:text-zinc-600 cursor-default";
            } else {
              cellClass +=
                dow === 0 ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                : dow === 6 ? "text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                : "text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800";
            }

            return (
              <div key={ds} className={cellClass} onClick={() => toggleDate(ds)}>
                {d}
                {/* 状態ドット（9px文字ラベルの代替） */}
                {applied && (
                  <div className={`w-1.5 h-1.5 rounded-full mx-auto mt-0.5 ${
                    applied.status === "approved" ? "bg-white/60"
                    : applied.status === "rejected" ? "bg-red-500 dark:bg-red-400"
                    : "bg-yellow-300 dark:bg-yellow-400"
                  }`} />
                )}
              </div>
            );
          })}
        </div>

        {/* 凡例 */}
        <div className="flex flex-wrap gap-3 mt-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-600 inline-block" />選択中</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-zinc-800 dark:bg-zinc-200 inline-block" />申請中</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" />承認済</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block" />却下</span>
        </div>

        {/* 申請ボタン */}
        {selected.length > 0 && (
          <button type="button" onClick={handleApply}
            className="w-full py-3 rounded-2xl bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-sm font-bold transition-colors">
            希望休を申請する（{selected.length}日選択中）
          </button>
        )}
        {error && <p className="text-xs text-red-500 text-center">{error}</p>}
      </div>

      {/* 申請確認モーダル */}
      {modal.type === "apply" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-20 flex items-end sm:items-center justify-center p-4"
          onClick={() => setModal({ type: "none" })}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-3 text-zinc-900 dark:text-zinc-50">希望休を申請する</h2>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {modal.dates.map((ds) => {
                const d = new Date(ds + "T00:00:00+09:00");
                return (
                  <span key={ds} className="text-xs px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 font-medium">
                    {d.getMonth() + 1}/{d.getDate()}（{WEEKDAY_JP[d.getDay()]}）
                  </span>
                );
              })}
            </div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">備考（任意）</label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="特記事項があれば入力..." rows={3}
              className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            {error && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setModal({ type: "none" })}
                className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-400">
                キャンセル
              </button>
              <button type="button" onClick={handleSubmit} disabled={isPending}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold">
                {isPending ? "申請中..." : "申請する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 申請詳細・取り下げモーダル */}
      {modal.type === "detail" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-20 flex items-end sm:items-center justify-center p-4"
          onClick={() => setModal({ type: "none" })}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            {(() => {
              const r = modal.request;
              const d = new Date(r.request_date + "T00:00:00+09:00");
              const reqYear  = d.getFullYear();
              const reqMonth = d.getMonth() + 1;
              const reqDay   = d.getDate();
              const st = STATUS_LABEL[r.status] ?? { label: r.status, color: "" };
              const isReqCurrentMonth = reqYear === todayYear && reqMonth === todayMonth;
              const reqPastDeadline = deadlineDay !== null && isReqCurrentMonth && todayDay > deadlineDay;
              const canWithdraw = (r.status === "pending" || r.status === "approved") && !reqPastDeadline;
              return (
                <>
                  <div className="text-xs font-medium text-zinc-500 mb-1">申請済みの希望休</div>
                  <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
                    {reqMonth}月{reqDay}日（{WEEKDAY_JP[d.getDay()]}）
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${st.color}`}>{st.label}</span>
                  {r.note && (
                    <div className="mt-3 bg-zinc-50 dark:bg-zinc-950 rounded-md p-3 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                      {r.note}
                    </div>
                  )}
                  {!canWithdraw && r.status === "pending" && (
                    <p className="mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-3 py-2">
                      締切済みのため取り下げ不可
                    </p>
                  )}
                  <div className="flex gap-2 mt-4">
                    {canWithdraw && (
                      <button type="button" onClick={() => handleWithdraw(r.id)} disabled={isPending}
                        className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold">
                        {isPending ? "処理中..." : "取り下げる"}
                      </button>
                    )}
                    <button type="button" onClick={() => setModal({ type: "none" })}
                      className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-400">
                      閉じる
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}
