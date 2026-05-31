"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateBreakSlotAssignmentAction,
  assignBreakSlotsAction,
  updateBreakShortSettingAction,
} from "@/app/(portal)/seating/break-actions";
import type { BreakSlotSetting, BreakSlotAssignment, BreakShortSetting, BreakRecord } from "@/app/(portal)/seating/break-actions";
import type { SectionGroup } from "./AttendanceClient";

const SLOT_PILL: Record<number, string> = {
  1: "bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300",
  2: "bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300",
  3: "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300",
};
const SLOT_CELL_BG: Record<number, string> = {
  1: "bg-blue-50/60 dark:bg-blue-950/20",
  2: "bg-amber-50/60 dark:bg-amber-950/20",
  3: "bg-emerald-50/60 dark:bg-emerald-950/20",
};

const BREAK_SECTIONS = ["査定", "販売"] as const;

interface BreakMemberInfo {
  staffId: string;
  name: string;
  accountNumber: string | null;
  section: string;
}

interface Props {
  projectId: string;
  today: string;
  breakSlots: BreakSlotSetting[];
  breakAssignments: BreakSlotAssignment[];
  breakShortSettings: BreakShortSetting[];
  breakRecords: BreakRecord[];
  grouped: SectionGroup[];
}

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export default function BreakManagementTab({
  projectId, today, breakSlots, breakAssignments,
  breakShortSettings, breakRecords, grouped,
}: Props) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<BreakSlotAssignment[]>(breakAssignments);
  const [shortSettings, setShortSettings] = useState<BreakShortSetting[]>(breakShortSettings);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  const memberInfoMap = new Map<string, BreakMemberInfo>();
  for (const sec of grouped) {
    for (const sg of sec.shiftGroups) {
      for (const m of sg.members) {
        memberInfoMap.set(m.staffId, {
          staffId: m.staffId, name: m.name,
          accountNumber: m.accountNumber, section: sec.section,
        });
      }
    }
  }

  const breakRecordsByStaff = new Map<string, BreakRecord[]>();
  for (const r of breakRecords) {
    if (!breakRecordsByStaff.has(r.staff_id)) breakRecordsByStaff.set(r.staff_id, []);
    breakRecordsByStaff.get(r.staff_id)!.push(r);
  }

  function getSlotNumber(staffId: string): number | null {
    return assignments.find(a => a.staff_id === staffId)?.slot_number ?? null;
  }
  function getShortMinutes(staffId: string): number {
    return shortSettings.find(s => s.staff_id === staffId)?.short_break_minutes ?? 15;
  }

  function handleSlotChange(staffId: string, newSlot: number) {
    startTransition(async () => {
      const res = await updateBreakSlotAssignmentAction(projectId, today, staffId, newSlot);
      if (res.success) {
        setAssignments(prev => [...prev.filter(a => a.staff_id !== staffId), { staff_id: staffId, slot_number: newSlot }]);
      }
    });
  }
  function handleShortMinutesChange(staffId: string, minutes: number) {
    startTransition(async () => {
      const res = await updateBreakShortSettingAction(projectId, today, staffId, minutes);
      if (res.success) {
        setShortSettings(prev => [...prev.filter(s => s.staff_id !== staffId), { staff_id: staffId, short_break_minutes: minutes }]);
      }
    });
  }
  function handleReassign() {
    if (!window.confirm("今日の休憩スロットを再割り振りしますか？手動変更した内容はリセットされます。")) return;
    startTransition(async () => {
      const res = await assignBreakSlotsAction(projectId, today);
      if (res.success) { showToast(`再割り振り完了（${res.count}名）`); router.refresh(); }
      else showToast(`⚠️ ${res.error ?? "再割り振りに失敗しました"}`);
    });
  }
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  if (breakSlots.length === 0) {
    return <p className="text-sm text-zinc-400 py-6 text-center">休憩スロットが設定されていません</p>;
  }

  const totalAssigned = assignments.filter(a => {
    const info = memberInfoMap.get(a.staff_id);
    return info && BREAK_SECTIONS.includes(info.section as (typeof BREAK_SECTIONS)[number]);
  }).length;

  // スロット × セクション → メンバー
  const slotSectionMap = new Map<number, Map<string, BreakMemberInfo[]>>();
  for (const slot of breakSlots) {
    const secMap = new Map<string, BreakMemberInfo[]>();
    for (const sec of BREAK_SECTIONS) secMap.set(sec, []);
    slotSectionMap.set(slot.slot_number, secMap);
  }
  for (const a of assignments) {
    const info = memberInfoMap.get(a.staff_id);
    if (!info || !BREAK_SECTIONS.includes(info.section as (typeof BREAK_SECTIONS)[number])) continue;
    slotSectionMap.get(a.slot_number)?.get(info.section)?.push(info);
  }

  const sectionTotals: Record<string, number> = {};
  for (const sec of BREAK_SECTIONS) {
    sectionTotals[sec] = [...slotSectionMap.values()].reduce((sum, m) => sum + (m.get(sec)?.length ?? 0), 0);
  }

  // select共通スタイル
  const selectCls = "text-[11px] px-1.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 disabled:opacity-40 w-full focus:outline-none focus:ring-1 focus:ring-blue-400";

  return (
    <div className="space-y-4">
      {/* ページヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">休憩管理簿</p>
          <p className="text-xs text-zinc-400">{totalAssigned}名に割り振り済み</p>
        </div>
        <button
          onClick={handleReassign} disabled={isPending}
          className="text-xs font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 px-3 py-1.5 rounded-xl border border-violet-200 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-950/50 transition-colors disabled:opacity-50"
        >
          {isPending ? "処理中…" : "🔄 再割り振り"}
        </button>
      </div>

      {totalAssigned === 0 && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 py-10 text-center">
          <p className="text-sm text-zinc-400">まだ割り振りが行われていません</p>
          <p className="text-xs text-zinc-400 mt-1">座席配置を保存すると自動で割り振られます</p>
        </div>
      )}

      {totalAssigned > 0 && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">

          {/* 固定カラムヘッダー */}
          <div
            className="grid sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b-2 border-zinc-200 dark:border-zinc-700"
            style={{ gridTemplateColumns: "80px 1fr 1fr" }}
          >
            <div className="px-3 py-3" />
            {BREAK_SECTIONS.map((sec, i) => (
              <div key={sec} className={`px-4 py-3 ${i === 0 ? "border-l border-zinc-200 dark:border-zinc-700" : "border-l border-zinc-200 dark:border-zinc-700"}`}>
                <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">{sec}</span>
                <span className="ml-2 text-[11px] text-zinc-400 tabular-nums">{sectionTotals[sec]}名</span>
              </div>
            ))}
          </div>

          {/* スロット行 */}
          {breakSlots.map((slot, idx) => {
            const secMap = slotSectionMap.get(slot.slot_number)!;
            const isLast = idx === breakSlots.length - 1;

            return (
              <div
                key={slot.slot_number}
                className={`grid items-start ${!isLast ? "border-b border-zinc-100 dark:border-zinc-800" : ""}`}
                style={{ gridTemplateColumns: "80px 1fr 1fr" }}
              >
                {/* スロット情報 */}
                <div className={`flex flex-col items-center justify-center gap-0.5 px-2 py-4 self-stretch ${SLOT_CELL_BG[slot.slot_number] ?? ""}`}>
                  <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${SLOT_PILL[slot.slot_number] ?? ""}`}>
                    {slot.label}
                  </span>
                  <span className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-300 tabular-nums mt-1">
                    {slot.start_time.slice(0, 5)}
                  </span>
                  <span className="text-[9px] text-zinc-400 tabular-nums">
                    〜{slot.end_time.slice(0, 5)}
                  </span>
                </div>

                {/* セクション列 */}
                {BREAK_SECTIONS.map(sec => {
                  const members = secMap.get(sec) ?? [];
                  return (
                    <div key={sec} className="border-l border-zinc-100 dark:border-zinc-800 divide-y divide-zinc-50 dark:divide-zinc-800/50">
                      {members.length === 0 ? (
                        <div className="flex items-center justify-center py-6">
                          <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
                        </div>
                      ) : members.map(m => {
                        const shortMin = getShortMinutes(m.staffId);
                        const records = breakRecordsByStaff.get(m.staffId) ?? [];
                        return (
                          <div key={m.staffId} className="px-3 py-2.5 space-y-1.5">
                            {/* 名前 */}
                            <div className="flex items-baseline gap-1.5 min-w-0">
                              <span className="text-[10px] font-mono text-zinc-400 tabular-nums shrink-0">
                                {m.accountNumber ?? "—"}
                              </span>
                              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200 truncate">
                                {m.name}
                              </span>
                            </div>
                            {/* コントロール行 */}
                            <div className="flex gap-1.5">
                              <select
                                value={getSlotNumber(m.staffId) ?? slot.slot_number}
                                onChange={e => handleSlotChange(m.staffId, parseInt(e.target.value))}
                                disabled={isPending}
                                className={selectCls + " flex-[3]"}
                              >
                                {breakSlots.map(s => (
                                  <option key={s.slot_number} value={s.slot_number}>
                                    {s.label} {s.start_time.slice(0, 5)}〜{s.end_time.slice(0, 5)}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={shortMin}
                                onChange={e => handleShortMinutesChange(m.staffId, parseInt(e.target.value))}
                                disabled={isPending}
                                className={selectCls + " flex-[2]"}
                              >
                                <option value={15}>小休憩15分</option>
                                <option value={30}>小休憩30分</option>
                              </select>
                            </div>
                            {/* 実績 */}
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                              {records.length === 0 ? (
                                <span className="text-[10px] text-zinc-300 dark:text-zinc-600">実績なし</span>
                              ) : records.map((r, i) => (
                                <span key={i} className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                                  {r.break_type ? <span className="text-zinc-500 dark:text-zinc-400">[{r.break_type}]</span> : null}
                                  {r.break_type ? " " : ""}{fmtTime(r.started_at)}〜{r.ended_at ? fmtTime(r.ended_at) : "…"}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
