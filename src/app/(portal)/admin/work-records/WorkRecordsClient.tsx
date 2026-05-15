"use client";

import { useState, useMemo, useEffect } from "react";
import type { ComplianceRow } from "@/app/api/admin/work-records/compliance/route";

export type StaffEntry = {
  staffId: string;
  name: string;
  accountNumber: string | null;
  company: string | null;
  section: string | null;
};

type PageTab    = "export" | "compliance";
type FilterTab  = "company" | "individual";
type SortKey    = "rate" | "name" | "late" | "early" | "absent";

export default function WorkRecordsClient({
  projectId,
  staffs,
}: {
  projectId: string;
  staffs: StaffEntry[];
}) {
  const today         = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const thisMonthStart = today.slice(0, 7) + "-01";

  const [pageTab,      setPageTab]      = useState<PageTab>("export");
  const [startDate,    setStartDate]    = useState(thisMonthStart);
  const [endDate,      setEndDate]      = useState(today);

  // ── エクスポートタブ ──────────────────────────────────────────
  const [filterTab,    setFilterTab]    = useState<FilterTab>("company");
  const [filterValue,  setFilterValue]  = useState("");
  const [search,       setSearch]       = useState("");
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [downloading,  setDownloading]  = useState(false);

  // ── 順守率タブ ────────────────────────────────────────────────
  const [complianceRows, setComplianceRows] = useState<ComplianceRow[] | null>(null);
  const [compLoading,    setCompLoading]    = useState(false);
  const [compSearch,     setCompSearch]     = useState("");
  const [sortKey,        setSortKey]        = useState<SortKey>("rate");

  const companies = useMemo(() =>
    [...new Set(staffs.map(s => s.company ?? "未設定"))].sort(), [staffs]);

  const filtered = useMemo(() => {
    let list = staffs;
    if (filterTab === "company" && filterValue)
      list = list.filter(s => (s.company ?? "未設定") === filterValue);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.staffId.toLowerCase().includes(q) ||
        (s.accountNumber ?? "").includes(q)
      );
    }
    return list;
  }, [staffs, filterTab, filterValue, search]);

  async function fetchCompliance() {
    setCompLoading(true);
    setComplianceRows(null);
    try {
      const params = new URLSearchParams({ projectId, startDate, endDate });
      const res = await fetch(`/api/admin/work-records/compliance?${params}`);
      if (res.ok) setComplianceRows(await res.json());
    } finally {
      setCompLoading(false);
    }
  }

  useEffect(() => {
    if (pageTab === "compliance") fetchCompliance();
  }, [pageTab, startDate, endDate]);

  const sortedCompliance = useMemo(() => {
    if (!complianceRows) return [];
    let list = complianceRows;
    if (compSearch) {
      const q = compSearch.toLowerCase();
      list = list.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.staffId.toLowerCase().includes(q) ||
        (r.accountNumber ?? "").includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sortKey === "rate")   return (b.complianceRate ?? -1) - (a.complianceRate ?? -1);
      if (sortKey === "name")   return a.name.localeCompare(b.name, "ja");
      if (sortKey === "late")   return b.lateDays   - a.lateDays;
      if (sortKey === "early")  return b.earlyDays  - a.earlyDays;
      if (sortKey === "absent") return b.absentDays - a.absentDays;
      return 0;
    });
  }, [complianceRows, compSearch, sortKey]);

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

  const exportCount = selected.size > 0 ? selected.size : staffs.length;
  const allFilteredSelected = filtered.length > 0 && filtered.every(s => selected.has(s.staffId));

  // 順守率の色
  function rateColor(rate: number | null) {
    if (rate === null) return "text-zinc-400";
    if (rate >= 95) return "text-emerald-600 dark:text-emerald-400";
    if (rate >= 80) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  }
  function rateBarColor(rate: number | null) {
    if (rate === null) return "bg-zinc-300 dark:bg-zinc-600";
    if (rate >= 95) return "bg-emerald-500";
    if (rate >= 80) return "bg-yellow-500";
    return "bg-red-500";
  }

  const PERIOD_BTNS = [
    { label: "今月", start: today.slice(0, 7) + "-01", end: today },
    { label: "先月", ...lastMonth() },
    { label: "先週", ...lastWeek() },
  ];

  return (
    <div className="space-y-4">
      {/* 期間選択（共通） */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-zinc-400 text-sm">〜</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {PERIOD_BTNS.map(({ label, start, end }) => (
            <button key={label} onClick={() => { setStartDate(start); setEndDate(end); }}
              className="px-3 py-1 rounded-full text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ページタブ */}
      <div className="flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-2xl">
        {([["export","エクスポート"], ["compliance","順守率"]] as [PageTab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setPageTab(t)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
              pageTab === t
                ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 shadow-sm"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── エクスポートタブ ── */}
      {pageTab === "export" && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
            <div className="flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
              {([["company","会社別"], ["individual","個人別"]] as [FilterTab, string][]).map(([t, label]) => (
                <button key={t} onClick={() => { setFilterTab(t); setFilterValue(""); }}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    filterTab === t
                      ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 shadow-sm"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            {filterTab === "company" && (
              <div className="flex flex-wrap gap-2">
                {["", ...companies].map(c => (
                  <button key={c || "__all"} onClick={() => setFilterValue(c)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      filterValue === c
                        ? "bg-blue-600 text-white border-blue-600"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    }`}>
                    {c || "すべて"}
                  </button>
                ))}
              </div>
            )}
            <input type="search" placeholder="氏名・社員ID・アカウント番号で検索" value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll}
                  className="w-4 h-4 rounded accent-blue-600" />
                <span className="text-sm text-zinc-600 dark:text-zinc-400">{filtered.length}名を表示</span>
              </label>
              {selected.size > 0 && (
                <button onClick={() => setSelected(new Set())}
                  className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">選択解除</button>
              )}
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-400">該当するスタッフがいません</p>
              ) : filtered.map(s => (
                <label key={s.staffId}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${selected.has(s.staffId) ? "bg-blue-50 dark:bg-blue-900/10" : ""}`}>
                  <input type="checkbox" checked={selected.has(s.staffId)}
                    onChange={() => setSelected(prev => { const n = new Set(prev); n.has(s.staffId) ? n.delete(s.staffId) : n.add(s.staffId); return n; })}
                    className="w-4 h-4 rounded accent-blue-600 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {s.accountNumber && <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500 font-mono flex-shrink-0">{s.accountNumber}</span>}
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {s.company  && <span className="text-xs text-zinc-400 dark:text-zinc-500">{s.company}</span>}
                      {s.company && s.section && <span className="text-zinc-300 dark:text-zinc-600 text-xs">·</span>}
                      {s.section && <span className="text-xs text-zinc-400 dark:text-zinc-500">{s.section}</span>}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <button onClick={handleDownload} disabled={downloading}
            className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white font-semibold transition-colors flex items-center justify-center gap-2">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            {downloading ? "生成中…" : `Excel出力 (${exportCount}名 / ${startDate}〜${endDate})`}
          </button>
        </div>
      )}

      {/* ── 順守率タブ ── */}
      {pageTab === "compliance" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <input type="search" placeholder="氏名・社員ID・アカウント番号で検索" value={compSearch}
              onChange={e => setCompSearch(e.target.value)}
              className="flex-1 min-w-48 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
              className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="rate">順守率順</option>
              <option value="name">名前順</option>
              <option value="late">遅刻多い順</option>
              <option value="early">早退多い順</option>
              <option value="absent">欠勤多い順</option>
            </select>
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            {compLoading ? (
              <p className="py-10 text-center text-sm text-zinc-400">読み込み中…</p>
            ) : sortedCompliance.length === 0 ? (
              <p className="py-10 text-center text-sm text-zinc-400">データがありません</p>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {sortedCompliance.map(r => (
                  <div key={r.staffId} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {r.accountNumber && <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500 font-mono w-12 flex-shrink-0">{r.accountNumber}</span>}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate block">{r.name}</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {r.company  && <span className="text-xs text-zinc-400 dark:text-zinc-500">{r.company}</span>}
                          {r.company && r.section && <span className="text-zinc-300 dark:text-zinc-600 text-xs">·</span>}
                          {r.section  && <span className="text-xs text-zinc-400 dark:text-zinc-500">{r.section}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className={`text-lg font-bold tabular-nums ${rateColor(r.complianceRate)}`}>
                          {r.complianceRate != null ? `${r.complianceRate}%` : "─"}
                        </span>
                        <p className="text-xs text-zinc-400 tabular-nums">{r.totalShiftDays}日中</p>
                      </div>
                    </div>
                    {/* ゲージ */}
                    <div className="mt-2 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${rateBarColor(r.complianceRate)}`}
                        style={{ width: `${r.complianceRate ?? 0}%` }} />
                    </div>
                    {/* 内訳 */}
                    {(r.lateDays > 0 || r.earlyDays > 0 || r.absentDays > 0) && (
                      <div className="flex gap-3 mt-1.5">
                        {r.lateDays   > 0 && <span className="text-xs text-yellow-600 dark:text-yellow-400">遅刻 {r.lateDays}日</span>}
                        {r.earlyDays  > 0 && <span className="text-xs text-blue-500 dark:text-blue-400">早退 {r.earlyDays}日</span>}
                        {r.absentDays > 0 && <span className="text-xs text-red-500 dark:text-red-400">欠勤 {r.absentDays}日</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function lastMonth() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  return {
    start: new Date(y, m - 1, 1).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    end:   new Date(y, m,     0).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
  };
}

function lastWeek() {
  const now = new Date();
  const diff = (now.getDay() === 0 ? 7 : now.getDay()) + 6;
  const mon  = new Date(now); mon.setDate(now.getDate() - diff);
  const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
  return {
    start: mon.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    end:   sun.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
  };
}
