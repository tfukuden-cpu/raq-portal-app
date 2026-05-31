"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import {
  fetchRankingAction,
  importRankingAction,
  deleteRankingPeriodAction,
  type RankingRow,
} from "./ranking-actions";

type ImportRow = { rank: number; accountNumber: string | null; staffName: string };

export default function RankingTab({
  projectId,
  initialPeriods,
}: {
  projectId: string;
  initialPeriods: string[];
}) {
  const [periods, setPeriods]         = useState<string[]>(initialPeriods);
  const [selectedPeriod, setSelected] = useState<string>(initialPeriods[0] ?? "");
  const [rows, setRows]               = useState<RankingRow[]>([]);
  const [loadedPeriod, setLoaded]     = useState<string>("");
  const [isPending, start]            = useTransition();

  const [showImport, setShowImport]   = useState(false);
  const [importPeriod, setImportPeriod] = useState("");
  const [preview, setPreview]         = useState<ImportRow[]>([]);
  const [importMsg, setImportMsg]     = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef                       = useRef<HTMLInputElement>(null);

  const loadRanking = (period: string) => {
    if (!period) return;
    start(async () => {
      const data = await fetchRankingAction(projectId, period);
      setRows(data);
      setLoaded(period);
    });
  };

  useEffect(() => {
    if (initialPeriods[0]) loadRanking(initialPeriods[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePeriodChange = (p: string) => {
    setSelected(p);
    loadRanking(p);
  };

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
              rank:          Number(r[0]) || 0,
              accountNumber: String(r[1] ?? "").trim() || null,
              staffName:     String(r[2] ?? "").trim(),
            };
          })
          .filter(r => r.rank > 0 && r.staffName);
        setPreview(parsed);
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const handleImport = () => {
    const period = importPeriod.trim();
    if (!period || preview.length === 0) return;
    start(async () => {
      const res = await importRankingAction(projectId, period, preview);
      setImportMsg({ ok: res.success, text: res.message });
      if (res.success) {
        setPeriods(prev => prev.includes(period) ? prev : [period, ...prev]);
        setSelected(period);
        loadRanking(period);
        setShowImport(false);
        setPreview([]);
        setImportPeriod("");
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  };

  const handleDelete = () => {
    if (!selectedPeriod) return;
    if (!confirm(`「${selectedPeriod}」の番付データを削除しますか？`)) return;
    start(async () => {
      const res = await deleteRankingPeriodAction(projectId, selectedPeriod);
      if (res.success) {
        const next = periods.filter(p => p !== selectedPeriod);
        setPeriods(next);
        setSelected(next[0] ?? "");
        setRows([]);
        setLoaded("");
        if (next[0]) loadRanking(next[0]);
      }
    });
  };

  return (
    <div className="space-y-4 pt-4">

      {/* 期間セレクタ + ボタン群 */}
      <div className="flex items-center gap-2 flex-wrap">
        {periods.length > 0 ? (
          <select
            value={selectedPeriod}
            onChange={e => handlePeriodChange(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-800 dark:text-zinc-200 font-medium"
          >
            {periods.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : (
          <p className="text-sm text-zinc-400">まだデータがありません</p>
        )}
        <button
          type="button"
          onClick={() => { setShowImport(v => !v); setImportMsg(null); }}
          className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          Excelインポート
        </button>
        {selectedPeriod && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="px-3 py-1.5 rounded-xl border border-red-200 dark:border-red-900/50 text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40 transition-colors"
          >
            削除
          </button>
        )}
      </div>

      {/* インポートパネル */}
      {showImport && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Excelインポート</p>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-zinc-500 w-14 flex-shrink-0">期間</span>
            <input
              type="text"
              value={importPeriod}
              onChange={e => setImportPeriod(e.target.value)}
              placeholder="例: 2026年5月"
              className="flex-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm text-zinc-800 dark:text-zinc-200 placeholder-zinc-400"
            />
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
            1行目: ヘッダー（順位 / アカウント番号 / 名前）　2行目以降: データ
          </p>

          {preview.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-500">{preview.length}件を認識（プレビュー上位5件）</p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
                    <th className="pb-1.5 w-12">順位</th>
                    <th className="pb-1.5 w-32">アカウント番号</th>
                    <th className="pb-1.5">名前</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/60">
                      <td className="py-1 tabular-nums font-semibold text-zinc-700 dark:text-zinc-300">{r.rank}</td>
                      <td className="py-1 tabular-nums text-zinc-500">{r.accountNumber ?? "−"}</td>
                      <td className="py-1 text-zinc-700 dark:text-zinc-300">{r.staffName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={!importPeriod.trim() || isPending}
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
      {isPending && rows.length === 0 ? (
        <p className="text-sm text-zinc-400 py-10 text-center">読み込み中…</p>
      ) : rows.length === 0 && (loadedPeriod || periods.length === 0) ? (
        <p className="text-sm text-zinc-400 py-10 text-center">
          {periods.length === 0 ? "Excelインポートからデータを追加してください" : "データがありません"}
        </p>
      ) : rows.length > 0 ? (
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          {/* テーブルヘッダー */}
          <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-100 dark:border-zinc-800 flex gap-4 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            <span className="w-10">順位</span>
            <span className="w-32">アカウント番号</span>
            <span>名前</span>
          </div>
          {/* 行 */}
          <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {rows.map(r => (
              <div key={r.id} className="px-4 py-2.5 flex items-center gap-4">
                <span className="w-10 tabular-nums text-sm font-bold text-zinc-800 dark:text-zinc-100">
                  {r.rank}
                </span>
                <span className="w-32 tabular-nums text-xs text-zinc-400 dark:text-zinc-500">
                  {r.accountNumber ?? "−"}
                </span>
                <span className="text-sm text-zinc-800 dark:text-zinc-100">
                  {r.staffName}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
