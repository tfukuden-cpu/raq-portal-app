"use client";

import { useState, useMemo } from "react";
import type { StaffEntry } from "@/app/(portal)/admin/work-records/WorkRecordsClient";

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

  const [startDate,    setStartDate]    = useState(thisMonthStart);
  const [endDate,      setEndDate]      = useState(today);
  // 空 = すべての会社。複数選択可
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [downloading,  setDownloading]  = useState(false);

  const companies = useMemo(
    () => [...new Set(staffs.map(s => s.company ?? "未設定"))].sort(),
    [staffs],
  );

  function toggleCompany(c: string) {
    setSelectedCompanies(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  }

  // 出力対象スタッフ
  const targetStaffs = useMemo(() =>
    selectedCompanies.length > 0
      ? staffs.filter(s => selectedCompanies.includes(s.company ?? "未設定"))
      : staffs,
    [staffs, selectedCompanies],
  );

  async function handleDownload() {
    const ids    = targetStaffs.map(s => s.staffId);
    const params = new URLSearchParams({
      projectId,
      startDate,
      endDate,
      staffIds: ids.join(","),
      mode: "company",
    });
    setDownloading(true);
    try {
      const res = await fetch(`/api/admin/work-records/export?${params}`);
      if (!res.ok) { alert("エクスポートに失敗しました"); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      const companyLabel = selectedCompanies.length === 0
        ? "全社"
        : selectedCompanies.length <= 2
          ? selectedCompanies.join("+")
          : `${selectedCompanies[0]}ほか${selectedCompanies.length - 1}社`;
      a.download = `稼働実績_${companyLabel}_${startDate}_${endDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const PERIOD_BTNS = [
    { label: "今月", start: thisMonthStart,              end: today },
    { label: "先月", ...lastMonth() },
    { label: "先週", ...lastWeek() },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800">
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

        {/* 本体 */}
        <div className="px-5 py-4 space-y-4">

          {/* 出力期間 */}
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

          {/* 会社名（複数選択可） */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">会社名（複数選択可）</p>
              {selectedCompanies.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedCompanies([])}
                  className="text-[11px] font-semibold text-blue-500 hover:text-blue-600"
                >選択をクリア</button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedCompanies([])}
              className={[
                "w-full flex items-center justify-between px-3 py-2 rounded-xl border text-sm transition-colors",
                selectedCompanies.length === 0
                  ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 font-semibold"
                  : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              <span>すべての会社</span>
              <span className="tabular-nums text-xs">{staffs.length}名</span>
            </button>
            <div className="max-h-44 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800">
              {companies.map(c => {
                const count = staffs.filter(s => (s.company ?? "未設定") === c).length;
                const checked = selectedCompanies.includes(c);
                return (
                  <label key={c}
                    className={[
                      "flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer transition-colors",
                      checked ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCompany(c)}
                      className="accent-blue-600 w-4 h-4"
                    />
                    <span className={`flex-1 truncate ${checked ? "font-semibold text-blue-700 dark:text-blue-300" : "text-zinc-700 dark:text-zinc-200"}`}>{c}</span>
                    <span className="tabular-nums text-xs text-zinc-400">{count}名</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* フッター */}
        <div className="px-5 pb-5 pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
          <p className="text-xs text-zinc-400 text-center tabular-nums">
            {targetStaffs.length}名 · {startDate} 〜 {endDate}
          </p>
          <button
            onClick={handleDownload}
            disabled={downloading || targetStaffs.length === 0}
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
