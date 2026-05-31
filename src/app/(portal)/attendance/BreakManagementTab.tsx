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

const SLOT_BG: Record<number, string> = {
  1: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700",
  2: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700",
  3: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700",
};

const TARGET_SHIFT_LABEL: Record<string, string> = {
  early: "早番のみ",
  late:  "遅番のみ",
  both:  "早番・遅番",
};

const BREAK_SECTIONS = ["査定", "販売"] as const;

interface BreakMemberInfo {
  staffId: string;
  name: string;
  accountNumber: string | null;
  shiftName: string;
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

  // メンバー情報マップ
  const memberInfoMap = new Map<string, BreakMemberInfo>();
  for (const sec of grouped) {
    for (const sg of sec.shiftGroups) {
      for (const m of sg.members) {
        memberInfoMap.set(m.staffId, {
          staffId:       m.staffId,
          name:          m.name,
          accountNumber: m.accountNumber,
          shiftName:     sg.shiftName,
          section:       sec.section,
        });
      }
    }
  }

  // 休憩実績マップ（staffId → records）
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
        setAssignments(prev => [
          ...prev.filter(a => a.staff_id !== staffId),
          { staff_id: staffId, slot_number: newSlot },
        ]);
      }
    });
  }

  function handleShortMinutesToggle(staffId: string, current: number) {
    const next = current === 15 ? 30 : 15;
    startTransition(async () => {
      const res = await updateBreakShortSettingAction(projectId, today, staffId, next);
      if (res.success) {
        setShortSettings(prev => [
          ...prev.filter(s => s.staff_id !== staffId),
          { staff_id: staffId, short_break_minutes: next },
        ]);
      }
    });
  }

  function handleReassign() {
    if (!window.confirm("今日の休憩スロットを再割り振りしますか？手動変更した内容はリセットされます。")) return;
    startTransition(async () => {
      const res = await assignBreakSlotsAction(projectId, today);
      if (res.success) {
        showToast(`再割り振り完了（${res.count}名）`);
        router.refresh();
      } else {
        showToast(`⚠️ ${res.error ?? "再割り振りに失敗しました"}`);
      }
    });
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  if (breakSlots.length === 0) {
    return <p className="text-sm text-zinc-400 py-6 text-center">休憩スロットが設定されていません</p>;
  }

  // セクション × スロットごとのメンバーリスト
  const totalAssigned = assignments.filter(a => {
    const info = memberInfoMap.get(a.staff_id);
    return info && BREAK_SECTIONS.includes(info.section as (typeof BREAK_SECTIONS)[number]);
  }).length;

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">休憩管理簿</p>
          <p className="text-xs text-zinc-400">{totalAssigned}名に割り振り済み</p>
        </div>
        <button
          onClick={handleReassign}
          disabled={isPending}
          className="text-xs font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 px-3 py-1.5 rounded-xl border border-violet-200 dark:border-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50"
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

      {totalAssigned > 0 && BREAK_SECTIONS.map(section => {
        // このセクションのメンバー（スロット割り当て済み）
        const sectionMembers = assignments
          .filter(a => memberInfoMap.get(a.staff_id)?.section === section)
          .map(a => ({ ...memberInfoMap.get(a.staff_id)!, slotNumber: a.slot_number }))
          .filter(m => !!m.staffId);

        if (sectionMembers.length === 0) return null;

        return (
          <div key={section} className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            {/* セクションヘッダー */}
            <div className="px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700">
              <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">{section}</span>
              <span className="ml-2 text-[11px] text-zinc-400 tabular-nums">{sectionMembers.length}名</span>
            </div>

            {/* スロット別グループ */}
            {breakSlots.map((slot, slotIdx) => {
              const slotMembers = sectionMembers.filter(m => m.slotNumber === slot.slot_number);
              if (slotMembers.length === 0) return null;
              const isLast = slotIdx === breakSlots.length - 1;

              return (
                <div key={slot.slot_number} className={!isLast ? "border-b border-zinc-100 dark:border-zinc-800" : ""}>
                  {/* スロット行ヘッダー */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50/60 dark:bg-zinc-900/40">
                    <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[11px] font-bold shrink-0 ${SLOT_BG[slot.slot_number] ?? ""}`}>
                      {slot.label}
                    </span>
                    <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 tabular-nums">
                      {slot.start_time.slice(0, 5)}〜{slot.end_time.slice(0, 5)}
                    </span>
                    <span className="text-[10px] text-zinc-400">{TARGET_SHIFT_LABEL[slot.target_shift] ?? slot.target_shift}</span>
                    <span className="ml-auto text-[11px] text-zinc-400 tabular-nums">{slotMembers.length}名</span>
                  </div>

                  {/* メンバー行 */}
                  <div className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
                    {slotMembers.map(m => {
                      const shortMin = getShortMinutes(m.staffId);
                      const records = breakRecordsByStaff.get(m.staffId) ?? [];

                      return (
                        <div key={m.staffId} className="px-3 py-2.5 space-y-1.5">
                          {/* メンバー情報行 */}
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] font-mono text-zinc-400 tabular-nums shrink-0 w-10 truncate">
                              {m.accountNumber ?? "—"}
                            </span>
                            <span className="text-xs text-zinc-700 dark:text-zinc-200 flex-1 min-w-0 truncate">
                              {m.name}
                            </span>
                            {/* スロット変更 */}
                            <select
                              value={getSlotNumber(m.staffId) ?? slot.slot_number}
                              onChange={e => handleSlotChange(m.staffId, parseInt(e.target.value))}
                              disabled={isPending}
                              className="text-[10px] px-1 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 disabled:opacity-50 shrink-0"
                            >
                              {breakSlots.map(s => (
                                <option key={s.slot_number} value={s.slot_number}>{s.label}</option>
                              ))}
                            </select>
                            {/* 小休憩トグル */}
                            <button
                              onClick={() => handleShortMinutesToggle(m.staffId, shortMin)}
                              disabled={isPending}
                              className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${
                                shortMin === 30
                                  ? "bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-600"
                                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700"
                              }`}
                              title="小休憩時間をタップで切り替え（15分 / 30分）"
                            >
                              小{shortMin}
                            </button>
                          </div>

                          {/* 実績 */}
                          {records.length > 0 && (
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-12">
                              {records.map((r, i) => (
                                <span key={i} className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                                  {r.break_type ? `[${r.break_type}] ` : ""}{fmtTime(r.started_at)}〜{r.ended_at ? fmtTime(r.ended_at) : "…"}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* トースト */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
