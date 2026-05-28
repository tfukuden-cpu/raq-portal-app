"use client";

import { useState, useEffect, useTransition, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { toggleBreakAction, saveSeatAssignmentsAction, autoAssignSeatsAction } from "./actions";
import { getSeatBgClass, formatSectionShift, resolveShiftSection } from "@/lib/seatColors";
import { createClient } from "@/lib/supabase/client";

export type WallData = {
  x1Pct: number;
  y1Pct: number;
  x2Pct: number;
  y2Pct: number;
};

export type SeatData = {
  id: string;
  label: string;
  xPct: number;
  yPct: number;
  section: string | null;
  seatType: "normal" | "free" | "disabled";
  staffId: string | null;
  staffName: string | null;
  accountNumber: string | null;
  shiftSlot: string | null;
  shiftName: string | null;
  status: "not_arrived" | "working" | "on_break" | "clocked_out" | "absent" | null;
};

export type StaffInfo = {
  id: string;
  name: string;
  accountNumber: string | null;
  section: string | null;
  shiftName: string | null;
};

const STATUS_BG: Record<NonNullable<SeatData["status"]>, string> = {
  not_arrived: "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-600",
  working:     "bg-green-100 dark:bg-green-900/60 border-green-400 dark:border-green-600",
  on_break:    "bg-amber-100 dark:bg-amber-900/60 border-amber-400 dark:border-amber-600",
  clocked_out: "bg-zinc-100 dark:bg-zinc-700 border-zinc-300 dark:border-zinc-500",
  absent:      "bg-red-100 dark:bg-red-900/60 border-red-400 dark:border-red-600",
};

const STATUS_TEXT: Record<NonNullable<SeatData["status"]>, string> = {
  not_arrived: "text-zinc-400",
  working:     "text-green-800 dark:text-green-200",
  on_break:    "text-amber-800 dark:text-amber-200",
  clocked_out: "text-zinc-400 dark:text-zinc-400",
  absent:      "text-red-700 dark:text-red-300",
};

const STATUS_LABEL: Record<NonNullable<SeatData["status"]>, string> = {
  not_arrived: "未出勤",
  working:     "勤務中",
  on_break:    "休憩中",
  clocked_out: "退勤済",
  absent:      "欠勤",
};

const SECTION_ORDER = ["SV", "査定", "販売", "MOTA", "リメイク", "ローン"];
function accNum(s: string | null | undefined): number {
  if (!s) return Infinity;
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1]) : Infinity;
}

