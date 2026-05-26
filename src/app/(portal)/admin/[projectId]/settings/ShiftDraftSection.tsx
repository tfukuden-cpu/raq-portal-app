"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  fetchSlotRequirementsForMonthAction,
  generateShiftDraftAction,
  type SlotReqRow,
} from "./draft-actions";
import { upsertSlotRequirementsAction } from "@/app/(portal)/shifts/manage/actions";

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

type Pattern = {
  name: string;
  section: string | null;
  start_time: string | null;
  end_time: string | null;
  target_role: string;
  required_count:   number | null;
  required_weekday: number | null;
  required_weekend: number | null;
};

function pad(n: number) { return String(n).padStart(2, "0"); }

function buildAllDates(year: number, month: number): string[] {
  const lastDay = new Date(year, month, 0).getDate();
  return Array.from({ length: lastDay }, (_, i) =>
    `${year}-${pad(month)}-${pad(i + 1)}`
  );
}

export default function ShiftDraftSection({
  projectId,
  patterns,
}: {
  projectId: string;
  patterns: Pattern[];
}) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [step, setStep]   = useState<"select" | "grid" | "done">("select");

  const [slotReqs, setSlotReqs]   = useState<SlotReqRow[]>([]);
  const [counts, setCounts]       = useState<Map<string, string>>(new Map());
  const [saveDone, setSaveDone]   = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [generated, setGenerated] = useState<number | null>(null);

  const [isFetching, startFetch]     = useTransition();
  const [isSaving, startSave]        = useTransition();
  const [isGenerating, startGenerate] = useTransition();

  const router = useRouter();

  const allDates = useMemo(() => buildAllDates(year, month), [year, month]);

  // 月を開いてスロット要件を取得
  function handleOpenGrid() {
    setError(null);
    setSaveDone(false);
    setGenerated(null);
    startFetch(async () => {
      const r = await fetchSlotRequirementsForMonthAction(projectId, year, month);
      if (!r.success) { setError(r.message ?? "取得失敗"); return; }
      const rows = r.slotRequirements ?? [];
      setSlotReqs(rows);
      const m = new Map<string, string>();
      for (const r of rows) m.set(`${r.pattern_name}__${r.shift_date}`, String(r.required_count));
      setCounts(m);
      setStep("grid");
    });
  }

  function setCount(patternName: string, date: string, val: string) {
    setSaveDone(false);
    // 数字以外除去（type="text"でも数値のみ受け入れる）
    const cleaned = val.replace(/[^0-9]/g, "");
    setCounts(prev => {
      const next = new Map(prev);
      const k = `${patternName}__${date}`;
      // 空・0 は「未設定」としてキー削除（保存時は requiredCount=0 として扱う）
      if (!cleaned || cleaned === "0") next.delete(k); else next.set(k, cleaned);
      return next;
    });
  }

  function buildChanges() {
    return patterns.flatMap(p =>
      allDates.map(date => {
        const v = counts.get(`${p.name}__${date}`);
        return { patternName: p.name, date, section: p.section, requiredCount: v ? parseInt(v, 10) : 0 };
      })
    );
  }

  function handleSaveCounts() {
    setError(null);
    setSaveDone(false);
    startSave(async () => {
      const r = await upsertSlotRequirementsAction(projectId, buildChanges());
      if (r.success) setSaveDone(true);
      else setError(r.message ?? "保存失敗");
    });
  }

  function handleGenerate() {
    setError(null);
    setSaveDone(false);
    startGenerate(async () => {
      // 必要数を先に保存してから生成
      const saveR = await upsertSlotRequirementsAction(projectId, buildChanges());
      if (!saveR.success) { setError(saveR.message ?? "保存失敗"); return; }

      const r = await generateShiftDraftAction(projectId, year, month, patterns);
      if (!r.success) { setError(r.message ?? "生成失敗"); return; }
      setGenerated(r.assignedCount ?? 0);
      setStep("done");
    });
  }

  // 年月セレクター
  const yearOptions = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  if (step === "select") {
    return (
      <div className="space-y-4">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          仮組を作成する月を選択し、各パターンの必要人数を入力してください。
        </p>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm text-zinc-800 dark:text-zinc-100"
          >
            {yearOptions.map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm text-zinc-800 dark:text-zinc-100"
          >
            {monthOptions.map(m => <option key={m} value={m}>{m}月</option>)}
          </select>
          <button
            type="button"
            onClick={handleOpenGrid}
            disabled={isFetching || patterns.length === 0}
            className="px-4 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {isFetching ? "読み込み中…" : "シフトの仮組をする"}
          </button>
        </div>
        {patterns.length === 0 && (
          <p className="text-xs text-amber-500">シフトパターンを先に登録・保存してください。</p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="space-y-3">
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            ✓ 仮組が完了しました
          </p>
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            {year}年{month}月 — {generated}件のシフトを割当。シフト管理画面で確認・編集できます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push(`/shifts/manage?year=${year}&month=${month}`)}
            className="px-4 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
          >
            シフト管理で確認
          </button>
          <button
            type="button"
            onClick={() => { setStep("select"); setGenerated(null); }}
            className="px-4 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            別の月で仮組
          </button>
        </div>
      </div>
    );
  }

  // step === "grid"
  return (
    <div className="space-y-3">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStep("select")}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            ← 月選択に戻る
          </button>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            {year}年{month}月 — 必要人数
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSaveCounts}
            disabled={isSaving || isGenerating}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors"
          >
            {isSaving ? "保存中…" : "必要数を保存"}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isSaving || isGenerating}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {isGenerating ? "生成中…" : "仮組を作成"}
          </button>
        </div>
      </div>

      {saveDone && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-xl">
          ✓ 必要人数を保存しました
        </p>
      )}
      {error && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 px-3 py-2 rounded-xl">
          ✗ {error}
        </p>
      )}

      {/* グリッド */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
        <table className="border-collapse text-xs" style={{ minWidth: `${80 + allDates.length * 44}px` }}>
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/80">
              <th className="sticky left-0 z-10 bg-zinc-50 dark:bg-zinc-800/80 px-3 py-2 text-left font-semibold text-zinc-600 dark:text-zinc-300 border-b border-r border-zinc-200 dark:border-zinc-700 min-w-[80px]">
                パターン
              </th>
              {allDates.map(date => {
                const d   = new Date(date + "T00:00:00Z");
                const day = d.getUTCDate();
                const dow = d.getUTCDay();
                const isWkend = dow === 0 || dow === 6;
                return (
                  <th key={date} className={[
                    "px-1 py-1.5 text-center border-b border-zinc-200 dark:border-zinc-700 font-medium w-11",
                    isWkend ? "text-blue-500 dark:text-blue-400" : "text-zinc-500 dark:text-zinc-400",
                  ].join(" ")}>
                    <div className="leading-none">{day}</div>
                    <div className="text-[9px] leading-none mt-0.5">{WEEKDAY_JP[dow]}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {patterns.map((pattern, pi) => (
              <tr key={pattern.name} className={pi % 2 === 0 ? "bg-white dark:bg-zinc-950" : "bg-zinc-50/50 dark:bg-zinc-900/30"}>
                <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5 border-r border-zinc-200 dark:border-zinc-700 whitespace-nowrap">
                  <div className="font-medium text-zinc-800 dark:text-zinc-100 text-[11px]">{pattern.name}</div>
                  {pattern.section && (
                    <div className="text-[10px] text-zinc-400">{pattern.section}</div>
                  )}
                </td>
                {allDates.map(date => {
                  const val = counts.get(`${pattern.name}__${date}`) ?? "";
                  const dow = new Date(date + "T00:00:00Z").getUTCDay();
                  const isWkend = dow === 0 || dow === 6;
                  return (
                    <td key={date} className={[
                      "px-0.5 py-1 text-center border-r border-zinc-100 dark:border-zinc-800",
                      isWkend ? "bg-blue-50/30 dark:bg-blue-950/10" : "",
                    ].join(" ")}>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={2}
                        value={val}
                        onChange={e => setCount(pattern.name, date, e.target.value)}
                        onFocus={e => e.target.select()}
                        placeholder="0"
                        className={[
                          "w-10 h-8 text-center text-xs rounded-lg border transition-colors tabular-nums",
                          "bg-white dark:bg-zinc-900",
                          val
                            ? "border-blue-300 dark:border-blue-700 text-zinc-800 dark:text-zinc-100"
                            : "border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500",
                        ].join(" ")}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
        「仮組を作成」を押すと必要数を保存してシフトを自動生成し、シフト管理の下書きに反映します。
      </p>
    </div>
  );
}
