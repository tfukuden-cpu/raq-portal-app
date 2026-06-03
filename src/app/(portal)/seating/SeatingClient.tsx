"use client";

import { useState, useEffect, useTransition, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  saveSeatAssignmentsAction, autoAssignSeatsAction,
  acquireSeatingEditAction, releaseSeatingEditAction, heartbeatSeatingEditAction,
  getSeatingEditorsAction,
  type SeatingEditor,
} from "./actions";
import { assignBreakSlotsAction } from "./break-actions";
import type { BreakSlotSetting } from "./break-actions";
import { resolveShiftSection } from "@/lib/seatColors";
import { createClient } from "@/lib/supabase/client";
import PunchModal from "./PunchModal";

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
  status: "not_arrived" | "working" | "on_break" | "seat_leave" | "clocked_out" | "absent" | null;
  breakStartTime?: string | null;  // ISO: 休憩開始時刻（経過時間表示用）
  seatLeaveTime?:  string | null;  // ISO: 離席開始時刻（経過時間表示用）
  motaSlot?: string | null;
};

export type StaffInfo = {
  id: string;
  name: string;
  accountNumber: string | null;
  section: string | null;
  shiftName: string | null;
};

// 凡例用（ステータス色ドット）
const STATUS_BG: Record<NonNullable<SeatData["status"]>, string> = {
  not_arrived: "bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-500",
  working:     "bg-green-400 dark:bg-green-600 border-green-500",
  on_break:    "bg-amber-400 dark:bg-amber-600 border-amber-500",
  seat_leave:  "bg-zinc-400 dark:bg-zinc-500 border-zinc-500",
  clocked_out: "bg-zinc-600 dark:bg-zinc-500 border-zinc-700",
  absent:      "bg-red-400 dark:bg-red-600 border-red-500",
};

const STATUS_LABEL: Record<NonNullable<SeatData["status"]>, string> = {
  not_arrived: "未出勤",
  working:     "勤務中",
  on_break:    "休憩中",
  seat_leave:  "離席中",
  clocked_out: "退勤済",
  absent:      "欠勤",
};

// カードボディ（ステータスで色分け）
const CARD_BODY_BG: Record<NonNullable<SeatData["status"]>, string> = {
  not_arrived: "bg-zinc-50 dark:bg-zinc-800",
  working:     "bg-green-100 dark:bg-green-900/40",
  on_break:    "bg-amber-100 dark:bg-amber-900/40",
  seat_leave:  "bg-zinc-200 dark:bg-zinc-700",
  clocked_out: "bg-zinc-300 dark:bg-zinc-600",
  absent:      "bg-red-100 dark:bg-red-900/40",
};
const CARD_BODY_OVERTIME = "bg-red-200 dark:bg-red-900/60"; // 休憩超過

const CARD_NAME_COLOR: Record<NonNullable<SeatData["status"]>, string> = {
  not_arrived: "text-zinc-400",
  working:     "text-green-800 dark:text-green-200",
  on_break:    "text-amber-800 dark:text-amber-200",
  seat_leave:  "text-zinc-600 dark:text-zinc-300",
  clocked_out: "text-zinc-500 dark:text-zinc-400",
  absent:      "text-red-700 dark:text-red-300",
};

// カードヘッダー（セクションで色分け）
const SECTION_HEADER: Record<string, string> = {
  "SV":       "bg-blue-500 dark:bg-blue-700",
  "査定":     "bg-emerald-500 dark:bg-emerald-700",
  "販売":     "bg-orange-500 dark:bg-orange-700",
  "MOTA":     "bg-red-500 dark:bg-red-700",
  "H MOTA":   "bg-purple-500 dark:bg-purple-700",
  "インフォ": "bg-sky-500 dark:bg-sky-700",
  "未アポ":   "bg-zinc-400 dark:bg-zinc-600",
  "ローン":   "bg-violet-500 dark:bg-violet-700",
  "その他":   "bg-zinc-400 dark:bg-zinc-600",
};
const SECTION_HEADER_DEFAULT = "bg-zinc-400 dark:bg-zinc-600";

// カードボーダー（セクションで色分け）
const SECTION_BORDER: Record<string, string> = {
  "SV":       "border-blue-400 dark:border-blue-600",
  "査定":     "border-emerald-400 dark:border-emerald-600",
  "販売":     "border-orange-400 dark:border-orange-600",
  "MOTA":     "border-red-400 dark:border-red-600",
  "H MOTA":   "border-purple-400 dark:border-purple-600",
  "インフォ": "border-sky-400 dark:border-sky-600",
  "未アポ":   "border-zinc-300 dark:border-zinc-600",
  "ローン":   "border-violet-400 dark:border-violet-600",
};

