"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { applyShiftOpeningAction, cancelShiftRequestAction } from "./actions";

// ── 型 ──────────────────────────────────────────────────
type Opening = {
  id: string;
  opening_date: string;
  shift_name: string;
  shift_start: string;
  shift_end: string;
  capacity: number;
  note: string | null;
};

type ShiftRequest = {
  id: string;
  request_date: string;
  opening_id: string | null;
  status: string;
};

type Props = {
  openings: Opening[];
  existingRequests: ShiftRequest[];
  todayStr: string;
  initialYear: number;
  initialMonth: number;
};

// ── 定数 ────────────────────────────────────────────────
const WEEKDAY_SHORT = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAY_FULL  = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

const STATUS_CFG = {
  pending:  { label: "審査中", badge: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" },
  approved: { label: "承認済", badge: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300" },
  rejected: { label: "却下",   badge: "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400" },
} as const;

function fmt5(t: string) { return t.slice(0, 5); }

// ── コンポーネント ───────────────────────────────────────
export default function RequestClient({
  openings, existingRequests, todayStr, initialYear, initialMonth,
}: Props) {
  const router = useRouter();
  const [year, setYear]       = useState(initialYear);
  const [month, setMonth]     = useState(initialMonth);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch]   = useState("");
  const [isPending, startTrans] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;

  const goMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelected(null);
    setFeedback(null);
  };

  // 募集マップ (date → Opening[])
  const openingMap = new Map<string, Opening[]>();
  for (const o of openings) {
    if (!openingMap.has(o.opening_date)) openingMap.set(o.opening_date, []);
    openingMap.get(o.opening_date)!.push(o);
  }

  // 申請マップ (date → ShiftRequest)
  const requestMap = new Map<string, ShiftRequest>();
  for (const r of existingRequests) requestMap.set(r.request_date, r);

  // 利用可能なシフトパターン一覧（重複排除・ソート）
  const shiftNames = [...new Set(openings.map((o) => o.shift_name))].sort();

  // 選択パターンでフィルター後の募集マップ
  const filteredMap = new Map<string, Opening[]>();
  for (const [date, ops] of openingMap) {
    const filtered = search ? ops.filter((o) => o.shift_name === search) : ops;
    if (filtered.length > 0) filteredMap.set(date, filtered);
  }

  // カレンダー計算
  const firstDow    = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const trailing    = 42 - firstDow - daysInMonth;

  // 選択日情報
  const selRequest  = selected ? requestMap.get(selected) ?? null : null;
  const selOpenings = selected ? (filteredMap.get(selected) ?? []) : [];
  const [selMM, selDD] = selected?.split("-").slice(1) ?? [];
  const selDow = selected ? new Date(selected + "T00:00:00+09:00").getDay() : null;
  const selLabel = selected
    ? `${Number(selMM)}月${Number(selDD)}日（${WEEKDAY_FULL[selDow!]}）`
    : null;

  const handleApply = (opening: Opening) => {
    if (!selected) return;
    setFeedback(null);
    startTrans(async () => {
      const result = await applyShiftOpeningAction(opening.id, selected);
      setFeedback({ ok: result.success, msg: result.message ?? "" });
      if (result.success) { setSelected(null); router.refresh(); }
    });
  };

  const handleCancel = (requestId: string) => {
    setFeedback(null);
    startTrans(async () => {
      const result = await cancelShiftRequestAction(requestId);
      setFeedback({ ok: result.success, msg: result.message ?? "" });
      if (result.success) router.refresh();
    });
  };

  return (
    <div className="space-y-3 pb-2">

      {/* シフトパターン選択フィルター */}
      {shiftNames.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-zinc-400">シフトパターンで絞り込み</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => { setSearch(""); setSelected(null); }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                !search
                  ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 border-transparent"
                  : "bg-white dark:bg-zinc-900 text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400"
              }`}
            >
              すべて
            </button>
            {shiftNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => { setSearch(search === name ? "" : name); setSelected(null); }}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  search === name
                    ? "bg-teal-600 text-white border-transparent"
                    : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-teal-400 hover:text-teal-600"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 凡例 */}
      <div className="flex items-center gap-3 text-[10px] text-zinc-500 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-teal-200 dark:bg-teal-700 inline-block" />募集あり</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-200 dark:bg-amber-700 inline-block" />審査中</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-200 dark:bg-blue-700 inline-block" />承認済</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/40 inline-block" />却下</span>
      </div>

      {/* 月ナビ */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => goMonth(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
          <ChevronLeftIcon className="w-4 h-4 text-zinc-500" />
        </button>
        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{year}年 {month}月</p>
        <button type="button" onClick={() => goMonth(1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
          <ChevronRightIcon className="w-4 h-4 text-zinc-500" />
        </button>
      </div>

      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7">
        {WEEKDAY_SHORT.map((w, i) => (
          <div key={w} className={`text-center text-[11px] font-semibold py-0.5 ${
            i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-400"
          }`}>{w}</div>
        ))}
      </div>

      {/* カレンダーグリッド（常に42マス） */}
      <div className="grid grid-cols-7 gap-0.5" style={{ gridAutoRows: "2.6rem" }}>
        {Array.from({ length: firstDow }).map((_, i) => <div key={`pre${i}`} />)}

        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
          const ds       = `${monthStr}-${String(d).padStart(2, "0")}`;
          const dow      = new Date(year, month - 1, d).getDay();
          const req      = requestMap.get(ds);
          const hasOpen  = filteredMap.has(ds);
          const isPast   = ds < todayStr;
          const isToday  = ds === todayStr;
          const isSel    = ds === selected;

          // セル背景
          let cellBg: string;
          if (isSel) {
            cellBg = req
              ? req.status === "approved" ? "bg-blue-500 dark:bg-blue-600"
              : req.status === "rejected" ? "bg-red-400 dark:bg-red-600"
              : "bg-amber-400 dark:bg-amber-500"
              : hasOpen ? "bg-teal-500 dark:bg-teal-600"
              : "bg-zinc-300 dark:bg-zinc-600";
          } else if (req) {
            cellBg = req.status === "approved"
              ? "bg-blue-100 dark:bg-blue-900/40 hover:bg-blue-200 dark:hover:bg-blue-900/60"
              : req.status === "rejected"
              ? "bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30"
              : "bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/60";
          } else if (hasOpen && !isPast) {
            cellBg = "bg-teal-100 dark:bg-teal-900/40 hover:bg-teal-200 dark:hover:bg-teal-900/60";
          } else {
            cellBg = "hover:bg-zinc-50 dark:hover:bg-zinc-800/60";
          }

          const numCls = isSel
            ? "text-white font-bold"
            : isToday
            ? "bg-blue-600 text-white rounded-full"
            : dow === 0 ? "text-red-500 dark:text-red-400"
            : dow === 6 ? "text-blue-500 dark:text-blue-400"
            : isPast    ? "text-zinc-300 dark:text-zinc-600"
            : hasOpen   ? "text-teal-700 dark:text-teal-200 font-semibold"
            : "text-zinc-700 dark:text-zinc-300";

          return (
            <button
              key={ds}
              type="button"
              onClick={() => setSelected(isSel ? null : ds)}
              className={[
                "flex flex-col items-center justify-center rounded-xl transition-colors",
                cellBg,
                isToday && !isSel ? "ring-2 ring-blue-400 dark:ring-blue-500 ring-inset" : "",
              ].filter(Boolean).join(" ")}
            >
              <span className={`text-sm w-7 h-6 flex items-center justify-center ${numCls}`}>{d}</span>
              {/* ドット：募集あり or 申請あり */}
              {!isSel && (req || (hasOpen && !isPast)) && (
                <span className={`w-1 h-1 rounded-full mt-0.5 ${
                  req
                    ? req.status === "approved" ? "bg-blue-500" : req.status === "rejected" ? "bg-red-400" : "bg-amber-500"
                    : "bg-teal-500"
                }`} />
              )}
            </button>
          );
        })}

        {Array.from({ length: trailing }).map((_, i) => <div key={`post${i}`} />)}
      </div>

      {/* フィードバック */}
      {feedback && (
        <div className={`rounded-xl px-4 py-2.5 text-sm font-medium text-center ${
          feedback.ok
            ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-800"
            : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-100 dark:border-red-800"
        }`}>
          {feedback.msg}
        </div>
      )}

      {/* 選択日の詳細パネル */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3 min-h-[90px]">
        {!selected && (
          <p className="text-xs text-zinc-400 text-center mt-4">日付を選択してください</p>
        )}

        {selected && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{selLabel}</p>

            {/* 申請済みの場合 */}
            {selRequest && (
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                  STATUS_CFG[selRequest.status as keyof typeof STATUS_CFG]?.badge ?? ""
                }`}>
                  {STATUS_CFG[selRequest.status as keyof typeof STATUS_CFG]?.label ?? selRequest.status}
                </span>
                {selRequest.status === "pending" && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleCancel(selRequest.id)}
                    className="text-xs text-zinc-400 hover:text-red-500 disabled:opacity-40 transition-colors"
                  >
                    {isPending ? "処理中…" : "申請取消"}
                  </button>
                )}
              </div>
            )}

            {/* 募集一覧（未申請） */}
            {!selRequest && selOpenings.length > 0 && (
              <div className="space-y-2">
                {selOpenings.map((o) => (
                  <div key={o.id}
                    className="flex items-center justify-between bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 gap-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 mr-2">
                        {o.shift_name}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {fmt5(o.shift_start)}〜{fmt5(o.shift_end)}
                      </span>
                      {o.note && (
                        <p className="text-[10px] text-zinc-400 mt-0.5 truncate">{o.note}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-zinc-400">空き{o.capacity}枠</span>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleApply(o)}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white transition-colors"
                      >
                        {isPending ? "申請中…" : "申請する"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 募集なし */}
            {!selRequest && selOpenings.length === 0 && (
              <p className="text-xs text-zinc-400">
                {search ? `「${search}」の募集はこの日にありません` : "この日の募集はありません"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
