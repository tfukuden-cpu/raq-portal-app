"use client";

import { useState, useMemo } from "react";
import type { StaffEntry } from "@/app/(portal)/admin/work-records/WorkRecordsClient";

type FilterTab = "company" | "individual";

function lastMonth() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  return {
    start: new Date(y, m - 1, 1).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    end:   new Date(y, m,     0).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
  };
}
function lastWeek() {
  const now  = new Date();
  const diff = (now.getDay() === 0 ? 7 : now.getDay()) + 6;
  const mon  = new Date(now); mon.setDate(now.getDate() - diff);
  const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
  return {
    start: mon.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    end:   sun.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
  };
}

export default function ExportModal({
  projectId,
  staffs,
  onClose,
}: {
  projectId: string;
  staffs: StaffEntry[];
  onClose: () => void;
}) {
  const today          = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const thisMonthStart = today.slice(0, 7) + "-01";

  const [startDate,   setStartDate]   = useState(thisMonthStart);
  const [endDate,     setEndDate]     = useState(today);
  const [filterTab,   setFilterTab]   = useState<FilterTab>("company");
  const [filterValue, setFilterValue] = useState("");
  const [search,      setSearch]      = useState("");
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  const companies = useMemo(
    () => [...new Set(staffs.map(s => s.company ?? "未設定"))].sort(),
    [staffs],
  );

  const filtered = useMemo(() => {
    let list = staffs;
    if (filterTab === "company" && filterValue)
      list = list.filter(s => (s.company ?? "未設定") === filterValue);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.staffId.toLowerCase().includes(q) ||
        (s.accountNumber ?? "").includes(q),
      );
    }
    return list;
  }, [staffs, filterTab, filterValue, search]);

  function toggleAll() {
    if (filtered.every(s => selected.has(s.staffId))) {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(s => n.delete(s.staffId)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(s => n.add(s.staffId)); return n; });
    }
  }

  async function handleDownload() {
    const ids = selected.size > 0 ? [...selected] : staffs.map(s => s.staffId);
    const params = new URLSearchParams({ projectId, startDate, endDate, staffIds: ids.join(","), mode: filterTab });
    setDownloading(true);
    try {
      const res = await fetch(`/api/admin/work-records/export?${params}`);
      if (!res.ok) { alert("エクスポートに失敗しました"); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `稼働実績_${startDate}_${endDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const exportCount        = selected.size > 0 ? selected.size : staffs.length;
  const allFilteredSelected = filtered.length > 0 && filtered.every(s => selected.has(s.staffId));

  const PERIOD_BTNS = [
    { label: "今月", start: today.slice(0, 7) + "-01", end: today },
    { label: "先月", ...lastMonth() },
    { label: "先週", ...lastWeek() },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0">
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">実績出力</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-5 h-5 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* スクロール可能な本体 */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* 期間 */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">出力期間</p>
            <div className="flex items-center gap-2">
              <input
                type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-zinc-400 text-sm">〜</span>
              <input
                type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2">
              {PERIOD_BTNS.map(({ label, start, end }) => (
                <button
                  key={label}
                  onClick={() => { setStartDate(start); setEndDate(end); }}
                  className="px-3 py-1 rounded-full text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 出力単位 */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">出力単位</p>
            <div className="flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
              {([["company", "会社別"], ["individual", "個人別"]] as [FilterTab, string][]).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => { setFilterTab(t); setFilterValue(""); }}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    filterTab === t
                      ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 shadow-sm"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {filterTab === "company" && (
              <div className="flex flex-wrap gap-2">
                {["", ...companies].map(c => (
                  <button
                    key={c || "__all"}
                    onClick={() => setFilterValue(c)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      filterValue === c
                        ? "bg-blue-600 text-white border-blue-600"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {c || "すべて"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 対象スタッフ */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">対象スタッフ</p>
            <input
              type="search" placeholder="氏名・社員ID・アカウント番号で検索" value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox" checked={allFilteredSelected} onChange={toggleAll}
                    className="w-4 h-4 rounded accent-blue-600"
                  />
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">{filtered.length}名を表示</span>
                </label>
                {selected.size > 0 && (
                  <button
                    onClick={() => setSelected(new Set())}
                    className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  >
                    {selected.size}名選択中 ✕
                  </button>
                )}
              </div>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-52 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="py-6 text-center text-sm text-zinc-400">該当するスタッフがいません</p>
                ) : filtered.map(s => (
                  <label
                    key={s.staffId}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${
                      selected.has(s.staffId) ? "bg-blue-50 dark:bg-blue-900/10" : ""
                    }`}
                  >
                    <input
                      type="checkbox" checked={selected.has(s.staffId)}
                      onChange={() => setSelected(prev => {
                        const n = new Set(prev);
                        n.has(s.staffId) ? n.delete(s.staffId) : n.add(s.staffId);
                        return n;
                      })}
                      className="w-4 h-4 rounded accent-blue-600 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {s.accountNumber && (
                          <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500 font-mono flex-shrink-0">
                            {s.accountNumber}
                          </span>
                        )}
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{s.name}</span>
                      </div>
                      {(s.company || s.section) && (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
                          {[s.company, s.section].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* フッター */}
        <div className="px-5 pb-5 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex-shrink-0 space-y-2">
          <p className="text-xs text-zinc-400 text-center tabular-nums">
            {exportCount}名 · {startDate} 〜 {endDate}
          </p>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            {downloading ? "生成中…" : "エクスポート"}
          </button>
        </div>
      </div>
    </div>
  );
}
