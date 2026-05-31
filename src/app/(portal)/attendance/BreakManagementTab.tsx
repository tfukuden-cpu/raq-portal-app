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

const SLOT_THEME: Record<number, {
  badge: string; slotCol: string; cardBorder: string; cardBg: string; dot: string;
}> = {
  1: {
    badge:      "bg-blue-500 text-white",
    slotCol:    "bg-blue-50 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900",
    cardBorder: "border-blue-200 dark:border-blue-800",
    cardBg:     "bg-blue-50/60 dark:bg-blue-950/20",
    dot:        "bg-blue-400",
  },
  2: {
    badge:      "bg-amber-500 text-white",
    slotCol:    "bg-amber-50 dark:bg-amber-950/30 border-amber-100 dark:border-amber-900",
    cardBorder: "border-amber-200 dark:border-amber-800",
    cardBg:     "bg-amber-50/60 dark:bg-amber-950/20",
    dot:        "bg-amber-400",
  },
  3: {
    badge:      "bg-emerald-500 text-white",
    slotCol:    "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-900",
    cardBorder: "border-emerald-200 dark:border-emerald-800",
    cardBg:     "bg-emerald-50/60 dark:bg-emerald-950/20",
    dot:        "bg-emerald-400",
  },
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
      if (res.success)
        setAssignments(prev => [...prev.filter(a => a.staff_id !== staffId), { staff_id: staffId, slot_number: newSlot }]);
    });
  }
  function handleShortMinutesChange(staffId: string, minutes: number) {
    startTransition(async () => {
      const res = await updateBreakShortSettingAction(projectId, today, staffId, minutes);
      if (res.success)
        setShortSettings(prev => [...prev.filter(s => s.staff_id !== staffId), { staff_id: staffId, short_break_minutes: minutes }]);
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

  if (breakSlots.length === 0)
    return <p className="text-sm text-zinc-400 py-6 text-center">休憩スロットが設定されていません</p>;

  const totalAssigned = assignments.filter(a => {
    const info = memberInfoMap.get(a.staff_id);
    return info && BREAK_SECTIONS.includes(info.section as (typeof BREAK_SECTIONS)[number]);
  }).length;

  const slotSectionMap = new Map<number, Map<string, BreakMemberInfo[]>>();
  for (const slot of breakSlots) {
    const m = new Map<string, BreakMemberInfo[]>();
    for (const sec of BREAK_SECTIONS) m.set(sec, []);
    slotSectionMap.set(slot.slot_number, m);
  }
  for (const a of assignments) {
    const info = memberInfoMap.get(a.staff_id);
    if (!info || !BREAK_SECTIONS.includes(info.section as (typeof BREAK_SECTIONS)[number])) continue;
    slotSectionMap.get(a.slot_number)?.get(info.section)?.push(info);
  }

  const sectionTotals: Record<string, number> = {};
  for (const sec of BREAK_SECTIONS)
    sectionTotals[sec] = [...slotSectionMap.values()].reduce((sum, m) => sum + (m.get(sec)?.length ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* ページヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">休憩管理簿</p>
          <p className="text-xs text-zinc-400 mt-0.5">{totalAssigned}名に割り振り済み</p>
        </div>
        <button
          onClick={handleReassign} disabled={isPending}
          className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 px-3 py-1.5 rounded-xl border border-violet-200 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors disabled:opacity-50"
        >
          {isPending ? "処理中…" : "🔄 再割り振り"}
        </button>
      </div>

      {totalAssigned === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 py-12 text-center">
          <p className="text-sm text-zinc-500">まだ割り振りが行われていません</p>
          <p className="text-xs text-zinc-400 mt-1">座席配置を保存すると自動で割り振られます</p>
        </div>
      )}

      {totalAssigned > 0 && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 shadow-sm overflow-hidden">

          {/* カラムヘッダー（固定） */}
          <div
            className="grid sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700"
            style={{ gridTemplateColumns: "72px 1fr 1fr" }}
          >
            <div className="px-3 py-3" />
            {BREAK_SECTIONS.map(sec => (
              <div key={sec} className="px-4 py-3 border-l border-zinc-200 dark:border-zinc-700 flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200">{sec}</span>
                <span className="text-[11px] text-zinc-400 tabular-nums bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-full">{sectionTotals[sec]}名</span>
              </div>
            ))}
          </div>

          {/* スロット行 */}
          {breakSlots.map((slot, idx) => {
            const theme = SLOT_THEME[slot.slot_number] ?? SLOT_THEME[1];
            const secMap = slotSectionMap.get(slot.slot_number)!;
            const isLast = idx === breakSlots.length - 1;

            return (
              <div
                key={slot.slot_number}
                className={`grid items-stretch ${!isLast ? "border-b border-zinc-100 dark:border-zinc-800" : ""}`}
                style={{ gridTemplateColumns: "72px 1fr 1fr" }}
              >
                {/* スロット情報列 */}
                <div className={`flex flex-col items-center justify-start gap-1 pt-4 pb-4 px-2 border-r ${theme.slotCol}`}>
                  <span className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold shadow-sm ${theme.badge}`}>
                    {slot.label}
                  </span>
                  <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 tabular-nums">
                    {slot.start_time.slice(0, 5)}
                  </span>
                  <span className="text-[10px] text-zinc-400 tabular-nums">
                    〜{slot.end_time.slice(0, 5)}
                  </span>
                </div>

                {/* セクション列 */}
                {BREAK_SECTIONS.map(sec => {
                  const members = secMap.get(sec) ?? [];
                  return (
                    <div key={sec} className="p-3 border-l border-zinc-100 dark:border-zinc-800 space-y-2">
                      {members.length === 0 ? (
                        <div className="flex items-center justify-center h-12 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-dashed border-zinc-200 dark:border-zinc-700">
                          <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>
                        </div>
                      ) : members.map(m => {
                        const shortMin = getShortMinutes(m.staffId);
                        const records = breakRecordsByStaff.get(m.staffId) ?? [];
                        return (
                          <div
                            key={m.staffId}
                            className={`rounded-xl border p-3 space-y-2 ${theme.cardBorder} ${theme.cardBg}`}
                          >
                            {/* 名前行 */}
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${theme.dot}`} />
                              <span className="text-[10px] font-mono text-zinc-400 tabular-nums shrink-0">
                                {m.accountNumber ?? "—"}
                              </span>
                              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 truncate">
                                {m.name}
                              </span>
                            </div>

                            {/* プルダウン2つ */}
                            <div className="flex gap-1.5">
                              <select
                                value={getSlotNumber(m.staffId) ?? slot.slot_number}
                                onChange={e => handleSlotChange(m.staffId, parseInt(e.target.value))}
                                disabled={isPending}
                                className="flex-[3] text-[11px] px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-600"
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
                                className="flex-[2] text-[11px] px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-600"
                              >
                                <option value={15}>小休憩15分</option>
                                <option value={30}>小休憩30分</option>
                              </select>
                            </div>

                            {/* 実績 */}
                            {records.length === 0 ? (
                              <p className="text-[10px] text-zinc-400 dark:text-zinc-500">実績なし</p>
                            ) : (
                              <div className="space-y-0.5">
                                {records.map((r, i) => (
                                  <p key={i} className="text-[10px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                                    {r.break_type && <span className="font-medium">[{r.break_type}]</span>}
                                    {r.break_type ? " " : ""}{fmtTime(r.started_at)}〜{r.ended_at ? fmtTime(r.ended_at) : "…"}
                                  </p>
                                ))}
                              </div>
                            )}
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
