"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSeatAssignmentsAction, autoAssignSeatsAction } from "../actions";

export type PlanSeat = {
  id: string;
  label: string;
  xPct: number;
  yPct: number;
  section: string | null;
  staffId: string | null;
};

export type PlanStaff = {
  id: string;
  name: string;
  accountNumber: string | null;
  section: string | null;
};

export default function SeatingPlanClient({
  projectId, date, seats: initialSeats, staff,
}: {
  projectId: string;
  date: string;
  seats: PlanSeat[];
  staff: PlanStaff[];
}) {
  const [seats, setSeats] = useState<PlanSeat[]>(initialSeats);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const router = useRouter();

  const staffMap = new Map(staff.map(s => [s.id, s]));
  const assignedIds = new Set(seats.map(s => s.staffId).filter(Boolean) as string[]);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  }

  // 席をクリック
  function handleSeatClick(seat: PlanSeat) {
    if (selectedStaffId) {
      // 選択中スタッフを割当
      // 他席への重複割当を解除
      setSeats(prev => prev.map(s => {
        if (s.id === seat.id) return { ...s, staffId: selectedStaffId };
        if (s.staffId === selectedStaffId) return { ...s, staffId: null };
        return s;
      }));
      setSelectedStaffId(null);
    } else if (seat.staffId) {
      // 割当解除
      setSeats(prev => prev.map(s => s.id === seat.id ? { ...s, staffId: null } : s));
    }
  }

  // スタッフをクリック
  function handleStaffClick(id: string) {
    setSelectedStaffId(prev => prev === id ? null : id);
  }

  // 自動配置
  function handleAutoAssign() {
    startTransition(async () => {
      const res = await autoAssignSeatsAction(projectId, date);
      if (res.success && res.assignments) {
        const map = new Map(res.assignments.map(a => [a.seatId, a.staffId]));
        setSeats(prev => prev.map(s => ({
          ...s,
          staffId: map.get(s.id) ?? null,
        })));
        showToast(`自動配置完了（${res.assignments.length}名）`);
      } else {
        showToast(res.message ?? "自動配置に失敗しました", false);
      }
    });
  }

  // 全クリア
  function handleClear() {
    setSeats(prev => prev.map(s => ({ ...s, staffId: null })));
    setSelectedStaffId(null);
  }

  // 保存
  function handleSave() {
    const assignments = seats
      .filter(s => s.staffId)
      .map(s => ({ seatId: s.id, staffId: s.staffId! }));
    startTransition(async () => {
      const res = await saveSeatAssignmentsAction(projectId, date, assignments);
      if (res.success) {
        showToast("保存しました");
        router.refresh();
      } else {
        showToast(res.message ?? "保存に失敗しました", false);
      }
    });
  }

  const [, m, d] = date.split("-");
  const dateLabel = `${parseInt(m)}/${parseInt(d)}（翌日）`;

  const unassignedStaff = staff.filter(s => !assignedIds.has(s.id));
  const assignedStaff   = staff.filter(s => assignedIds.has(s.id));

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-40">
      {/* ヘッダー */}
      <div className="sticky top-0 z-20 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800 px-4 py-3 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-bold text-zinc-800 dark:text-zinc-100">翌日座席配置</h1>
          <p className="text-xs text-zinc-400 tabular-nums">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            disabled={isPending}
            className="text-xs text-zinc-500 dark:text-zinc-400 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            クリア
          </button>
          <button
            onClick={handleAutoAssign}
            disabled={isPending}
            className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition-colors disabled:opacity-50"
          >
            自動配置
          </button>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
          >
            {isPending ? "保存中…" : "保存"}
          </button>
        </div>
      </div>

      {/* 操作ガイド */}
      {selectedStaffId ? (
        <div className="mx-3 mt-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800">
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">
            {staffMap.get(selectedStaffId)?.name} を選択中 — 席をタップして配置
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-zinc-400 px-4 pt-2">
          スタッフを選択 → 席をタップで配置 ／ 席を直接タップで解除
        </p>
      )}

      {/* キャンバス */}
      <div className="px-3 mt-2">
        <div
          className="relative w-full bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
          style={{ aspectRatio: "4/3", minHeight: 280 }}
        >
          {seats.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-zinc-400">座席が設定されていません</p>
            </div>
          )}
          {seats.map(seat => {
            const s = seat.staffId ? staffMap.get(seat.staffId) : null;
            const isTarget = selectedStaffId !== null && !seat.staffId;

            return (
              <button
                key={seat.id}
                onClick={() => handleSeatClick(seat)}
                style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
                className={[
                  "absolute flex flex-col items-center justify-center gap-px",
                  "w-[70px] h-[58px] rounded-xl border-2 text-center transition-all shadow-sm select-none overflow-hidden",
                  s
                    ? "bg-blue-100 dark:bg-blue-900/50 border-blue-400 dark:border-blue-600 cursor-pointer active:scale-95"
                    : isTarget
                    ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400 border-dashed cursor-pointer animate-pulse"
                    : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-600 cursor-pointer",
                ].join(" ")}
              >
                <span className="text-[9px] text-zinc-400 leading-none">{seat.label}</span>
                {s ? (
                  <>
                    <span className="text-[10px] font-mono text-zinc-400 tabular-nums leading-none">{s.accountNumber ?? ""}</span>
                    <span className="text-[11px] font-bold text-blue-800 dark:text-blue-200 leading-tight px-0.5 w-full truncate text-center">
                      {s.name}
                    </span>
                    {s.section && (
                      <span className="text-[9px] text-blue-600 dark:text-blue-400 leading-none">{s.section}</span>
                    )}
                  </>
                ) : (
                  <span className="text-[10px] text-zinc-300 dark:text-zinc-600 mt-0.5">
                    {isTarget ? "ここへ" : "空席"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* スタッフパネル */}
      <div className="px-3 mt-3 space-y-2">
        {/* 未配置 */}
        <div>
          <p className="text-xs font-semibold text-zinc-400 mb-1.5 px-1">
            未配置 <span className="text-zinc-300 font-normal tabular-nums">({unassignedStaff.length}名)</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unassignedStaff.map(s => (
              <button
                key={s.id}
                onClick={() => handleStaffClick(s.id)}
                className={[
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors",
                  selectedStaffId === s.id
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700 hover:border-blue-400",
                ].join(" ")}
              >
                {s.accountNumber && (
                  <span className="font-mono text-[10px] opacity-60">{s.accountNumber}</span>
                )}
                {s.name}
                {s.section && (
                  <span className="text-[10px] opacity-60">{s.section}</span>
                )}
              </button>
            ))}
            {unassignedStaff.length === 0 && (
              <p className="text-xs text-zinc-400 py-1">全員配置済み</p>
            )}
          </div>
        </div>

        {/* 配置済み */}
        {assignedStaff.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-zinc-300 dark:text-zinc-600 mb-1.5 px-1">
              配置済み <span className="tabular-nums">({assignedStaff.length}名)</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {assignedStaff.map(s => (
                <button
                  key={s.id}
                  onClick={() => handleStaffClick(s.id)}
                  className={[
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors",
                    selectedStaffId === s.id
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:border-blue-400",
                  ].join(" ")}
                >
                  {s.accountNumber && (
                    <span className="font-mono text-[10px] opacity-60">{s.accountNumber}</span>
                  )}
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* トースト */}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg whitespace-nowrap ${
          toast.ok
            ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900"
            : "bg-red-600 text-white"
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