const SECTION_ORDER = ["SV", "査定", "販売", "MOTA", "リメイク", "ローン"];

const BREAK_BADGE_CLASS: Record<number, string> = {
  1: "bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300",
  2: "bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300",
  3: "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300",
};
const BREAK_SLOT_LABEL: Record<number, string> = { 1: "①", 2: "②", 3: "③" };
function accNum(s: string | null | undefined): number {
  if (!s) return Infinity;
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1]) : Infinity;
}

export default function SeatingClient({
  projectId, today, seats, walls = [], isAdmin, myStaffId,
  staffList = [], embedded = false, breakAssignmentMap = {},
  motaAccountSlotRecord = {}, shiftTimeMap = {}, breakSlots = [],
}: {
  projectId: string;
  today: string;
  seats: SeatData[];
  walls?: WallData[];
  isAdmin: boolean;
  myStaffId: string;
  staffList?: StaffInfo[];
  embedded?: boolean;
  breakAssignmentMap?: Record<string, number>;
  motaAccountSlotRecord?: Record<string, string>;
  shiftTimeMap?: Record<string, { start: string | null; end: string | null }>;
  breakSlots?: BreakSlotSetting[];
}) {
  const [statuses, setStatuses] = useState<Map<string, NonNullable<SeatData["status"]>>>(() => {
    const m = new Map<string, NonNullable<SeatData["status"]>>();
    seats.forEach(s => { if (s.staffId && s.status) m.set(s.staffId, s.status); });
    return m;
  });

  // 休憩・離席の開始時刻（経過時間タイマー用）
  const [breakStartTimes, setBreakStartTimes] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    seats.forEach(s => { if (s.staffId && s.breakStartTime) m.set(s.staffId, s.breakStartTime); });
    return m;
  });
  const [seatLeaveTimes, setSeatLeaveTimes] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    seats.forEach(s => { if (s.staffId && s.seatLeaveTime) m.set(s.staffId, s.seatLeaveTime); });
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
  const [showBreakPanel, setShowBreakPanel] = useState(false);
  const [staffSearch, setStaffSearch] = useState("");
  // ドラッグ＆スワップ
  const [dragSeatId, setDragSeatId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── 同時編集セッション ─────────────────────────────────────
  const [otherEditors, setOtherEditors] = useState<SeatingEditor[]>([]);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 他の編集者リストを更新（自分は除く） */
  async function refreshEditors(myId: string) {
    const { editors } = await getSeatingEditorsAction(projectId, today);
    setOtherEditors(editors.filter(e => e.staffId !== myId));
  }

  async function enterEditMode() {
    setDraftMap(new Map());
    const res = await acquireSeatingEditAction(projectId, today);
    const myId = res.staffId ?? myStaffId;
    await refreshEditors(myId);
    setEditMode(true);

    // ハートビート（30秒ごと）
    heartbeatRef.current = setInterval(() => {
      heartbeatSeatingEditAction(projectId, today);
    }, 30_000);

    // 他の編集者ポーリング（15秒ごと）
    pollRef.current = setInterval(() => {
      refreshEditors(myId);
    }, 15_000);
  }

  function stopEditSession() {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    if (pollRef.current)      { clearInterval(pollRef.current);      pollRef.current = null; }
    releaseSeatingEditAction(projectId, today);
    setOtherEditors([]);
  }

  function cancelEditMode() {
    stopEditSession();
    setEditMode(false);
    setDraftMap(new Map());
    setPickSeatId(null);
  }

  // アンマウント時にセッション解放
  useEffect(() => {
    return () => {
      if (editMode) stopEditSession();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);

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

  // 当日出勤スタッフセット（staffList が空 = シフトデータ無し → 判定しない）
  const workingStaffSet = useMemo<Set<string> | null>(() => {
    return staffList.length > 0 ? new Set(staffList.map(s => s.id)) : null;
  }, [staffList]);

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

  // 休憩一覧：スロット × セクション × 早番/遅番
  const breakOverview = useMemo(() => {
    if (!breakSlots.length) return [];
    const TARGET_SECTIONS = ["査定", "販売"] as const;
    type SecData = { early: string[]; late: string[] };
    const rows = breakSlots.map(slot => ({
      slot,
      secs: Object.fromEntries(TARGET_SECTIONS.map(sec => [sec, { early: [], late: [] } as SecData])) as Record<string, SecData>,
    }));
    for (const seat of seats) {
      if (!seat.staffId || !seat.staffName || !seat.section) continue;
      const slotNum = breakAssignmentMap[seat.staffId];
      if (!slotNum) continue;
      const row = rows.find(r => r.slot.slot_number === slotNum);
      if (!row) continue;
      const sec = seat.section as string;
      if (!row.secs[sec]) continue;
      const isEarly = seat.shiftName?.includes("早番") ?? false;
      if (isEarly) row.secs[sec].early.push(seat.staffName);
      else row.secs[sec].late.push(seat.staffName);
    }
    return rows;
  }, [seats, breakSlots, breakAssignmentMap]);

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
        stopEditSession();
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

  // 非編集モードでも他の編集者を定期ポーリング
  const viewPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (editMode) return; // 編集中は pollRef で管理
    // 初回取得
    getSeatingEditorsAction(projectId, today).then(({ editors }) => {
      setOtherEditors(editors.filter(e => e.staffId !== myStaffId));
    });
    viewPollRef.current = setInterval(() => {
      getSeatingEditorsAction(projectId, today).then(({ editors }) => {
        setOtherEditors(editors.filter(e => e.staffId !== myStaffId));
      });
    }, 15_000);
    return () => {
      if (viewPollRef.current) { clearInterval(viewPollRef.current); viewPollRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, projectId, today]);

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
        const recordedAt: string = payload.new["recorded_at"] ?? new Date().toISOString();
        setStatuses(prev => {
          const next = new Map(prev);
          if (punchType === "clock_in")    next.set(staffId, "working");
          if (punchType === "clock_out")   next.set(staffId, "clocked_out");
          if (punchType === "break_start") next.set(staffId, "on_break");
          if (punchType === "break_end")   next.set(staffId, "working");
          if (punchType === "seat_leave")  next.set(staffId, "seat_leave");
          if (punchType === "seat_return") next.set(staffId, "working");
          return next;
        });
        // 開始時刻を追跡
        if (punchType === "break_start") {
          setBreakStartTimes(prev => new Map(prev).set(staffId, recordedAt));
        }
        if (punchType === "break_end" || punchType === "clock_out") {
          setBreakStartTimes(prev => { const m = new Map(prev); m.delete(staffId); return m; });
        }
        if (punchType === "seat_leave") {
          setSeatLeaveTimes(prev => new Map(prev).set(staffId, recordedAt));
        }
        if (punchType === "seat_return" || punchType === "clock_out") {
          setSeatLeaveTimes(prev => { const m = new Map(prev); m.delete(staffId); return m; });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId]);

  // 休憩スロット自動割り振り
  function handleAssignBreaks() {
    startTransition(async () => {
      const res = await assignBreakSlotsAction(projectId, today);
      if (res.success) {
        setToast(`休憩割り振り完了（${res.count}名）`);
        router.refresh();
      } else {
        setToast(`⚠️ ${res.error ?? "休憩割り振りに失敗しました"}`);
      }
      setTimeout(() => setToast(null), 2500);
    });
  }

  // ── 超過判定用 tick（30秒ごと） ──────────────────────────
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── 打刻モーダル ──────────────────────────────────────────
  const [punchModal, setPunchModal] = useState<{
    staffId: string;
    staffName: string;
    accountNumber: string | null;
    section: string | null;
    shiftName: string | null;
    breakSlotNumber: number | null;
    motaSlot: string | null;
  } | null>(null);

  // ── 右パネルからのドラッグ ────────────────────────────────
  const [dragPanelStaffId, setDragPanelStaffId] = useState<string | null>(null);

  // ── キャンバス ドラッグパン（ネイティブスクロール連動） ──────
  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  function handleCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // ボタン・座席カード上はパンしない（席タップ・編集を優先）
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, baseLeft: el.scrollLeft, baseTop: el.scrollTop };
    setIsPanning(false);
  }

  function handleCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!panRef.current || !scrollRef.current) return;
    const dx = e.clientX - panRef.current.startX;
    const dy = e.clientY - panRef.current.startY;
    if (!isPanning && Math.abs(dx) + Math.abs(dy) > 4) setIsPanning(true);
    if (!isPanning && Math.abs(dx) + Math.abs(dy) <= 4) return;
    scrollRef.current.scrollLeft = panRef.current.baseLeft - dx;
    scrollRef.current.scrollTop  = panRef.current.baseTop  - dy;
  }

  function handleCanvasPointerUp() {
    panRef.current = null;
    setTimeout(() => setIsPanning(false), 0);
  }

  // ── ドラッグ&スワップ（席替えモード） ────────────────────
  function handleDragStart(e: React.DragEvent, seatId: string) {
    setDragSeatId(seatId);
    e.dataTransfer.effectAllowed = "move";
  }
  function handleDragOver(e: React.DragEvent, seatId: string) {
    e.preventDefault();
    if (dragSeatId && dragSeatId !== seatId) setDropTargetId(seatId);
  }
  function handleDragLeave() { setDropTargetId(null); }
  function handleDragEnd() { setDragSeatId(null); setDropTargetId(null); }
  function handleDrop(e: React.DragEvent, targetSeatId: string) {
    e.preventDefault();

    // 右パネルからのドラッグ（未配置スタッフ → 座席に配置）
    if (dragPanelStaffId) {
      const currentSeatOfStaff = assignedSeatBySf.get(dragPanelStaffId);
      setDraftMap(prev => {
        const next = new Map(prev);
        if (currentSeatOfStaff) next.set(currentSeatOfStaff, null); // 既配置を外す
        next.set(targetSeatId, dragPanelStaffId);
        return next;
      });
      setDragPanelStaffId(null);
      setDropTargetId(null);
      return;
    }

    if (!dragSeatId || dragSeatId === targetSeatId) {
      setDragSeatId(null); setDropTargetId(null); return;
    }
    // 2席のスタッフを入れ替え
    const fromStaffId = effectiveStaffId(dragSeatId, seats.find(s => s.id === dragSeatId)?.staffId ?? null);
    const toStaffId   = effectiveStaffId(targetSeatId, seats.find(s => s.id === targetSeatId)?.staffId ?? null);
    setDraftMap(prev => {
      const next = new Map(prev);
      next.set(dragSeatId,   toStaffId);
      next.set(targetSeatId, fromStaffId);
      return next;
    });
    setDragSeatId(null); setDropTargetId(null);
  }

  // 通常モードのタップ → 打刻モーダルを開く
  function handleTap(seat: SeatData) {
    if (!seat.staffId) return;
    const staffInfo = staffNameMap.get(seat.staffId);
    const name = staffInfo?.name ?? seat.staffName ?? seat.staffId;
    const acc  = staffInfo?.accountNumber ?? seat.accountNumber ?? null;
    setPunchModal({
      staffId: seat.staffId,
      staffName: name,
      accountNumber: acc,
      section: staffInfo?.section ?? null,
      shiftName: staffInfo?.shiftName ?? seat.shiftName ?? null,
      breakSlotNumber: breakAssignmentMap[seat.staffId] ?? null,
      motaSlot: acc ? (motaAccountSlotRecord[acc] ?? null) : null,
    });
  }

  const [, monthStr, dayStr] = today.split("-");
  const dateLabel = `${parseInt(monthStr)}/${parseInt(dayStr)}`;

  return (
    <div className={embedded ? "h-full flex flex-col overflow-hidden" : "h-dvh flex flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950"}>

      {/* ヘッダー */}
      {!embedded && (
        <div className="shrink-0 z-20 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800 px-4 py-3 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-bold text-zinc-800 dark:text-zinc-100">座席表</h1>
            <p className="text-xs text-zinc-400 tabular-nums">{dateLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && !editMode && (
              <>
                <button
                  onClick={otherEditors.length > 0 ? undefined : enterEditMode}
                  disabled={otherEditors.length > 0}
                  title={otherEditors.length > 0 ? `${otherEditors.map(e => e.staffName).join("・")}が編集中のため操作できません` : undefined}
                  className={[
                    "text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors",
                    otherEditors.length > 0
                      ? "text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 cursor-not-allowed opacity-60"
                      : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 hover:bg-amber-100",
                  ].join(" ")}
                >
                  {otherEditors.length > 0 ? "🔒 席替え" : "席替え"}
                </button>
                <a
                  href="/seating/plan"
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 hover:bg-blue-100 transition-colors"
                >
                  配置編集
                </a>
                <button
                  onClick={handleAssignBreaks}
                  disabled={isPending}
                  className="text-xs font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 px-3 py-1.5 rounded-lg border border-violet-200 dark:border-violet-800 hover:bg-violet-100 transition-colors disabled:opacity-50"
                >
                  休憩割り振り
                </button>
                {breakSlots.length > 0 && (
                  <button
                    onClick={() => setShowBreakPanel(v => !v)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${showBreakPanel ? "bg-violet-600 text-white border-violet-600" : "text-violet-600 dark:text-violet-400 bg-white dark:bg-zinc-900 border-violet-200 dark:border-violet-800 hover:bg-violet-50"}`}
                  >
                    休憩一覧
                  </button>
                )}
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
              onClick={otherEditors.length > 0 ? undefined : enterEditMode}
              disabled={otherEditors.length > 0}
              title={otherEditors.length > 0 ? `${otherEditors.map(e => e.staffName).join("・")}が編集中のため操作できません` : undefined}
              className={[
                "text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors",
                otherEditors.length > 0
                  ? "text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 cursor-not-allowed opacity-60"
                  : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 hover:bg-amber-100",
              ].join(" ")}
            >
              {otherEditors.length > 0 ? "🔒 席替え" : "席替え"}
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
          {!editMode && breakSlots.length > 0 && (
            <button
              onClick={() => setShowBreakPanel(v => !v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${showBreakPanel ? "bg-violet-600 text-white border-violet-600" : "text-violet-600 dark:text-violet-400 bg-white dark:bg-zinc-900 border-violet-200 dark:border-violet-800 hover:bg-violet-50"}`}
            >
              休憩一覧
            </button>
          )}
        </div>
      )}

      {/* 他ユーザー編集中バナー（同時編集ロック） */}
      {otherEditors.length > 0 && !editMode && (
        <div className="bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-800 px-4 py-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse flex-shrink-0" />
          <p className="text-xs text-rose-700 dark:text-rose-300 font-medium">
            🔒 {otherEditors.map(e => e.staffName).join("・")}
            {otherEditors.length === 1 ? " が" : " たちが"}席替え編集中のため、編集できません
          </p>
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

      {/* 休憩一覧パネル */}
      {showBreakPanel && breakOverview.length > 0 && (
        <div className={`${embedded ? "mx-3" : "mx-3"} mb-2 rounded-2xl border border-violet-200 dark:border-violet-800 bg-white dark:bg-zinc-950 overflow-hidden`}>
          <div className="px-3 py-2 bg-violet-50 dark:bg-violet-950/30 border-b border-violet-200 dark:border-violet-800 flex items-center justify-between">
            <p className="text-xs font-bold text-violet-700 dark:text-violet-300">休憩スロット一覧</p>
            <button onClick={() => setShowBreakPanel(false)} className="text-[11px] text-violet-400 hover:text-violet-600">✕</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]" style={{ minWidth: "500px" }}>
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <th className="px-3 py-1.5 text-left font-semibold text-zinc-400 w-28">スロット</th>
                  {["査定", "販売"].map(sec => (
                    <th key={sec} colSpan={2} className="px-3 py-1.5 text-left font-semibold text-zinc-500 border-l border-zinc-100 dark:border-zinc-800">{sec}</th>
                  ))}
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800 text-zinc-400">
                  <th />
                  {["査定", "販売"].flatMap(sec => [
                    <th key={`${sec}-early`} className="px-3 py-1 text-left font-normal border-l border-zinc-100 dark:border-zinc-800">早番</th>,
                    <th key={`${sec}-late`} className="px-3 py-1 text-left font-normal border-l border-zinc-50 dark:border-zinc-900">遅番</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {breakOverview.map(({ slot, secs }) => {
                  const slotBg = slot.slot_number === 1 ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300"
                               : slot.slot_number === 2 ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300"
                               : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300";
                  return (
                    <tr key={slot.slot_number} className="border-b last:border-b-0 border-zinc-100 dark:border-zinc-800 align-top">
                      <td className={`px-3 py-2 font-semibold tabular-nums ${slotBg}`}>
                        <div>{slot.label} スロット{slot.slot_number}</div>
                        <div className="text-[10px] opacity-80 mt-0.5">{slot.start_time.slice(0,5)}〜{slot.end_time.slice(0,5)}</div>
                      </td>
                      {["査定", "販売"].flatMap(sec => {
                        const d = secs[sec] ?? { early: [], late: [] };
                        return [
                          <td key={`${sec}-early`} className="px-3 py-2 border-l border-zinc-100 dark:border-zinc-800">
                            <div className="text-zinc-500 font-semibold mb-0.5">{d.early.length}名</div>
                            {d.early.map(n => <div key={n} className="text-zinc-600 dark:text-zinc-400">{n}</div>)}
                          </td>,
                          <td key={`${sec}-late`} className="px-3 py-2 border-l border-zinc-50 dark:border-zinc-900">
                            <div className="text-zinc-500 font-semibold mb-0.5">{d.late.length}名</div>
                            {d.late.map(n => <div key={n} className="text-zinc-600 dark:text-zinc-400">{n}</div>)}
                          </td>,
                        ];
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* キャンバス + 右パネル */}
      <div className={`flex gap-2 flex-1 min-h-0 ${embedded ? "px-3 pb-2" : "px-3 pb-4"}`}>
      <div
        ref={scrollRef}
        className="overflow-auto flex-1 min-w-0 min-h-0 rounded-2xl select-none"
        style={{ cursor: isPanning ? "grabbing" : "grab" }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
      >
        <div
          className={[
            "relative bg-white dark:bg-zinc-900 rounded-2xl border overflow-hidden",
            editMode
              ? "border-amber-300 dark:border-amber-700"
              : "border-zinc-200 dark:border-zinc-800",
          ].join(" ")}
          style={{
            width: "max(100%, 1800px)", aspectRatio: "3/2",
          }}
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
            // MOTAスロット：スタッフのアカウント番号から動的に参照（入れ替え時も追従）
            const effectiveMotaSlot = sfAcc ? (motaAccountSlotRecord[sfAcc] ?? null) : null;

            const status = (!isDisabled && seat.staffId)
              ? (statuses.get(seat.staffId) ?? seat.status ?? "not_arrived")
              : null;

            // ビューモードでスタッフがいる席はすべてタップ可能（打刻モーダル）
            const tappableBreak =
              !editMode &&
              !isDisabled &&
              !!seat.staffId;

            const tappableEdit = editMode && !isDisabled;

            if (isDisabled) {
              return (
                <div key={seat.id}
                  style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
                  className="absolute w-[76px] h-[70px] rounded-xl border-2 border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800 opacity-40 flex flex-col items-center justify-center overflow-hidden"
                >
                  <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
                    <defs>
                      <pattern id={`hatch-${seat.id}`} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" strokeWidth="1.5" className="text-zinc-300 dark:text-zinc-600" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill={`url(#hatch-${seat.id})`} />
                  </svg>
                  <span className="relative text-[9px] text-zinc-400 z-10">{seat.label}</span>
                </div>
              );
            }

            const isPickTarget    = pickSeatId === seat.id;
            const effectiveSection = resolveShiftSection(sfShift, seat.section);
            const isDragging   = editMode && dragSeatId   === seat.id;
            const isDropTarget = editMode && dropTargetId === seat.id;

            // 休憩超過判定
            const breakStart = sfId ? breakStartTimes.get(sfId) : null;
            const isBreakOvertime = status === "on_break" && breakStart
              ? (nowMs - new Date(breakStart).getTime()) / 60000 > 60
              : false;

            // 当日出勤外スタッフ判定（シフトなし・休み）
            const isNotWorking = !editMode && sfId && workingStaffSet !== null && !workingStaffSet.has(sfId);

            // カード本体スタイル
            const headerBg = editMode
              ? "bg-amber-300 dark:bg-amber-800"
              : (effectiveSection ? (SECTION_HEADER[effectiveSection] ?? SECTION_HEADER_DEFAULT) : SECTION_HEADER_DEFAULT);
            const bodyBg = editMode
              ? (isDropTarget ? "bg-blue-50 dark:bg-blue-900/40"
                : isPickTarget ? "bg-amber-50 dark:bg-amber-900/40"
                : "bg-white dark:bg-zinc-800")
              : (isBreakOvertime ? CARD_BODY_OVERTIME : status ? CARD_BODY_BG[status] : "bg-zinc-50 dark:bg-zinc-800");
            const cardBorder = editMode
              ? (isDropTarget ? "border-blue-400 ring-2 ring-blue-400 scale-105 z-10"
                : isDragging  ? "border-amber-300 opacity-40 scale-95"
                : isPickTarget ? "border-amber-400 scale-105 z-10"
                : sfId ? "border-amber-300 dark:border-amber-700"
                : "border-dashed border-amber-200 dark:border-amber-700")
              : isNotWorking
                ? "border-dashed border-orange-400 dark:border-orange-600"
                : (effectiveSection ? (SECTION_BORDER[effectiveSection] ?? "border-zinc-300 dark:border-zinc-600")
                : isFree ? "border-emerald-300 dark:border-emerald-700" : "border-zinc-200 dark:border-zinc-700");

            // シフト早遅ラベル
            const shiftLabel = sfShift?.includes("早") ? "早" : sfShift?.includes("遅") ? "遅" : "";

            return (
              <button
                key={seat.id}
                title={sfName ?? undefined}
                onClick={() => {
                  if (dragSeatId) return;
                  if (isPanning) return;
                  if (tappableEdit) { setPickSeatId(seat.id); }
                  else { handleTap(seat); }
                }}
                draggable={editMode && !!sfId}
                onDragStart={e => editMode && handleDragStart(e, seat.id)}
                onDragOver={e => editMode && handleDragOver(e, seat.id)}
                onDragLeave={() => editMode && handleDragLeave()}
                onDrop={e => editMode && handleDrop(e, seat.id)}
                onDragEnd={() => editMode && handleDragEnd()}
                disabled={isPending || (!tappableBreak && !tappableEdit)}
                style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
                className={[
                  "absolute flex flex-col w-[76px] h-[70px] rounded-xl border-2 overflow-hidden shadow-sm select-none",
                  "transition-colors",
                  cardBorder,
                  editMode && sfId ? "cursor-grab active:cursor-grabbing"
                    : (tappableBreak || tappableEdit) ? "cursor-pointer active:scale-95"
                    : "cursor-default",
                  isPending ? "opacity-60" : "",
                ].join(" ")}
              >
                {/* ── ヘッダー（セクション色） ── */}
                <div className={`w-full px-1.5 py-1 flex items-center justify-between shrink-0 ${headerBg}`}>
                  <span className="text-[10px] font-bold text-white leading-none truncate flex-1">
                    {effectiveSection
                      ? `${effectiveSection}${shiftLabel ? `(${shiftLabel})` : ""}`
                      : isFree ? "FREE" : seat.label}
                  </span>
                  {!editMode && sfId && breakAssignmentMap[sfId] && (
                    <span className={`text-[8px] font-bold ml-0.5 leading-none ${BREAK_BADGE_CLASS[breakAssignmentMap[sfId]] ?? ""}`}>
                      {BREAK_SLOT_LABEL[breakAssignmentMap[sfId]] ?? ""}
                    </span>
                  )}
                  {isNotWorking && (
                    <span className="text-[8px] font-bold ml-0.5 leading-none bg-orange-500 text-white rounded-sm px-0.5">
                      !
                    </span>
                  )}
                </div>

                {/* ── ボディ（ステータス色） ── */}
                <div className={`flex-1 flex flex-col items-center justify-center px-0.5 py-0.5 ${bodyBg}`}>
                  {sfName ? (
                    <>
                      <span className="text-[9px] font-mono text-zinc-400 tabular-nums leading-none">
                        {sfAcc ?? ""}
                      </span>
                      <span className={`text-[11px] font-bold leading-tight px-0.5 w-full truncate text-center ${!editMode && status && !isBreakOvertime ? CARD_NAME_COLOR[status] : "text-zinc-700 dark:text-zinc-200"}`}>
                        {sfName}
                      </span>
                      {/* 休憩中/離席中: タイマー表示 */}
                      {!editMode && sfId && status === "on_break" && breakStart && (
                        <ElapsedTimer startISO={breakStart} limitMin={60} isOvertime={isBreakOvertime} />
                      )}
                      {!editMode && sfId && status === "seat_leave" && seatLeaveTimes.get(sfId) && (
                        <ElapsedTimer startISO={seatLeaveTimes.get(sfId)!} limitMin={null} isOvertime={false} />
                      )}
                      {/* 通常時: H MOTAスロット */}
                      {(!editMode ? (status !== "on_break" && status !== "seat_leave") : true) && effectiveMotaSlot && (
                        <span className="text-[9px] leading-none text-purple-600 dark:text-purple-400 font-bold truncate px-0.5 w-full text-center">
                          H {effectiveMotaSlot}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className={`text-[10px] ${isFree ? "text-emerald-500 dark:text-emerald-400" : editMode ? "text-amber-400" : "text-zinc-300 dark:text-zinc-600"}`}>
                      {isFree ? "FREE" : editMode ? "配置" : "空席"}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 右パネル：未配置スタッフ ── */}
      {staffList.length > 0 && (() => {
        const unassigned = sortedStaff.filter(s => !assignedSeatBySf.has(s.id));
        return (
          <div className="w-40 shrink-0 flex flex-col" style={{ maxHeight: embedded ? "calc(100dvh - 320px)" : "calc(100dvh - 270px)" }}>
            <p className="text-[11px] font-semibold text-zinc-400 mb-1.5 px-0.5">
              未配置 <span className="font-normal tabular-nums">({unassigned.length}名)</span>
            </p>
            <div className="flex-1 overflow-y-auto space-y-1 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
              {unassigned.length === 0 ? (
                <p className="text-[10px] text-zinc-300 dark:text-zinc-600 px-0.5">全員配置済み</p>
              ) : unassigned.map(s => {
                const sfStatus = statuses.get(s.id);
                return (
                  <div
                    key={s.id}
                    draggable={editMode}
                    onDragStart={e => {
                      if (!editMode) return;
                      setDragPanelStaffId(s.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDragPanelStaffId(null)}
                    onClick={() => {
                      if (editMode && pickSeatId) {
                        // クリックで配置
                        const elsewhereId = assignedSeatBySf.get(s.id);
                        setDraftMap(prev => {
                          const next = new Map(prev);
                          if (elsewhereId && elsewhereId !== pickSeatId) next.set(elsewhereId, null);
                          next.set(pickSeatId, s.id);
                          return next;
                        });
                        setPickSeatId(null);
                      } else if (!editMode) {
                        setPunchModal({
                          staffId: s.id, staffName: s.name,
                          accountNumber: s.accountNumber ?? null,
                          section: s.section ?? null,
                          shiftName: s.shiftName ?? null,
                          breakSlotNumber: breakAssignmentMap[s.id] ?? null,
                          motaSlot: s.accountNumber ? (motaAccountSlotRecord[s.accountNumber] ?? null) : null,
                        });
                      }
                    }}
                    className={[
                      "px-2 py-1.5 rounded-xl border text-[11px] select-none transition-colors",
                      editMode
                        ? "cursor-grab active:cursor-grabbing bg-white dark:bg-zinc-800 border-amber-200 dark:border-amber-800 hover:border-amber-400"
                        : "cursor-pointer bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 hover:border-blue-400",
                      dragPanelStaffId === s.id ? "opacity-40" : "",
                    ].join(" ")}
                  >
                    {s.accountNumber && (
                      <span className="font-mono text-[9px] text-zinc-400 tabular-nums block leading-none mb-0.5">{s.accountNumber}</span>
                    )}
                    <span className="font-semibold text-zinc-700 dark:text-zinc-200 block truncate">{s.name}</span>
                    {!editMode && sfStatus && (
                      <span className={`text-[9px] font-bold mt-0.5 block ${
                        sfStatus === "working"     ? "text-green-600 dark:text-green-400" :
                        sfStatus === "on_break"    ? "text-amber-600 dark:text-amber-400" :
                        sfStatus === "clocked_out" ? "text-zinc-400" :
                        sfStatus === "absent"      ? "text-red-500" : "text-zinc-300"
                      }`}>
                        {sfStatus === "not_arrived" ? "未出勤" :
                         sfStatus === "working"     ? "勤務中" :
                         sfStatus === "on_break"    ? "休憩中" :
                         sfStatus === "clocked_out" ? "退勤済" :
                         sfStatus === "absent"      ? "欠勤"   : ""}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      </div>{/* flex コンテナ閉じ */}

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

      {/* ── 打刻モーダル ── */}
      {punchModal && (
        <PunchModal
          projectId={projectId}
          staffId={punchModal.staffId}
          staffName={punchModal.staffName}
          shiftStart={shiftTimeMap[punchModal.staffId]?.start ?? null}
          shiftEnd={shiftTimeMap[punchModal.staffId]?.end   ?? null}
          today={today}
          accountNumber={punchModal.accountNumber}
          section={punchModal.section}
          shiftName={punchModal.shiftName}
          breakSlotNumber={punchModal.breakSlotNumber}
          breakSlots={breakSlots}
          motaSlot={punchModal.motaSlot}
          isAdmin={isAdmin}
          showBreakEdit={isAdmin && embedded}
          onClose={() => setPunchModal(null)}
          onStatusChange={(sfId, newStatus) => {
            setStatuses(prev => {
              const next = new Map(prev);
              const s = newStatus as NonNullable<SeatData["status"]>;
              if (["working","clocked_out","on_break","seat_leave","absent","not_arrived"].includes(s)) {
                next.set(sfId, s);
              }
              return next;
            });
          }}
        />
      )}
    </div>
  );
}

// ── 経過時間タイマー（座席カード用・独立 re-render） ─────
function ElapsedTimer({ startISO, limitMin, isOvertime }: {
  startISO: string;
  limitMin: number | null;
  isOvertime: boolean;
}) {
  const [elapsed, setElapsed] = useState(() =>
    Math.floor((Date.now() - new Date(startISO).getTime()) / 1000)
  );
  useEffect(() => {
    const base = new Date(startISO).getTime();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - base) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startISO]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  const colorClass = isOvertime
    ? "text-red-700 dark:text-red-300"
    : limitMin !== null ? "text-amber-700 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400";
  return (
    <span className={`text-[9px] font-bold tabular-nums leading-none ${colorClass}`}>
      {m}:{String(s).padStart(2, "0")}
      {limitMin !== null && <span className="opacity-50 font-normal">/{limitMin}</span>}
    </span>
  );
}
