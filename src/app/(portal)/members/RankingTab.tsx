"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import {
  fetchRankingAction,
  importRankingAction,
  type RankingRow,
} from "./ranking-actions";

type ImportRow = { rank: number; section: string | null; staffName: string };

export default function RankingTab({ projectId, hasData }: { projectId: string; hasData: boolean }) {
  const [rows, setRows]             = useState<RankingRow[]>([]);
  const [loaded, setLoaded]         = useState(false);
  const [isPending, start]          = useTransition();
  const [showImport, setShowImport] = useState(false);
  const [preview, setPreview]       = useState<ImportRow[]>([]);
  const [importMsg, setImportMsg]   = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef                     = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hasData) {
      start(async () => {
        const data = await fetchRankingAction(projectId);
        setRows(data);
        setLoaded(true);
      });
    } else {
      setLoaded(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    import("xlsx").then(XLSX => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const raw  = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];
        const parsed: ImportRow[] = raw.slice(1)
          .filter(row => Array.isArray(row) && (row as unknown[]).length >= 2)
          .map(row => {
            const r = row as unknown[];
            return {
              rank:      Number(r[0]) || 0,
              section:   String(r[1] ?? "").trim() || null,
              staffName: String(r[2] ?? "").trim(),
            };
          })
          .filter(r => r.rank > 0 && r.staffName && (r.section === "ASS査定" || r.section === "ASS販売"));

        // セクション別に順位を1から振り直す
        const counters: Record<string, number> = {};
        const renumbered = parsed.map(r => {
          const sec = r.section ?? "";
          counters[sec] = (counters[sec] ?? 0) + 1;
          return { ...r, rank: counters[sec] };
        });
        setPreview(renumbered);
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const handleImport = () => {
    if (preview.length === 0) return;
    start(async () => {
      const res = await importRankingAction(
        projectId,
        preview.map(r => ({ rank: r.rank, accountNumber: r.section, staffName: r.staffName }))
      );
      setImportMsg({ ok: res.success, text: res.message });
      if (res.success) {
        const data = await fetchRankingAction(projectId);
        setRows(data);
        setLoaded(true);
        setShowImport(false);
        setPreview([]);
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  };

  return (
    <div className="space-y-4 pt-4">

      {/* ヘッダー行 */}
      <div className="flex items-center gap-2">
        {!loaded && <p className="text-sm text-zinc-400">読み込み中…</p>}
        {loaded && rows.length === 0 && !showImport && (
          <p className="text-sm text-zinc-400">まだデータがありません</p>
        )}
        <button
          type="button"
          onClick={() => { setShowImport(v => !v); setImportMsg(null); }}
          className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          Excelインポート
        </button>
      </div>

      {/* インポートパネル */}
      {showImport && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Excelインポート</p>
            <button
              type="button"
              onClick={() => {
                import("xlsx").then(XLSX => {
                  const wb = XLSX.utils.book_new();
                  const ws = XLSX.utils.aoa_to_sheet([
                    ["順位", "セクション", "社員名"],
                    [1, "ASS査定", "ASS 42"],
                    [2, "ASS査定", "ASS 34"],
                    [3, "ASS販売", "ASS 11"],
                  ]);
                  ws["!cols"] = [{ wch: 8 }, { wch: 14 }, { wch: 20 }];
                  XLSX.utils.book_append_sheet(wb, ws, "番付");
                  XLSX.writeFile(wb, "番付テンプレート.xlsx");
                });
              }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              テンプレートDL
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-zinc-500 w-14 flex-shrink-0">ファイル</span>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="text-xs text-zinc-600 dark:text-zinc-300"
            />
          </div>

          <p className="text-[10px] text-zinc-400">
            1行目: ヘッダー（順位 / セクション / 社員名）　ASS査定・ASS販売のみ抽出されます
          </p>

          {preview.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-500">{preview.length}件を認識（プレビュー上位5件）</p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
                    <th className="pb-1.5 w-12">順位</th>
                    <th className="pb-1.5 w-32">セクション</th>
                    <th className="pb-1.5">社員名</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/60">
                      <td className="py-1 tabular-nums font-semibold text-zinc-700 dark:text-zinc-300">{r.rank}</td>
                      <td className="py-1 text-zinc-500">{r.section ?? "−"}</td>
                      <td className="py-1 text-zinc-700 dark:text-zinc-300">{r.staffName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={isPending}
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                >
                  {isPending ? "保存中…" : "保存する"}
                </button>
                {importMsg && (
                  <span className={`text-xs font-medium ${importMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                    {importMsg.text}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 番付テーブル */}
      {loaded && rows.length > 0 && (() => {
        const satei  = [...rows].filter(r => r.accountNumber === "ASS査定").sort((a, b) => a.rank - b.rank);
        const hanbai = [...rows].filter(r => r.accountNumber === "ASS販売").sort((a, b) => a.rank - b.rank);

        const Section = ({ title, list }: { title: string; list: typeof rows }) => (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{title}</span>
              <span className="text-[10px] tabular-nums text-zinc-400">{list.length} 名</span>
            </div>
            <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
              {list.map(r => (
                <div key={r.id} className="px-4 py-2 flex items-center gap-4">
                  <span className="w-10 tabular-nums text-sm font-bold text-zinc-800 dark:text-zinc-100">
                    {r.rank}
                  </span>
                  <span className="text-sm text-zinc-800 dark:text-zinc-100">
                    {r.staffName}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Section title="査定セクション" list={satei} />
            <Section title="販売セクション" list={hanbai} />
          </div>
        );
      })()}
    </div>
  );
}
