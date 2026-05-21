"use client";

import { useState, useTransition, useMemo } from "react";
import { upsertSlotRequirementsAction } from "./actions";

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

type Pattern = {
  name: string;
  section: string | null;
  start_time: string | null;
  end_time: string | null;
};
type SlotReq = { section: string; pattern_name: string; shift_date: string; required_count: number };

type Props = {
  projectId: string;
  targetYear: number;
  targetMonth: number;
  allDates: string[];
  shiftPatterns: Pattern[];
  slotRequirements: SlotReq[];
  onStartGenerate: (counts: { patternName: string; date: string; section: string | null; requiredCount: number }[]) => void;
};

export default function ShiftDraftPlanner({
  projectId, targetYear, targetMonth, allDates, shiftPatterns, slotRequirements, onStartGenerate,
}: Props) {
  // パターン×日付 → 必要人数（文字列として管理）
  const initial = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of slotRequirements) {
      m.set(`${r.pattern_name}__${r.shift_date}`, String(r.required_count));
    }
    return m;
  }, [slotRequirements]);

  const [counts, setCounts] = useState<Map<string, string>>(initial);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function setCount(patternName: string, date: string, val: string) {
    setSaved(false);
    const cleaned = val.replace(/[^0-9]/g, "");
    setCounts(prev => {
      const next = new Map(prev);
      const k = `${patternName}__${date}`;
      if (!cleaned || cleaned === "0") next.delete(k);
      else next.set(k, cleaned);
      return next;
    });
  }

  function handleSave() {
    setSaved(false);
    setSaveError(null);
    const changes = buildChanges();
    startTransition(async () => {
      const r = await upsertSlotRequirementsAction(projectId, changes);
      if (r.success) setSaved(true);
      else setSaveError(r.message ?? "保存失敗");
    });
  }

  function buildChanges() {
    const result: { patternName: string; date: string; section: string | null; requiredCount: number }[] = [];
    for (const pattern of shiftPatterns) {
      for (const date of allDates) {
        const v = counts.get(`${pattern.name}__${date}`);
        const n = v ? parseInt(v, 10) : 0;
        result.push({ patternName: pattern.name, date, section: pattern.section, requiredCount: n });
      }
    }
    return result;
  }

  function handleGenerate() {
    const changes = buildChanges();
    onStartGenerate(changes);
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            各シフトパターンの日別必要人数を入力してください。
          </p>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
            0または空欄は「設定なし」として扱われます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors"
          >
            {isPending ? "保存中…" : "必要数を保存"}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isPending}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            仮組を作成
          </button>
        </div>
      </div>

      {saved && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-xl">
          ✓ 必要人数を保存しました
        </p>
      )}
      {saveError && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 px-3 py-2 rounded-xl">
          ✗ {saveError}
        </p>
      )}

      {/* グリッド */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
        <table className="border-collapse text-xs" style={{ minWidth: `${60 + allDates.length * 44}px` }}>
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/80">
              <th className="sticky left-0 z-10 bg-zinc-50 dark:bg-zinc-800/80 px-3 py-2 text-left font-semibold text-zinc-600 dark:text-zinc-300 border-b border-r border-zinc-200 dark:border-zinc-700 whitespace-nowrap min-w-[100px]">
                パターン
              </th>
              {allDates.map(date => {
                const d = new Date(date + "T00:00:00Z");
                const day = d.getUTCDate();
                const dow = d.getUTCDay();
                const isWkend = dow === 0 || dow === 6;
                return (
                  <th key={date} className={[
                    "px-1 py-1.5 text-center border-b border-zinc-200 dark:border-zinc-700 font-medium w-11",
                    isWkend
                      ? "text-blue-500 dark:text-blue-400"
                      : "text-zinc-500 dark:text-zinc-400",
                  ].join(" ")}>
                    <div className="leading-none">{day}</div>
                    <div className="text-[9px] leading-none mt-0.5">{WEEKDAY_JP[dow]}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shiftPatterns.map((pattern, pi) => (
              <tr key={pattern.name} className={pi % 2 === 0 ? "bg-white dark:bg-zinc-950" : "bg-zinc-50/50 dark:bg-zinc-900/30"}>
                <td className="sticky left-0 z-10 bg-inherit px-3 py-2 border-r border-zinc-200 dark:border-zinc-700 whitespace-nowrap">
                  <div className="font-medium text-zinc-800 dark:text-zinc-100">{pattern.name}</div>
                  {pattern.section && (
                    <div className="text-[10px] text-zinc-400">{pattern.section}</div>
                  )}
                </td>
                {allDates.map(date => {
                  const k = `${pattern.name}__${date}`;
                  const val = counts.get(k) ?? "";
                  const d = new Date(date + "T00:00:00Z");
                  const isWkend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
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
        「必要数を保存」で入力内容を保存、「仮組を作成」で保存して自動シフト生成に進みます。
      </p>
    </div>
  );
}
