"use client";

import { useState, useTransition } from "react";
import { upsertSlotRequirementAction } from "./sufficiency-actions";

type Pattern = {
  name: string;
  section: string | null;
  required_weekday: number | null;
  required_weekend: number | null;
};

type Shift = {
  staff_id: string;
  shift_date: string;
  shift_name: string;
};

type SlotReq = {
  section: string;
  pattern_name: string;
  shift_date: string;
  required_count: number;
};

type Member = {
  id: string;
  section: string | null;
};

type Props = {
  projectId: string;
  allDates: string[];   // ["2026-05-01", ...]
  patterns: Pattern[];
  shifts: Shift[];
  members: Member[];
  slotRequirements: SlotReq[];
  holidays: string[];   // 祝日の date 文字列一覧
};

function isWeekend(dateStr: string, holidays: string[]): boolean {
  const d = new Date(dateStr);
  const dow = d.getUTCDay(); // 0=日, 6=土
  return dow === 0 || dow === 6 || holidays.includes(dateStr);
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return String(d.getUTCDate());
}

function dayOfWeekLabel(dateStr: string): string {
  return ["日", "月", "火", "水", "木", "金", "土"][new Date(dateStr).getUTCDay()];
}

export default function ShiftSufficiencyTable({
  projectId,
  allDates,
  patterns,
  shifts,
  members,
  slotRequirements,
  holidays,
}: Props) {
  // セクションがあるパターンのみ対象
  const targetPatterns = patterns.filter(p => p.section);

  // セクション一覧（重複排除・順序維持）
  const sections = Array.from(new Set(targetPatterns.map(p => p.section!)));

  // 編集ポップオーバー state
  const [editing, setEditing] = useState<{
    section: string; pattern: string; date: string; current: number;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [, startTransition] = useTransition();

  if (targetPatterns.length === 0) return null;

  // slot requirements を Map に変換 key: "section::pattern::date"
  const reqMap = new Map<string, number>();
  for (const r of slotRequirements) {
    reqMap.set(`${r.section}::${r.pattern_name}::${r.shift_date}`, r.required_count);
  }

  // メンバーのセクションMap
  const memberSectionMap = new Map<string, string | null>();
  for (const m of members) {
    memberSectionMap.set(m.id, m.section);
  }

  // 実際の充足数を計算
  function getActual(section: string, patternName: string, date: string): number {
    return shifts.filter(s =>
      s.shift_date === date &&
      s.shift_name === patternName &&
      memberSectionMap.get(s.staff_id) === section
    ).length;
  }

  function getRequired(pattern: Pattern, date: string): number {
    const key = `${pattern.section}::${pattern.name}::${date}`;
    if (reqMap.has(key)) return reqMap.get(key)!;
    const weekend = isWeekend(date, holidays);
    if (weekend && pattern.required_weekend != null) return pattern.required_weekend;
    if (!weekend && pattern.required_weekday != null) return pattern.required_weekday;
    return 0;
  }

  function openEdit(section: string, pattern: string, date: string, current: number) {
    setEditing({ section, pattern, date, current });
    setEditValue(String(current));
  }

  function saveEdit() {
    if (!editing) return;
    const val = Number(editValue);
    if (isNaN(val) || val < 0) return;
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("section", editing.section);
    fd.set("patternName", editing.pattern);
    fd.set("shiftDate", editing.date);
    fd.set("requiredCount", String(val));
    startTransition(async () => {
      await upsertSlotRequirementAction(fd);
      // 楽観的更新
      reqMap.set(`${editing.section}::${editing.pattern}::${editing.date}`, val);
      setEditing(null);
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
        <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">充足表</h2>
        <p className="text-[10px] text-zinc-400 mt-0.5">必要数セルをタップして日別上書き可</p>
      </div>

      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-max">
          <thead>
            <tr>
              {/* 固定列ヘッダー */}
              <th className="sticky left-0 z-10 bg-zinc-50 dark:bg-zinc-800 px-3 py-1.5 text-left font-semibold text-zinc-500 dark:text-zinc-400 border-b border-r border-zinc-200 dark:border-zinc-700 min-w-[100px]">
                セクション
              </th>
              <th className="sticky left-[100px] z-10 bg-zinc-50 dark:bg-zinc-800 px-3 py-1.5 text-left font-semibold text-zinc-500 dark:text-zinc-400 border-b border-r border-zinc-200 dark:border-zinc-700 min-w-[72px]">
                パターン
              </th>
              {allDates.map(d => {
                const weekend = isWeekend(d, holidays);
                return (
                  <th key={d}
                    className={[
                      "px-1.5 py-1 text-center font-semibold border-b border-zinc-200 dark:border-zinc-700 min-w-[36px]",
                      weekend ? "text-red-500 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20"
                               : "text-zinc-500 dark:text-zinc-400",
                    ].join(" ")}>
                    <div className="tabular-nums">{dayLabel(d)}</div>
                    <div className="text-[9px] font-normal">{dayOfWeekLabel(d)}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sections.map(section => {
              const sectionPatterns = targetPatterns.filter(p => p.section === section);
              return sectionPatterns.map((pattern, pi) => (
                <tr key={`${section}-${pattern.name}`}
                  className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                  {/* セクション列（rowSpan） */}
                  {pi === 0 && (
                    <td
                      rowSpan={sectionPatterns.length}
                      className="sticky left-0 z-10 bg-white dark:bg-zinc-900 px-3 py-1.5 font-semibold text-zinc-700 dark:text-zinc-300 border-r border-zinc-200 dark:border-zinc-700 align-middle">
                      {section}
                    </td>
                  )}
                  {/* パターン列 */}
                  <td className="sticky left-[100px] z-10 bg-zinc-50 dark:bg-zinc-800/60 px-3 py-1.5 text-zinc-600 dark:text-zinc-400 border-r border-zinc-200 dark:border-zinc-700 whitespace-nowrap">
                    {pattern.name}
                  </td>
                  {/* 日別セル */}
                  {allDates.map(date => {
                    const required = getRequired(pattern, date);
                    const actual   = getActual(section, pattern.name, date);
                    const diff     = required === 0 ? 0 : actual - required;
                    const hasOverride = reqMap.has(`${section}::${pattern.name}::${date}`);
                    const weekend = isWeekend(date, holidays);

                    return (
                      <td key={date}
                        onClick={() => openEdit(section, pattern.name, date, required)}
                        className={[
                          "text-center tabular-nums py-1 px-0.5 cursor-pointer transition-colors select-none",
                          weekend ? "bg-red-50/30 dark:bg-red-950/10" : "",
                          "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                        ].join(" ")}>
                        {required === 0 ? (
                          <span className="text-zinc-300 dark:text-zinc-700">—</span>
                        ) : (
                          <div className="flex flex-col items-center leading-tight">
                            <span className={[
                              "font-bold text-[11px]",
                              diff > 0 ? "text-emerald-600 dark:text-emerald-400"
                               : diff < 0 ? "text-red-500 dark:text-red-400"
                               : "text-zinc-400 dark:text-zinc-500",
                            ].join(" ")}>
                              {diff > 0 ? `+${diff}` : diff}
                            </span>
                            <span className={[
                              "text-[9px]",
                              hasOverride ? "text-blue-500 dark:text-blue-400" : "text-zinc-300 dark:text-zinc-600",
                            ].join(" ")}>
                              {actual}/{required}
                            </span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      {/* 編集ポップオーバー */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/30 backdrop-blur-sm"
          onClick={() => setEditing(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-5 w-full max-w-sm space-y-3"
            onClick={e => e.stopPropagation()}>
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {editing.section} / {editing.pattern}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">{editing.date} の必要人数を上書き</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => e.key === "Enter" && saveEdit()}
                autoFocus
                className="flex-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-center text-lg font-bold"
              />
              <span className="text-sm text-zinc-400">人</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditing(null)}
                className="flex-1 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500">
                キャンセル
              </button>
              <button onClick={saveEdit}
                className="flex-1 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