export default function SeatingClient({
  projectId, today, seats, walls = [], isAdmin, myStaffId,
  staffList = [], embedded = false,
}: {
  projectId: string;
  today: string;
  seats: SeatData[];
  walls?: WallData[];
  isAdmin: boolean;
  myStaffId: string;
  staffList?: StaffInfo[];
  embedded?: boolean;
}) {
  const [statuses, setStatuses] = useState<Map<string, NonNullable<SeatData["status"]>>>(() => {
    const m = new Map<string, NonNullable<SeatData["status"]>>();
    seats.forEach(s => { if (s.staffId && s.status) m.set(s.staffId, s.status); });
    return m;
  });
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();

  // ── 席替えモード ──────────────────────────────────────────
  // draftMap: seatId → staffId(string) | null(空席)
  // undefined = 変更なし（元の割当を使用）
  const [editMode, setEditMode] = useState(false);
  const [draftMap, setDraftMap] = useState<Map<string, string | null>>(new Map());
  const [pickSeatId, setPickSeatId] = useState<string | null>(null);
  const [staffSearch, setStaffSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  function enterEditMode() {
    setDraftMap(new Map());
    setEditMode(true);
  }
  function cancelEditMode() {
    setEditMode(false);
    setDraftMap(new Map());
    setPickSeatId(null);
  }

  // ドラフト適用後の有効な staffId を返す
  function effectiveStaffId(seatId: string, original: string | null): string | null {
    return draftMap.has(seatId) ? (draftMap.get(seatId) ?? null) : original;
  }

  // あるスタッフが現在どの席に入っているか（ドラフト込み）
  const assignedSeatBySf = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const s of seats) {
      const sfId = effectiveStaffId(s.id, s.staffId);
      if (sfId) m.set(sfId, s.id);
    }
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats, draftMap]);

  // ソート済みスタッフリスト
  const sortedStaff = useMemo(() => [...staffList].sort((a, b) => {
    const ra = SECTION_ORDER.indexOf(a.section ?? "");
    const rb = SECTION_ORDER.indexOf(b.section ?? "");
    const ria = ra < 0 ? SECTION_ORDER.length : ra;
    const rib = rb < 0 ? SECTION_ORDER.length : rb;
    if (ria !== rib) return ria - rib;
    const na = accNum(a.accountNumber);
    const nb = accNum(b.accountNumber);
    return na !== nb ? na - nb : a.name.localeCompare(b.name, "ja");
  }), [staffList]);

  const filteredStaff = staffSearch
    ? sortedStaff.filter(s => s.name.includes(staffSearch) || (s.accountNumber ?? "").includes(staffSearch))
    : sortedStaff;

  // スタッフ名マップ（id → name）
  const staffNameMap = useMemo(() => new Map(staffList.map(s => [s.id, s])), [staffList]);

  useEffect(() => {
    if (pickSeatId !== null) {
      setStaffSearch("");
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [pickSeatId]);

  // 自動配置（当日）
  function handleAutoAssign() {
    if (!window.confirm("現在の配置をクリアして自動配置し直しますか？")) return;
    startTransition(async () => {
      const res = await autoAssignSeatsAction(projectId, today, []);
      if (res.success && res.assignments) {
        // 全席を一旦空席にしてから自動配置結果を適用
        const next = new Map<string, string | null>();
        for (const s of seats) {
          if (s.seatType !== "disabled") next.set(s.id, null);
        }
        for (const a of res.assignments) {
          next.set(a.seatId, a.staffId);
        }
        setDraftMap(next);
        setToast(`自動配置完了（${res.assignments.length}名）`);
        setTimeout(() => setToast(null), 2500);
      } else {
        setToast(`⚠️ ${res.message ?? "自動配置に失敗しました"}`);
        setTimeout(() => setToast(null), 2500);
      }
    });
  }

  // 保存
  function handleSave() {
    startTransition(async () => {
      const assignments: { seatId: string; staffId: string }[] = [];
      for (const s of seats) {
        if (s.seatType === "disabled") continue;
        const sfId = effectiveStaffId(s.id, s.staffId);
        if (sfId) assignments.push({ seatId: s.id, staffId: sfId });
      }
      const res = await saveSeatAssignmentsAction(projectId, today, assignments);
      if (res.success) {
        setToast("席替えを保存しました");
        setEditMode(false);
        setDraftMap(new Map());
        router.refresh();
      } else {
        setToast(`⚠️ ${res.message}`);
      }
      setTimeout(() => setToast(null), 2500);
    });
  }

  // Realtime
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`seating:punch:${projectId}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on("postgres_changes" as any, {
        event: "INSERT",
        schema: "public",
        table: "punch_logs",
        filter: `project_id=eq.${projectId}`,
      }, (payload: { new: Record<string, string> }) => {
        const staffId   = payload.new["staff_id"];
        const punchType = payload.new["punch_type"];
        if (!staffId || !punchType) return;
        setStatuses(prev => {
          const next = new Map(prev);
          if (punchType === "clock_in")    next.set(staffId, "working");
          if (punchType === "clock_out")   next.set(staffId, "clocked_out");
          if (punchType === "break_start") next.set(staffId, "on_break");
          if (punchType === "break_end")   next.set(staffId, "working");
          return next;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId]);

  // 通常モードのタップ（休憩トグル）
  function handleTap(seat: SeatData) {
    if (!seat.staffId) return;
    const status = statuses.get(seat.staffId) ?? seat.status;
    if (status !== "working" && status !== "on_break") return;
    if (!isAdmin && seat.staffId !== myStaffId) return;
    startTransition(async () => {
      const res = await toggleBreakAction(projectId, seat.staffId!);
      if (res.success && res.newStatus) {
        setStatuses(prev => new Map(prev).set(seat.staffId!, res.newStatus!));
        setToast(res.newStatus === "on_break" ? "休憩開始" : "休憩終了");
        setTimeout(() => setToast(null), 2000);
      }
    });
  }

  const [, monthStr, dayStr] = today.split("-");
  const dateLabel = `${parseInt(monthStr)}/${parseInt(dayStr)}`;

  return (
    <div className={embedded ? "" : "min-h-screen bg-zinc-50 dark:bg-zinc-950"}>

      {/* ヘッダー */}
      {!embedded && (
        <div className="sticky top-0 z-20 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800 px-4 py-3 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-bold text-zinc-800 dark:text-zinc-100">座席表</h1>
            <p className="text-xs text-zinc-400 tabular-nums">{dateLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && !editMode && (
              <>
                <button
                  onClick={enterEditMode}
                  className="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 hover:bg-amber-100 transition-colors"
                >
                  席替え
                </button>
                <a
                  href="/seating/plan"
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 hover:bg-blue-100 transition-colors"
                >
                  翌日配置
                </a>
              </>
            )}
            {editMode ? (
              <>
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
                  className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isPending ? "保存中…" : "保存"}
                </button>
                <button
                  onClick={cancelEditMode}
                  disabled={isPending}
                  className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700"
                >
                  キャンセル
                </button>
              </>
            ) : (
              <button
                onClick={() => router.refresh()}
                className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700"
              >
                更新
              </button>
            )}
          </div>
        </div>
      )}

      {/* 埋め込み時の管理ツールバー（isAdmin のみ） */}
      {embedded && isAdmin && (
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {!editMode ? (
            <button
              onClick={enterEditMode}
              className="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 hover:bg-amber-100 transition-colors"
            >
              席替え
            </button>
          ) : (
            <>
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
                className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {isPending ? "保存中…" : "保存"}
              </button>
              <button
                onClick={cancelEditMode}
                disabled={isPending}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700"
              >
                キャンセル
              </button>
            </>
          )}
        </div>
      )}

      {/* 席替えモードバナー */}
      {editMode && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
            席替えモード：席をタップしてスタッフを付け替えてください
          </p>
        </div>
      )}

      {/* 凡例 */}
      {!editMode && (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${embedded ? "" : "px-4"}`}>
          {(Object.entries(STATUS_LABEL) as [NonNullable<SeatData["status"]>, string][]).map(([s, label]) => (
            <div key={s} className="flex items-center gap-1">
              <span className={`w-2.5 h-2.5 rounded-sm border-2 ${STATUS_BG[s]}`} />
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</span>
            </div>
          ))}
          <span className="text-[11px] text-zinc-400">・タップで休憩切替</span>
        </div>
      )}

      {/* キャンバス */}
      <div className={`overflow-x-auto ${embedded ? "px-3 pb-4" : "px-3 pb-28"}`}>
        <div
          className={[
            "relative bg-white dark:bg-zinc-900 rounded-2xl border overflow-hidden",
            editMode
              ? "border-amber-300 dark:border-amber-700"
              : "border-zinc-200 dark:border-zinc-800",
          ].join(" ")}
          style={{ width: "max(100%, 1800px)", aspectRatio: "3/2" }}
        >
          {seats.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <p className="text-sm text-zinc-400">座席が設定されていません</p>
              {isAdmin && (
                <a href="/admin" className="text-xs text-blue-600 dark:text-blue-400 underline">
                  案件設定 → 座席タブで設定
                </a>
              )}
            </div>
          )}

          {/* 壁 */}
          {walls.length > 0 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {walls.map((w, i) => (
                <line key={i}
                  x1={`${w.x1Pct}%`} y1={`${w.y1Pct}%`}
                  x2={`${w.x2Pct}%`} y2={`${w.y2Pct}%`}
                  stroke="#71717a" strokeWidth="2" strokeLinecap="round"
                />
              ))}
            </svg>
          )}

          {seats.map(seat => {
            const isDisabled = seat.seatType === "disabled";
            const isFree     = seat.seatType === "free";

            // 席替えモードではドラフトを優先
            const sfId = editMode
              ? effectiveStaffId(seat.id, seat.staffId)
              : seat.staffId;
            const sfInfo = sfId ? staffNameMap.get(sfId) : null;
            const sfName = sfId ? (sfInfo?.name ?? seat.staffName ?? sfId) : null;
            const sfAcc  = sfId ? (sfInfo?.accountNumber ?? seat.accountNumber ?? null) : null;
            const sfShift = sfId ? (sfInfo?.shiftName ?? seat.shiftName ?? null) : seat.shiftName;

            const status = (!isDisabled && seat.staffId)
              ? (statuses.get(seat.staffId) ?? seat.status ?? "not_arrived")
              : null;

            const tappableBreak =
              !editMode &&
              !isDisabled &&
              seat.staffId &&
              (status === "working" || status === "on_break") &&
              (isAdmin || seat.staffId === myStaffId);

            const tappableEdit = editMode && !isDisabled;

            if (isDisabled) {
              return (
                <div key={seat.id}
                  style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
                  className="absolute w-[70px] h-[58px] rounded-xl border-2 border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800 opacity-50 flex flex-col items-center justify-center overflow-hidden"
                >
                  <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
                    <defs>
                      <pattern id={`hatch-${seat.id}`} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" strokeWidth="1.5" className="text-zinc-300 dark:text-zinc-600" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill={`url(#hatch-${seat.id})`} />
                  </svg>
                  <span className="relative text-[9px] text-zinc-400 leading-none z-10">{seat.label}</span>
                  <span className="relative text-[9px] text-zinc-400 leading-none z-10 mt-0.5">無効</span>
                </div>
              );
            }

            const isPickTarget = pickSeatId === seat.id;
            const effectiveSection = resolveShiftSection(sfShift, seat.section);
            const sectionLabel = formatSectionShift(effectiveSection, sfShift ?? seat.shiftSlot);

            return (
              <button
                key={seat.id}
                onClick={() => {
                  if (tappableEdit) {
                    setPickSeatId(seat.id);
                  } else {
                    handleTap(seat);
                  }
                }}
                disabled={isPending || (!tappableBreak && !tappableEdit)}
                style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
                className={[
                  "absolute flex flex-col items-center justify-center gap-px",
                  "w-[70px] h-[58px] rounded-xl border-2 text-center transition-all shadow-sm select-none overflow-hidden",
                  // 通常モードの色
                  !editMode && (status ? STATUS_BG[status]
                    : isFree
                    ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-700"
                    : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700"),
                  // 席替えモードの色
                  editMode && (isPickTarget
                    ? "bg-amber-100 dark:bg-amber-900/60 border-amber-400 dark:border-amber-500 scale-105 z-10"
                    : sfId
                    ? "bg-white dark:bg-zinc-800 border-amber-200 dark:border-amber-800"
                    : "bg-zinc-50 dark:bg-zinc-800 border-dashed border-amber-200 dark:border-amber-800"),
                  (tappableBreak || tappableEdit) ? "cursor-pointer active:scale-95" : "cursor-default",
                  isPending ? "opacity-60" : "",
                ].join(" ")}
              >
                {/* セクション色バー */}
                {!isFree && effectiveSection && (
                  <div className={`absolute top-0 left-0 right-0 h-1 rounded-t-[10px] ${getSeatBgClass(effectiveSection, sfShift ?? seat.shiftSlot)}`} />
                )}

                <span className="text-[9px] text-zinc-400 leading-none">{seat.label}</span>

                {sfName ? (
                  <>
                    <span className="text-[10px] font-mono text-zinc-400 tabular-nums leading-none">
                      {sfAcc ?? ""}
                    </span>
                    <span className={`text-[11px] font-bold leading-tight px-0.5 w-full truncate text-center ${!editMode && status ? STATUS_TEXT[status] : "text-zinc-700 dark:text-zinc-200"}`}>
                      {sfName}
                    </span>
                    {sectionLabel ? (
                      <span className="text-[9px] leading-none text-zinc-500 dark:text-zinc-400 truncate px-0.5 w-full text-center">
                        {sectionLabel}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className={`text-[10px] mt-0.5 ${isFree ? "text-emerald-400 dark:text-emerald-600" : editMode ? "text-amber-400" : "text-zinc-300 dark:text-zinc-600"}`}>
                    {isFree ? "FREE" : editMode ? "タップで配置" : "空席"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* トースト */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}

      {/* ── スタッフ選択ピッカー（席替えモード） ──────────────── */}
      {pickSeatId !== null && (() => {
        const pickedSeat = seats.find(s => s.id === pickSeatId);
        const currentSfId = effectiveStaffId(pickSeatId, pickedSeat?.staffId ?? null);

        return (
          <div
            className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
            onClick={() => setPickSeatId(null)}
          >
            <div
              className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-2xl flex flex-col max-h-[70vh]"
              onClick={e => e.stopPropagation()}
            >
              {/* ピッカーヘッダー */}
              <div className="px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0">
                <p className="text-xs text-zinc-400 mb-0.5">席 {pickedSeat?.label}</p>
                <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
                  誰を配置しますか？
                </p>
                <input
                  ref={searchRef}
                  type="search"
                  placeholder="名前・番号で検索…"
                  value={staffSearch}
                  onChange={e => setStaffSearch(e.target.value)}
                  className="mt-2 w-full text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:text-zinc-100"
                />
              </div>

              {/* スタッフリスト */}
              <ul className="overflow-y-auto flex-1 divide-y divide-zinc-100 dark:divide-zinc-800">
                {/* 空席にする */}
                <li>
                  <button
                    onClick={() => {
                      setDraftMap(prev => new Map(prev).set(pickSeatId, null));
                      setPickSeatId(null);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <span className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-400 text-xs flex-shrink-0">
                      ✕
                    </span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">空席にする</span>
                  </button>
                </li>

                {filteredStaff.map(s => {
                  const isCurrentSeat = currentSfId === s.id;
                  const elsewhereId   = assignedSeatBySf.get(s.id);
                  const elsewhereLabel = elsewhereId && elsewhereId !== pickSeatId
                    ? seats.find(se => se.id === elsewhereId)?.label
                    : null;

                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => {
                          // 別の席に既に配置されているなら、そちらを空席に
                          setDraftMap(prev => {
                            const next = new Map(prev);
                            if (elsewhereId && elsewhereId !== pickSeatId) {
                              next.set(elsewhereId, null);
                            }
                            next.set(pickSeatId, s.id);
                            return next;
                          });
                          setPickSeatId(null);
                        }}
                        className={[
                          "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                          isCurrentSeat
                            ? "bg-amber-50 dark:bg-amber-950/30"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800",
                        ].join(" ")}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${isCurrentSeat ? "bg-amber-500" : "bg-zinc-400 dark:bg-zinc-600"}`}>
                          {s.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold leading-tight truncate ${isCurrentSeat ? "text-amber-700 dark:text-amber-300" : "text-zinc-800 dark:text-zinc-100"}`}>
                            {s.name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {s.accountNumber && (
                              <span className="text-[11px] text-zinc-400 tabular-nums">{s.accountNumber}</span>
                            )}
                            {s.section && (
                              <span className="text-[11px] text-zinc-400">{s.section}</span>
                            )}
                          </div>
                        </div>
                        {isCurrentSeat && (
                          <span className="text-[10px] text-amber-500 font-semibold flex-shrink-0">現在の席</span>
                        )}
                        {elsewhereLabel && !isCurrentSeat && (
                          <span className="text-[10px] text-zinc-400 flex-shrink-0">
                            席{elsewhereLabel}に配置中
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}

                {filteredStaff.length === 0 && (
                  <li className="px-4 py-6 text-center text-sm text-zinc-400">
                    該当するスタッフがいません
                  </li>
                )}
              </ul>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
