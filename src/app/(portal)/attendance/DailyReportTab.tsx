"use client";

import { useState } from "react";
import { DownloadIcon } from "@/components/icons";

export type DailyReportRow = {
  staffId: string;
  name: string;
  accountNumber: string | null;
  prioritySection: string;   // 優先セクション（販売 / 査定）
  todaySection: string;      // 当日の対応セクション
  isAbsent: boolean;         // 欠勤報告が上がっているか（初期チェック）
};

const PRIORITY_GROUPS = ["販売", "査定"] as const;
const SHIFT_DEFAULT = "7.5";

function accNum(acc: string | null): number {
  if (!acc) return 999999;
  const m = acc.match(/(\d+)/);
  return m ? parseInt(m[1]) : 999999;
}

export default function DailyReportTab({
  rows, dateLabel,
}: {
  rows: DailyReportRow[];
  dateLabel: string;
}) {
  // 欠勤チェック状態（欠勤報告があれば初期チェック・手動で増減可）
  const [absentChecks, setAbsentChecks] = useState<Set<string>>(
    () => new Set(rows.filter(r => r.isAbsent).map(r => r.staffId))
  );

  const toggle = (staffId: string) =>
    setAbsentChecks(prev => {
      const next = new Set(prev);
      if (next.has(staffId)) next.delete(staffId); else next.add(staffId);
      return next;
    });

  const groups = PRIORITY_GROUPS.map(g => ({
    section: g,
    rows: rows.filter(r => r.prioritySection === g).sort((a, b) => accNum(a.accountNumber) - accNum(b.accountNumber)),
  })).filter(g => g.rows.length > 0);

  async function exportXLSX() {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "Raq Portal";
    const ws = wb.addWorksheet(dateLabel.slice(0, 31));

    const HEADER = ["ASS", "アカウント番号", "シフト", "商材", "欠勤", "追加", "当日セクション"];

    for (const g of groups) {
      const titleRow = ws.addRow([`ASS${g.section}`]);
      titleRow.font = { bold: true, size: 12 };
      const head = ws.addRow(HEADER);
      head.font = { bold: true, size: 10 };
      head.eachCell(c => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
        c.alignment = { horizontal: "center" };
      });
      for (const r of g.rows) {
        const isAbsent = absentChecks.has(r.staffId);
        const isAdded  = r.prioritySection !== r.todaySection;
        ws.addRow([
          `ASS${g.section}`,
          r.accountNumber ?? "",
          SHIFT_DEFAULT,
          g.section,
          isAbsent ? "✓" : "",
          isAdded ? "✓" : "",
          r.todaySection,
        ]);
      }
      ws.addRow([]); // グループ間の空行
    }

    ws.columns.forEach(col => { col.width = 14; });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `日次報告_${dateLabel.replace(/[（）]/g, "")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400 text-center py-10">本日の販売・査定の対象者はいません</p>;
  }

  return (
    <div className="pb-32">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-zinc-400">欠勤報告があれば自動でチェック済み。手動でも変更できます。</p>
        <button type="button" onClick={exportXLSX}
          className="flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shadow-sm">
          <DownloadIcon className="w-3.5 h-3.5" />
          Excel出力
        </button>
      </div>

      {groups.map(g => (
        <div key={g.section} className="mb-6">
          <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100 mb-1.5">ASS{g.section}<span className="ml-2 text-xs font-semibold text-zinc-400">{g.rows.length}名</span></h3>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                  <th className="px-2 py-1.5 text-left font-semibold">ASS</th>
                  <th className="px-2 py-1.5 text-left font-semibold">アカウント番号</th>
                  <th className="px-2 py-1.5 text-center font-semibold">シフト</th>
                  <th className="px-2 py-1.5 text-left font-semibold">商材</th>
                  <th className="px-2 py-1.5 text-center font-semibold">欠勤</th>
                  <th className="px-2 py-1.5 text-center font-semibold">追加</th>
                  <th className="px-2 py-1.5 text-left font-semibold">当日セクション</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map(r => {
                  const isAbsent = absentChecks.has(r.staffId);
                  const isAdded  = r.prioritySection !== r.todaySection;
                  return (
                    <tr key={r.staffId} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="px-2 py-1.5 text-zinc-500 tabular-nums">ASS{g.section}</td>
                      <td className="px-2 py-1.5 tabular-nums text-zinc-700 dark:text-zinc-200">
                        {r.accountNumber ?? "—"}
                        <span className="ml-1.5 text-zinc-400">{r.name}</span>
                      </td>
                      <td className="px-2 py-1.5 text-center tabular-nums">{SHIFT_DEFAULT}</td>
                      <td className="px-2 py-1.5">{g.section}</td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={isAbsent} onChange={() => toggle(r.staffId)}
                          className="w-4 h-4 accent-red-500 cursor-pointer" />
                      </td>
                      <td className="px-2 py-1.5 text-center">{isAdded ? <span className="text-blue-600 dark:text-blue-400 font-bold">✓</span> : ""}</td>
                      <td className="px-2 py-1.5">
                        <span className={isAdded ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-zinc-600 dark:text-zinc-300"}>{r.todaySection}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
