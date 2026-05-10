"use client";

import { useRef, useState, useTransition } from "react";
import { importShiftsCsvAction } from "../actions";

const TEMPLATE_ROWS = [
  "社員ID,日付,シフト名,開始,終了,備考",
  "S001,2026-05-01,日勤,09:00,18:00,",
  "S001,2026-05-02,公休,,,",
  "S002,2026-05-01,早番,07:00,16:00,研修",
];

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_ROWS.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "shift_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function CsvImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<{
    imported: number; skipped: number; errors: string[];
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFileName(f?.name ?? null);
    setResult(null);
  };

  const handleImport = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set("csv", file);
    startTransition(async () => {
      const r = await importShiftsCsvAction(fd);
      setResult({ imported: r.imported, skipped: r.skipped, errors: r.errors });
      if (r.success && fileRef.current) {
        fileRef.current.value = "";
        setFileName(null);
      }
    });
  };

  return (
    <div className="space-y-3">
      {/* テンプレートDL */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          CSVで月次シフトを一括登録できます
        </p>
        <button
          type="button"
          onClick={downloadTemplate}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          テンプレートをダウンロード
        </button>
      </div>

      {/* ファイル選択 */}
      <label
        className={[
          "flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 border-dashed cursor-pointer transition-colors",
          fileName
            ? "border-blue-400 bg-blue-50 dark:bg-blue-950/20"
            : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600",
        ].join(" ")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-zinc-400 flex-shrink-0" fill="none"
          viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className={`text-sm truncate ${fileName ? "text-blue-600 dark:text-blue-400 font-medium" : "text-zinc-400"}`}>
          {fileName ?? "CSVファイルを選択…"}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={handleFile}
        />
      </label>

      {/* インポートボタン */}
      {fileName && (
        <button
          type="button"
          onClick={handleImport}
          disabled={isPending}
          className="w-full py-3 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold disabled:opacity-40 transition-colors hover:bg-zinc-700 dark:hover:bg-zinc-300"
        >
          {isPending ? "インポート中…" : "インポート実行"}
        </button>
      )}

      {/* 結果 */}
      {result && (
        <div className={`rounded-2xl px-4 py-3 text-sm space-y-1 ${
          result.errors.length === 0
            ? "bg-emerald-50 dark:bg-emerald-950/30"
            : "bg-amber-50 dark:bg-amber-950/20"
        }`}>
          <p className={`font-semibold ${result.errors.length === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
            {result.imported}件を登録
            {result.skipped > 0 && `、${result.skipped}件スキップ`}
          </p>
          {result.errors.length > 0 && (
            <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-0.5 mt-1">
              {result.errors.slice(0, 5).map((e, i) => (
                <li key={i}>・{e}</li>
              ))}
              {result.errors.length > 5 && (
                <li>…他 {result.errors.length - 5} 件のエラー</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* フォーマット説明 */}
      <details className="group">
        <summary className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-600 select-none">
          CSVフォーマットを見る
        </summary>
        <div className="mt-2 px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 overflow-x-auto">
          {TEMPLATE_ROWS.map((row, i) => (
            <div key={i}>{row}</div>
          ))}
        </div>
        <p className="text-[10px] text-zinc-400 mt-1.5 px-0.5">
          ・1行目はヘッダー（無視されます）<br />
          ・日付は YYYY-MM-DD 形式<br />
          ・同じ社員ID＋日付は上書きされます<br />
          ・公休など時刻なしは空欄でOK
        </p>
      </details>
    </div>
  );
}
