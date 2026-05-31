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
  allDates: string[];
  patterns: Pattern[];
  shifts: Shift[];
  members: Member[];
  slotRequirements: SlotReq[];
  holidays: string[];
  selectedDate?: string;
  onDateSelect?: (date: string) => void;
};

// 合計から除外・最下部に表示するセクション
const EXCLUDE_FROM_TOTAL = ["ローン", "リメイク"];

function isWeekend(dateStr: string, holidays: string[]): boolean {
  const d = new Date(dateStr);
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6 || holidays.includes(dateStr);
}
function dayLabel(dateStr: string): string {
  return String(new Date(dateStr).getUTCDate());
}
function dayOfWeekLabel(dateStr: string): string {
  return ["日","月","火","水","木","金","土"][new Date(dateStr).getUTCDay()];
}

// ── セル共通スタイル ──
// 高さを小さくするため py-0 + leading-none で固定
const CELL_DATA = "text-center tabular-nums py-0 px-0.5 h-[22px] leading-none";
const CELL_LABEL = "sticky left-0 z-10 bg-white dark:bg-zinc-900 px-2 py-0 h-[22px] leading-none font-semibold border-r border-zinc-200 dark:border-zinc-700 align-middle";
const CELL_PATTERN = "sticky left-[90px] z-10 bg-zinc-50 dark:bg-zinc-800/60 px-2 py-0 h-[22px] leading-none text-zinc-600 dark:text-zinc-400 border-r border-zinc-200 dark:border-zinc-700 whitespace-nowrap";

