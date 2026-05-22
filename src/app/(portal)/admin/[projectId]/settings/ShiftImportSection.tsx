"use client";

import { useState, useTransition, useRef } from "react";

export default function ShiftImportSection({ projectId }: { projectId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg]  = useState<{ ok: boolean; msg: string } | null>(null);
  const [isImporting, startImport] = useTransition();

  function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setImportMsg({ ok: false, msg: "ファイルを選択してください" }); return; }
    setImportMsg(null);
    startImport(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("projectId", projectId);
      const res  = await fetch("/api/admin/import-shift-off-requests", { method: "POST", body: fd });
      const json = await res.json();
      if (json.ok) {
        setImportMsg({
          ok:  true,
          msg: `${json.month} — ${json.imported}件 取り込み完了${json.skipped?.length ? `（未マッチ: ${json.skipped.join(", ")}）` : ""}`,
        });
      } else {
        setImportMsg({ ok: false, msg: json.error ?? json.message ?? "エラー" });
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-3">
      <div>
        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Googleフォーム集計Excelをインポート</p>
        <p className="text-[11px] text-zinc-400 mt-0.5">「希望休」という名称を含むシートを自動認識します。同月同スタッフのデータは上書きされます。</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="text-xs text-zinc-600 dark:text-zinc-300 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-zinc-200 dark:file:bg-zinc-700 file:text-zinc-700 dark:file:text-zinc-300 hover:file:bg-zinc-300"
        />
        <button
          onClick={handleImport}
          disabled={isImporting}
          className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          {isImporting ? "インポート中…" : "インポート"}
        </button>
      </div>
      {importMsg && (
        <p className={`text-xs px-3 py-2 rounded-xl ${importMsg.ok ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300" : "bg-red-50 dark:bg-red-950/20 text-red-500"}`}>
          {importMsg.ok ? "✓ " : "✗ "}{importMsg.msg}
        </p>
      )}
    </div>
  );
}
