"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { saveSeatAssignmentsAction, autoAssignSeatsAction } from "../actions";
import BreakSlotDayEditor from "../BreakSlotDayEditor";
import { getSeatBgClass, getSeatBorderClass, getSeatTextClass, formatSectionShift, resolveShiftSection } from "@/lib/seatColors";

export type WallData = {
  x1Pct: number;
  y1Pct: number;
  x2Pct: number;
  y2Pct: number;
};

export type PlanSeat = {
  id: string;
  label: string;
  xPct: number;
  yPct: number;
  section: string | null;
  seatType: "normal" | "free" | "disabled";
  shiftSlot: string | null;  // 席のシフト帯設定
  staffId: string | null;
};

export type PlanStaff = {
  id: string;
  name: string;
  accountNumber: string | null;
  section: string | null;
  shiftName: string | null;  // 早番/遅番判定用
};

export default function SeatingPlanClient({
  projectId, date, today, seats: initialSeats, staff, walls = [], embedded = false,
}: {
  projectId: string;
  date: string;
  today?: string;
  seats: PlanSeat[];
  staff: PlanStaff[];
  walls?: WallData[];
  embedded?: boolean;
}) {
  const [seats, setSeats] = useState<PlanSeat[]>(initialSeats);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [dragSeatId,   setDragSeatId]   = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [showBreakEditor, setShowBreakEditor] = useState(false);
  const router   = useRouter();
  const pathname = usePathname();

  const staffMap = new Map(staff.map(s => [s.id, s]));
  const assignedIds = new Set(seats.map(s => s.staffId).filter(Boolean) as string[]);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  }

  // ── ドラッグ&ドロップ（席同士の入れ替え） ─────────────
  function handleDragStart(e: React.DragEvent, seatId: string) {
    setDragSeatId(seatId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, seatId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragSeatId && dragSeatId !== seatId) setDropTargetId(seatId);
  }

  function handleDragLeave() {
    setDropTargetId(null);
  }

  function handleDrop(e: React.DragEvent, targetSeatId: string) {
    e.preventDefault();
    if (!dragSeatId || dragSeatId === targetSeatId) {
      setDragSeatId(null);
      setDropTargetId(null);
      return;
    }
    setSeats(prev => {
      const dragStaffId   = prev.find(s => s.id === dragSeatId)?.staffId   ?? null;
      const targetStaffId = prev.find(s => s.id === targetSeatId)?.staffId ?? null;
      return prev.map(s => {
        if (s.id === dragSeatId)   return { ...s, staffId: targetStaffId };
        if (s.id === targetSeatId) return { ...s, staffId: dragStaffId };
        return s;
      });
    });
    setDragSeatId(null);
    setDropTargetId(null);
  }

  function handleDragEnd() {
    setDragSeatId(null);
    setDropTargetId(null);
  }

  // ── クリック操作 ──────────────────────────────────────
  function handleSeatClick(seat: PlanSeat) {
    // ドラッグ操作後は click が発火するので無視
    if (dragSeatId !== null) return;

    if (selectedStaffId) {
      setSeats(prev => prev.map(s => {
        if (s.id === seat.id) return { ...s, staffId: selectedStaffId };
        if (s.staffId === selectedStaffId) return { ...s, staffId: null };
        return s;
      }));
      setSelectedStaffId(null);
    } else if (seat.staffId) {
      setSeats(prev => prev.map(s => s.id === seat.id ? { ...s, staffId: null } : s));
    }
  }

  function handleStaffClick(id: string) {
    setSelectedStaffId(prev => prev === id ? null : id);
  }

  // ── 自動配置（現在の配置を保持して空席のみ埋める） ────
  function handleAutoAssign() {
    const existing = seats
      .filter(s => s.staffId)
      .map(s => ({ seatId: s.id, staffId: s.staffId! }));

    startTransition(async () => {
      const res = await autoAssignSeatsAction(projectId, date, existing);
      if (res.success && res.assignments) {
        const map = new Map(res.assignments.map(a => [a.seatId, a.staffId]));
        setSeats(prev => prev.map(s => ({ ...s, staffId: map.get(s.id) ?? null })));
        const added = res.assignments.length - existing.length;
        showToast(`自動配置完了（+${added}名追加）`);
      } else {
        showToast(res.message ?? "自動配置に失敗しました", false);
      }
    });
  }

  function handleClear() {
    setSeats(prev => prev.map(s => ({ ...s, staffId: null })));
    setSelectedStaffId(null);
  }

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

  const handleDateChange = (newDate: string) => {
    router.push(`${pathname}?date=${newDate}`);
  };

  const unassignedStaff = staff.filter(s => !assignedIds.has(s.id));
  const assignedStaff   = staff.filter(s => assignedIds.has(s.id));

  const actionButtons = (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => setShowBreakEditor(true)}
        className="text-xs font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 px-2.5 py-1.5 rounded-lg border border-violet-200 dark:border-violet-800 hover:bg-violet-100 transition-colors"
      >
        休憩設定
      </button>
      <button
        onClick={handleClear}
        disabled={isPending}
        className="text-xs text-zinc-500 dark:text-zinc-400 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
      >
        クリア
      </button>
      <button
        onClick={handleAutoAssign}
        disabled={isPending}
        className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition-colors disabled:opacity-50"
      >
        自動配置
      </button>
      <button
        onClick={handleSave}
        disabled={isPending}
        className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-2.5 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
      >
        {isPending ? "保存中…" : "保存"}
      </button>
    </div>
  );

  return (
    <div className={embedded ? "" : "min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-40"}>
      {/* 日付別 休憩スロット設定モーダル */}
      {showBreakEditor && (
        <BreakSlotDayEditor
          projectId={projectId}
          date={date}
          onClose={() => setShowBreakEditor(false)}
          onSaved={m => { setToast({ msg: m, ok: true }); setTimeout(() => setToast(null), 3000); }}
        />
      )}

      {/* ヘッダー（スタンドアロン時のみ） */}
      {!embedded && (
        <div className="sticky top-0 z-20 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800 px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold text-zinc-800 dark:text-zinc-100">座席配置編集</h1>
            <input
              type="date"
              value={date}
              onChange={e => handleDateChange(e.target.value)}
              className="text-xs tabular-nums px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
            />
          </div>
          {actionButtons}
        </div>
      )}

      {/* 埋め込み時のコンパクトツールバー */}
      {embedded && (
        <div className="flex items-center justify-between gap-2 pt-1 pb-2">
          <input
            type="date"
            value={date}
            onChange={e => handleDateChange(e.target.value)}
            className="text-xs tabular-nums px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
          />
          {actionButtons}
        </div>
      )}

      {/* 操作ガイド */}
      {selectedStaffId ? (
        <div className={`mt-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800 ${embedded ? "" : "mx-3"}`}>
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">
            {staffMap.get(selectedStaffId)?.name} を選択中 — 席をタップして配置
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-zinc-400 pt-1">
          スタッフを選択 → 席をタップで配置 ／ 席カードをドラッグで入れ替え ／ 席を直接タップで解除
        </p>
      )}

      {/* キャンバス */}
      <div className="overflow-x-auto px-3 mt-2">
        <div
          className="relative bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
          style={{ width: "max(100%, 1800px)", aspectRatio: "3/2" }}
        >
          {seats.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-zinc-400">座席が設定されていません</p>
            </div>
          )}

          {/* 壁 */}
          {walls.length > 0 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {walls.map((w, i) => (
                <line
                  key={i}
                  x1={`${w.x1Pct}%`} y1={`${w.y1Pct}%`}
                  x2={`${w.x2Pct}%`} y2={`${w.y2Pct}%`}
                  stroke="#71717a"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ))}
            </svg>
          )}

          {seats.map(seat => {
            const isDisabled = seat.seatType === "disabled";
            const isFree     = seat.seatType === "free";
            const s = seat.staffId ? staffMap.get(seat.staffId) : null;
            const isTarget    = !isDisabled && selectedStaffId !== null && !seat.staffId;
            const isDragging  = dragSeatId === seat.id;
            const isDropOver  = dropTargetId === seat.id && dragSeatId !== null;

            if (isDisabled) {
              return (
                <div
                  key={seat.id}
                  style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
                  className="absolute w-[70px] h-[58px] rounded-xl border-2 border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800 opacity-40 flex flex-col items-center justify-center overflow-hidden"
                >
                  <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
                    <defs>
                      <pattern id={`hatch-p-${seat.id}`} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="8" stroke="#a1a1aa" strokeWidth="1.5" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill={`url(#hatch-p-${seat.id})`} />
                  </svg>
                  <span className="relative text-[9px] text-zinc-400 leading-none z-10">無効</span>
                </div>
              );
            }

            // セクション色の計算
            // シフト名の先頭からセクションを解決（"MOTA_遅番_A" → "MOTA"）
            // スタッフ配置済み：シフト名 > スタッフ所属 > 席セクション の優先順
            const assignedShift  = s?.shiftName ?? null;
            const seatSection    = s
              ? resolveShiftSection(assignedShift, s.section ?? seat.section)
              : seat.section;
            const effectiveShift = assignedShift ?? seat.shiftSlot ?? null;
            const sectionBg     = seatSection ? getSeatBgClass(seatSection, effectiveShift) : "";
            const sectionBorder = seatSection ? getSeatBorderClass(seatSection) : "";
            const sectionText   = seatSection ? getSeatTextClass(seatSection) : "text-zinc-700 dark:text-zinc-200";

            return (
              <button
                key={seat.id}
                onClick={() => handleSeatClick(seat)}
                draggable={!!s}
                onDragStart={e => handleDragStart(e, seat.id)}
                onDragOver={e => handleDragOver(e, seat.id)}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, seat.id)}
                onDragEnd={handleDragEnd}
                style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
                className={[
                  "absolute flex flex-col items-center justify-center gap-px",
                  "w-[70px] h-[58px] rounded-xl border-2 text-center transition-all shadow-sm select-none overflow-hidden",
                  isDragging  ? "opacity-40 scale-95" : "",
                  isDropOver  ? "ring-2 ring-blue-500 ring-offset-1 scale-105" : "",
                  isTarget
                    ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400 border-dashed cursor-pointer animate-pulse"
                    : (isFree && !s)
                    ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-700 cursor-pointer"
                    : seatSection
                    ? `${sectionBg} ${sectionBorder} cursor-pointer active:scale-95`
                    : s
                    ? "bg-zinc-100 dark:bg-zinc-700 border-zinc-400 dark:border-zinc-500 cursor-pointer active:scale-95"
                    : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-600 cursor-pointer",
                ].join(" ")}
              >
                {s ? (
                  <>
                    <span className="text-[10px] font-mono text-zinc-500 tabular-nums leading-none">{s.accountNumber ?? ""}</span>
                    <span className={`text-[11px] font-bold leading-tight px-0.5 w-full truncate text-center ${sectionText}`}>
                      {s.name}
                    </span>
                    {(() => {
                      const label = formatSectionShift(seatSection, assignedShift ?? seat.shiftSlot);
                      return label ? (
                        <span className={`text-[9px] leading-none opacity-80 truncate px-0.5 w-full text-center ${sectionText}`}>
                          {label}
                        </span>
                      ) : null;
                    })()}
                  </>
                ) : (
                  <span className={`text-[10px] mt-0.5 ${
                    isFree ? "text-emerald-400 dark:text-emerald-600"
                    : isTarget ? "text-emerald-600"
                    : seatSection ? "opacity-40 " + sectionText
                    : "text-zinc-300 dark:text-zinc-600"
                  }`}>
                    {isTarget ? "ここへ" : isFree ? "FREE" : "空席"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* スタッフパネル */}
      <div className={`mt-3 space-y-2 ${embedded ? "" : "px-3"}`}>
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