export default function ShiftSufficiencyTable({
  projectId,
  allDates,
  patterns,
  shifts,
  members,
  slotRequirements,
  holidays,
  selectedDate,
  onDateSelect,
}: Props) {
  const targetPatterns = patterns.filter(p => p.section);
  const allSections = Array.from(new Set(targetPatterns.map(p => p.section!)));
  const mainSections   = allSections.filter(s => !EXCLUDE_FROM_TOTAL.includes(s));
  const bottomSections = allSections.filter(s =>  EXCLUDE_FROM_TOTAL.includes(s));

  const [collapsed, setCollapsed] = useState(true);
  const [editing, setEditing] = useState<{
    section: string; pattern: string; date: string; current: number;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [, startTransition] = useTransition();

  if (targetPatterns.length === 0) return null;

  const reqMap = new Map<string, number>();
  for (const r of slotRequirements) {
    reqMap.set(`${r.section}::${r.pattern_name}::${r.shift_date}`, r.required_count);
  }
  const memberSectionMap = new Map<string, string | null>();
  for (const m of members) memberSectionMap.set(m.id, m.section);

  function getActual(section: string, patternName: string, date: string): number {
    return shifts.filter(s =>
      s.shift_date === date && s.shift_name === patternName &&
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
  function getTotalForDate(date: string): { actual: number; required: number } {
    let actual = 0; let required = 0;
    for (const section of mainSections) {
      for (const pattern of targetPatterns.filter(p => p.section === section)) {
        actual   += getActual(section, pattern.name, date);
        required += getRequired(pattern, date);
      }
    }
    return { actual, required };
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
      reqMap.set(`${editing.section}::${editing.pattern}::${editing.date}`, val);
      setEditing(null);
    });
  }

  // セクション行を描画するヘルパー
  function renderSectionRows(section: string, topBorder = false) {
    const sectionPatterns = targetPatterns.filter(p => p.section === section);
    return sectionPatterns.map((pattern, pi) => (
      <tr key={`${section}-${pattern.name}`}
        className={[
          "border-b border-zinc-100 dark:border-zinc-800",
          topBorder && pi === 0 ? "border-t-2 border-t-zinc-300 dark:border-t-zinc-600" : "",
        ].join(" ")}>
        {pi === 0 && (
          <td rowSpan={sectionPatterns.length}
            className={[
              CELL_LABEL,
              EXCLUDE_FROM_TOTAL.includes(section)
                ? "text-zinc-400 dark:text-zinc-500 min-w-[90px]"
                : "text-zinc-700 dark:text-zinc-300 min-w-[90px]",
            ].join(" ")}>
            {section}
          </td>
        )}
        <td className={`${CELL_PATTERN} min-w-[68px]`}>{pattern.name}</td>
        {allDates.map(date => {
          const required = getRequired(pattern, date);
          const actual   = getActual(section, pattern.name, date);
          const diff     = required === 0 ? 0 : actual - required;
          const hasOverride = reqMap.has(`${section}::${pattern.name}::${date}`);
          const weekend = isWeekend(date, holidays);
          const isSel   = date === selectedDate;
          return (
            <td key={date}
              onClick={() => openEdit(section, pattern.name, date, required)}
              className={[
                CELL_DATA, "cursor-pointer transition-colors select-none hover:bg-zinc-100 dark:hover:bg-zinc-800 min-w-[36px]",
                isSel ? "bg-blue-50/60 dark:bg-blue-950/20" : weekend ? "bg-red-50/30 dark:bg-red-950/10" : "",
              ].join(" ")}>
              {required === 0 ? (
                <span className="text-zinc-300 dark:text-zinc-700 text-[10px]">—</span>
              ) : (
                <span className="inline-flex items-baseline gap-0.5">
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
                </span>
              )}
            </td>
          );
        })}
      </tr>
    ));
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-left"
      >
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">充足表</h2>
          {!collapsed && (
            <p className="text-[10px] text-zinc-400 mt-0.5">必要数セルをタップして日別上書き可</p>
          )}
        </div>
        <svg className={`w-4 h-4 text-zinc-400 transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-left font-semibold text-zinc-500 dark:text-zinc-400 border-b border-r border-zinc-200 dark:border-zinc-700 min-w-[90px]">
                  セクション
                </th>
                <th className="sticky left-[90px] z-10 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-left font-semibold text-zinc-500 dark:text-zinc-400 border-b border-r border-zinc-200 dark:border-zinc-700 min-w-[68px]">
                  パターン
                </th>
                {allDates.map(d => {
                  const weekend = isWeekend(d, holidays);
                  const isSel = d === selectedDate;
                  return (
                    <th key={d}
                      onClick={() => onDateSelect?.(d)}
                      className={[
                        "px-1 py-1 text-center font-semibold border-b border-zinc-200 dark:border-zinc-700 min-w-[34px]",
                        onDateSelect ? "cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700/60" : "",
                        isSel
                          ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                          : weekend
                            ? "text-red-500 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20"
                            : "text-zinc-500 dark:text-zinc-400",
                      ].join(" ")}>
                      <div className="tabular-nums text-[11px]">{dayLabel(d)}</div>
                      <div className="text-[9px] font-normal">{dayOfWeekLabel(d)}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* ── メインセクション（ローン・リメイク除く） ── */}
              {mainSections.map(section => renderSectionRows(section))}

              {/* ── 合計行 ── */}
              {mainSections.length > 0 && (
                <tr className="border-t-2 border-t-zinc-400 dark:border-t-zinc-500 border-b border-b-zinc-200 dark:border-b-zinc-600 bg-zinc-100 dark:bg-zinc-800">
                  <td className="sticky left-0 z-10 bg-zinc-100 dark:bg-zinc-800 px-2 py-0 h-[22px] font-bold text-zinc-800 dark:text-zinc-100 border-r border-zinc-200 dark:border-zinc-700 align-middle whitespace-nowrap min-w-[90px]">
                    合計
                  </td>
                  <td className="sticky left-[90px] z-10 bg-zinc-100 dark:bg-zinc-800 px-2 py-0 h-[22px] text-[9px] text-zinc-500 dark:text-zinc-400 border-r border-zinc-200 dark:border-zinc-700 align-middle whitespace-nowrap min-w-[68px]">
                    ローン/リメイク除く
                  </td>
                  {allDates.map(date => {
                    const { actual, required } = getTotalForDate(date);
                    const diff = required === 0 ? 0 : actual - required;
                    const weekend = isWeekend(date, holidays);
                    const isSel  = date === selectedDate;
                    return (
                      <td key={date}
                        className={[
                          CELL_DATA, "min-w-[34px]",
                          isSel ? "bg-blue-50/60 dark:bg-blue-950/20" : weekend ? "bg-red-50/30 dark:bg-red-950/10" : "",
                        ].join(" ")}>
                        {required === 0 ? (
                          <span className="text-zinc-300 dark:text-zinc-700 text-[10px]">—</span>
                        ) : (
                          <span className="inline-flex items-baseline gap-0.5">
                            <span className={[
                              "font-bold text-[11px]",
                              diff > 0 ? "text-emerald-600 dark:text-emerald-400"
                               : diff < 0 ? "text-red-500 dark:text-red-400"
                               : "text-zinc-500 dark:text-zinc-400",
                            ].join(" ")}>
                              {diff > 0 ? `+${diff}` : diff}
                            </span>
                            <span className="text-[9px] text-zinc-400 dark:text-zinc-500">
                              {actual}/{required}
                            </span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}

              {/* ── ローン・リメイク（最下部、区切り線付き） ── */}
              {bottomSections.map((section, si) => renderSectionRows(section, si === 0))}
            </tbody>
          </table>
        </div>
      )}

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
              <input type="number" min={0} value={editValue}
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
