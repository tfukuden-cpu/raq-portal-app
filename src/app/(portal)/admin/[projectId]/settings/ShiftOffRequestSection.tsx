"use client";

import { useState, useTransition, useEffect } from "react";
import {
  fetchOffRequestsAction,
  type OffRequestRow,
} from "./off-request-actions";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

const PRIORITY_SHORT: Record<string, string> = {
  "第一希望休": "希休1",
  "第二希望休": "希休2",
  "第三希望休": "希休3",
  "第四希望休": "希休4",
  "冠婚葬祭":   "冠婚",
};

const PRIORITY_COLOR: Record<string, string> = {
  "第一希望休": "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  "第二希望休": "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300",
  "第三希望休": "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
  "第四希望休": "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
  "冠婚葬祭":   "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
};

function fmtDay(d: string) {
  return `${parseInt(d.slice(8, 10))}日`;
}

type GroupedEntry = {
  staffId:       string;
  staffName:     string;
  accountNumber: string | null;
  dates: { date: string; priority: string }[];
};

export default function ShiftOffRequestSection({
  projectId,
  onRulesClick,
  rulesOpen = false,
}: {
  projectId: string;
  onRulesClick?: () => void;
  rulesOpen?: boolean;
}) {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [rows,   setRows]  = useState<OffRequestRow[] | null>(null);
  const [error,  setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isFetching, startFetch] = useTransition();

  // マウント時・月変更時に自動取得
  useEffect(() => {
    setError(null);
    setRows(null);
    setSearch("");
    startFetch(async () => {
      const r = await fetchOffRequestsAction(projectId, year, month);
      if (r.success) setRows(r.rows ?? []);
      else setError(r.message ?? "取得失敗");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, year, month]);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  // スタッフ別グループ化 → アカウント番号順 → 名前順
  const grouped: GroupedEntry[] = (() => {
    if (!rows) return [];
    const map = new Map<string, GroupedEntry>();
    for (const r of rows) {
      if (!map.has(r.staff_id)) {
        map.set(r.staff_id, {
          staffId:       r.staff_id,
          staffName:     r.staff_name,
          accountNumber: r.account_number,
          dates:         [],
        });
      }
      map.get(r.staff_id)!.dates.push({ date: r.request_date, priority: r.priority });
    }
    const q = search.trim().toLowerCase();
    return [...map.values()]
      .filter(g =>
        !q ||
        g.staffName.toLowerCase().includes(q) ||
        (g.accountNumber ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (a.accountNumber && b.accountNumber)
          return a.accountNumber.localeCompare(b.accountNumber, "ja");
        if (a.accountNumber && !b.accountNumber) return -1;
        if (!a.accountNumber && b.accountNumber) return 1;
        return a.staffName.localeCompare(b.staffName, "ja");
      });
  })();

  return (
    <div className="space-y-3">

      {/* ── ヘッダー：月ナビ + タイトル + 件数 ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevMonth}
            disabled={isFetching}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            <ChevronLeftIcon className="w-4 h-4 text-zinc-500" />
          </button>
          <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100 w-[5.5rem] text-center select-none">
            {year}年{month}月
          </span>
          <button
            type="button"
            onClick={nextMonth}
            disabled={isFetching}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            <ChevronRightIcon className="w-4 h-4 text-zinc-500" />
          </button>
        </div>
        {onRulesClick && (
          <button
            type="button"
            onClick={onRulesClick}
            className={[
              "flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors shrink-0",
              rulesOpen
                ? "bg-zinc-700 text-white border-zinc-700"
                : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800",
            ].join(" ")}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            希望休設定
          </button>
        )}
      </div>

      {/* ── 氏名検索 ── */}
      <input
        type="search"
        placeholder="氏名・アカウント番号で検索…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-400/50"
      />

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* ── テーブル ── */}
      {isFetching && rows === null ? (
        <p className="text-xs text-zinc-400 py-8 text-center animate-pulse">読み込み中…</p>
      ) : rows !== null && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">

          {/* ヘッダー行 */}
          <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700">
            <span className="w-16 shrink-0 text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
              アカウント#
            </span>
            <span className="w-24 shrink-0 text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
              氏名
            </span>
            <span className="flex-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
              希望休内容
            </span>
          </div>

          {grouped.length === 0 ? (
            <p className="text-xs text-zinc-400 py-8 text-center">
              {search.trim() ? "一致するスタッフがいません" : `${year}年${month}月の希望休申請はありません`}
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {grouped.map(g => (
                <div key={g.staffId} className="flex items-start gap-2 px-3 py-2.5">
                  {/* アカウント番号 */}
                  <span className="w-16 shrink-0 text-xs font-mono text-zinc-400 tabular-nums pt-0.5 truncate" title={g.accountNumber ?? ""}>
                    {g.accountNumber ?? "—"}
                  </span>
                  {/* 氏名 */}
                  <span className="w-24 shrink-0 text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate" title={g.staffName}>
                    {g.staffName}
                  </span>
                  {/* 希望休内容 */}
                  <div className="flex-1 flex flex-wrap gap-1 min-w-0">
                    {g.dates
                      .slice()
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((d, i) => (
                        <span
                          key={i}
                          className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${PRIORITY_COLOR[d.priority] ?? "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"}`}
                        >
                          {fmtDay(d.date)}
                          <span className="opacity-70">{PRIORITY_SHORT[d.priority] ?? d.priority}</span>
                        </span>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
