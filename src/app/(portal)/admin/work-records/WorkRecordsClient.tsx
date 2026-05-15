"use client";

import { useState, useMemo } from "react";

export type StaffEntry = {
  staffId: string;
  name: string;
  accountNumber: string | null;
  company: string | null;
  section: string | null;
};

type FilterTab = "company" | "individual";

export default function WorkRecordsClient({
  projectId,
  staffs,
}: {
  projectId: string;
  staffs: StaffEntry[];
}) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const thisMonthStart = today.slice(0, 7) + "-01";

  const [startDate, setStartDate]   = useState(thisMonthStart);
  const [endDate,   setEndDate]     = useState(today);
  const [tab, setTab]               = useState<FilterTab>("company");
  const [filterValue, setFilterValue] = useState<string>("");
  const [search, setSearch]         = useState("");
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  const companies = useMemo(() =>
    [...new Set(staffs.map(s => s.company ?? "未設定"))].sort(),
    [staffs]
  );
  const filtered = useMemo(() => {
    let list = staffs;
    if (tab === "company" && filterValue) {
      list = list.filter(s => (s.company ?? "未設定") === filterValue);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.staffId.toLowerCase().includes(q) ||
        (s.accountNumber ?? "").includes(q)
      );
    }
    return list;
  }, [staffs, tab, filterValue, search]);

  function toggleAll() {
    if (filtered.every(s => selected.has(s.staffId))) {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(s => next.delete(s.staffId));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(s => next.add(s.staffId));
        return next;
      });
    }
  }

  function toggleOne(staffId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(staffId)) next.delete(staffId); else next.add(staffId);
      return next;
    });
  }

  async function handleDownload() {
    const ids = selected.size > 0 ? [...selected] : staffs.map(s => s.staffId);
    const params = new URLSearchParams({
      projectId,
      startDate,
      endDate,
      staffIds: ids.join(","),
      mode: tab,
    });
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

  const allFilteredSelected = filtered.length > 0 && filtered.every(s => selected.has(s.staffId));
  const exportCount = selected.size > 0 ? selected.size : staffs.length;

  return (
    <div className="space-y-5">
      {/* 期間選択 */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">期間</p>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-zinc-400 text-sm">〜</span>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {/* クイック選択 */}
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "今月", start: today.slice(0, 7) + "-01", end: today },
            { label: "先月", ...lastMonth() },
            { label: "先週", ...lastWeek() },
          ].map(({ label, start, end }) => (
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

      {/* フィルタータブ */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
        <div className="flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
          {([["company","会社別"], ["individual","個人別"]] as [FilterTab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => { setTab(t); setFilterValue(""); }}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === t
                  ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "company" && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterValue("")}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filterValue === ""
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              すべて
            </button>
            {companies.map(c => (
              <button
                key={c}
                onClick={() => setFilterValue(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  filterValue === c
                    ? "bg-blue-600 text-white border-blue-600"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* 検索 */}
        <input
          type="search"
          placeholder="氏名・社員ID・アカウント番号で検索"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* スタッフ一覧 */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleAll}
              className="w-4 h-4 rounded accent-blue-600"
            />
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {filtered.length}名を表示
            </span>
          </label>
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              選択解除
            </button>
          )}
        </div>

        {/* リスト */}
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">該当するスタッフがいません</p>
          ) : filtered.map(s => (
            <label
              key={s.staffId}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${
                selected.has(s.staffId) ? "bg-blue-50 dark:bg-blue-900/10" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(s.staffId)}
                onChange={() => toggleOne(s.staffId)}
                className="w-4 h-4 rounded accent-blue-600 flex-shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {s.accountNumber && (
                    <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500 font-mono flex-shrink-0">
                      {s.accountNumber}
                    </span>
                  )}
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {s.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {s.company && (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">{s.company}</span>
                  )}
                  {s.company && s.section && (
                    <span className="text-zinc-300 dark:text-zinc-600 text-xs">·</span>
                  )}
                  {s.section && (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">{s.section}</span>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* ダウンロードボタン */}
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white font-semibold transition-colors flex items-center justify-center gap-2"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
        </svg>
        {downloading ? "生成中…" : `CSV出力 (${exportCount}名 / ${startDate}〜${endDate})`}
      </button>
    </div>
  );
}

function lastMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed
  const firstOfLastMonth = new Date(y, m - 1, 1);
  const lastOfLastMonth  = new Date(y, m, 0);
  return {
    start: firstOfLastMonth.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    end:   lastOfLastMonth.toLocaleDateString("sv-SE",  { timeZone: "Asia/Tokyo" }),
  };
}

function lastWeek() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diffToMon = (day === 0 ? 7 : day) + 6;
  const lastMon = new Date(now); lastMon.setDate(now.getDate() - diffToMon);
  const lastSun = new Date(lastMon); lastSun.setDate(lastMon.getDate() + 6);
  return {
    start: lastMon.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    end:   lastSun.toLocaleDateString("sv-SE",  { timeZone: "Asia/Tokyo" }),
  };
}
