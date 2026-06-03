"use client";
import React, { useState, useMemo, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import StaffPopupMenu from "@/components/StaffPopupMenu";
import { sendBulkDepartureReminderAction, sendBulkWorkRequestAction, sendBulkFollowupReminderAction, changeAttendanceStatusAction, toggleChurnRiskAction, moveSectionAction } from "./actions";
import type { SendResult } from "./actions";
import SeatingClient, { type SeatData, type WallData, type StaffInfo } from "@/app/(portal)/seating/SeatingClient";
import HMotaPanel, { type MotaRow, type HMotaPanelRef } from "./HMotaPanel";
import type { MotaAssignment } from "./mota-actions";
import BreakManagementTab from "./BreakManagementTab";
import type { BreakSlotSetting, BreakSlotAssignment, BreakShortSetting, BreakRecord } from "@/app/(portal)/seating/break-actions";

// ── 型定義 ────────────────────────────────────────────────
export type StatusKey = "working" | "clocked_out" | "departed" | "absent" | "late" | "not_departed";

export type MemberRow = {
  staffId: string;
  name: string;
  accountNumber: string | null;
  section: string;
  status: StatusKey;
  clockIn: string | null;
  clockOut: string | null;
  departureTime: string | null;
  etaMinutes: number | null;
  absenceReason: string | null;
  absenceReportedAt: string | null;
  absenceNextDay: boolean | null;
  absenceDayAfter: boolean | null;
  lateReason: string | null;
  lateReportedAt: string | null;
  expectedArrival: string | null;
  churnRisk?: boolean;
  sections?: string[];
};

export type ChurnRiskAlert = {
  staffId: string;
  staffName: string;
  consecutiveDays: number;
};

export type ShiftGroup = {
  shiftName: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  members: MemberRow[];
};

export type SectionGroup = {
  section: string;
  shiftGroups: ShiftGroup[];
};

export type OffMember = {
  staffId: string;
  name: string;
  accountNumber: string | null;
  shiftName: string;
};

export type PunchSegment = {
  type: "working" | "break" | "seat_leave";
  start: string;
  end: string | null;
  note: string | null;
};

export type StaffTimeline = {
  staffId: string;
  clockIn: string | null;
  clockOut: string | null;
  segments: PunchSegment[];
};

export type ShiftChangeEntry = {
  staffId: string;
  staffName: string;
  accountNumber: string | null;
  action: string;
  beforeShift: string | null;
  afterShift: string | null;
  changedBy: string;
  changedByName: string;
  changedAt: string;
};

// ── セクション × 早番/遅番 カラーテーブル（ShiftEditGrid と統一）────────
type ShiftColorSet = { early: string; late: string; def: string };

/** 列コンテナ用：外枠ボーダー + ヘッダー背景 */
const SECTION_COL: Record<string, { border: string; headerBg: string }> = {
  "SV":       { border: "border-blue-200 dark:border-blue-800",      headerBg: "bg-blue-50 dark:bg-blue-950/50" },
  "査定":     { border: "border-emerald-200 dark:border-emerald-800", headerBg: "bg-emerald-50 dark:bg-emerald-950/50" },
  "販売":     { border: "border-orange-200 dark:border-orange-800",   headerBg: "bg-orange-50 dark:bg-orange-950/50" },
  "MOTA":     { border: "border-red-200 dark:border-red-800",         headerBg: "bg-red-50 dark:bg-red-950/50" },
  "リメイク": { border: "border-pink-200 dark:border-pink-800",       headerBg: "bg-pink-50 dark:bg-pink-950/50" },
  "ローン":   { border: "border-violet-200 dark:border-violet-800",   headerBg: "bg-violet-50 dark:bg-violet-950/50" },
};
const SECTION_COL_FALLBACK = { border: "border-sky-200 dark:border-sky-800", headerBg: "bg-sky-50 dark:bg-sky-950/50" };

/** カード用：背景 + ボーダー（早番=薄色、遅番=濃色） */
const SECTION_CARD: Record<string, ShiftColorSet> = {
  "SV":       { early: "bg-blue-50 border-blue-200 dark:bg-blue-950/60 dark:border-blue-800",            late: "bg-blue-100 border-blue-300 dark:bg-blue-900/50 dark:border-blue-700",           def: "bg-blue-50 border-blue-200 dark:bg-blue-950/50 dark:border-blue-800" },
  "査定":     { early: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-800", late: "bg-emerald-100 border-emerald-300 dark:bg-emerald-900/50 dark:border-emerald-700", def: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-800" },
  "販売":     { early: "bg-orange-50 border-orange-200 dark:bg-orange-950/60 dark:border-orange-800",     late: "bg-orange-100 border-orange-300 dark:bg-orange-900/50 dark:border-orange-700",    def: "bg-orange-50 border-orange-200 dark:bg-orange-950/50 dark:border-orange-800" },
  "MOTA":     { early: "bg-red-50 border-red-200 dark:bg-red-950/60 dark:border-red-800",                 late: "bg-red-100 border-red-300 dark:bg-red-900/50 dark:border-red-700",                def: "bg-red-50 border-red-200 dark:bg-red-950/50 dark:border-red-800" },
  "リメイク": { early: "bg-pink-50 border-pink-200 dark:bg-pink-950/60 dark:border-pink-800",             late: "bg-pink-100 border-pink-300 dark:bg-pink-900/50 dark:border-pink-700",             def: "bg-pink-50 border-pink-200 dark:bg-pink-950/50 dark:border-pink-800" },
  "ローン":   { early: "bg-violet-50 border-violet-200 dark:bg-violet-950/60 dark:border-violet-800",     late: "bg-violet-100 border-violet-300 dark:bg-violet-900/50 dark:border-violet-700",    def: "bg-violet-50 border-violet-200 dark:bg-violet-950/50 dark:border-violet-800" },
};
const SECTION_CARD_FALLBACK: ShiftColorSet = {
  early: "bg-sky-50 border-sky-200 dark:bg-sky-950/60 dark:border-sky-800",
  late:  "bg-sky-100 border-sky-300 dark:bg-sky-900/50 dark:border-sky-700",
  def:   "bg-sky-50 border-sky-200 dark:bg-sky-950/50 dark:border-sky-800",
};

/** セクションバッジ用カラー */
const SECTION_BADGE_COLOR: Record<string, string> = {
  "SV":       "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "査定":     "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "販売":     "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  "MOTA":     "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  "H MOTA":   "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "インフォ": "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  "未アポ":   "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  "ローン":   "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
};
const SECTION_BADGE_FALLBACK = "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300";

/** section + shiftName + shiftStart からカードの bg + border クラスを返す */
function getCardBg(section: string, shiftName: string, shiftStart: string | null): string {
  const entry = SECTION_CARD[section] ?? SECTION_CARD_FALLBACK;
  if (shiftName.includes("早番")) return entry.early;
  if (shiftName.includes("遅番")) return entry.late;
  const h = shiftStart ? parseInt(shiftStart.split(":")[0], 10) : null;
  if (h !== null && h < 12) return entry.early;
  if (h !== null && h >= 12) return entry.late;
  return entry.def;
}

// ── 休憩スロット用定数 ────────────────────────────────────
const BREAK_BADGE_CLASS: Record<number, string> = {
  1: "bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300",
  2: "bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300",
  3: "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300",
};
const BREAK_SLOT_LABEL: Record<number, string> = { 1: "①", 2: "②", 3: "③" };

// ── 定数 ──────────────────────────────────────────────────
const STATUS_LABEL: Record<StatusKey, string> = {
  working:      "勤務中",
  clocked_out:  "退勤済",
  departed:     "出発済",
  absent:       "欠勤",
  late:         "遅刻連絡",
  not_departed: "未出発",
};

const STATUS_COLOR: Record<StatusKey, string> = {
  working:      "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  clocked_out:  "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  departed:     "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  absent:       "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  late:         "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  not_departed: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
};

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

const REMINDER_MSG = "出発報告がまだのようです。遅刻なく到着できますでしょうか？遅刻がある場合は報告をお願いいたします。すでに出発している場合はアプリから報告をお願いします。";
const REQUEST_MSG  = "本日はお休みのところ恐れ入ります。急なご連絡で申し訳ございませんが、本日の出勤は可能でしょうか？ご確認いただけますと幸いです。";

// ── Props ─────────────────────────────────────────────────
interface Props {
  projectId: string;
  today: string;
  prevDate: string;
  nextDate: string;
  dateLabel: string;
  projectName: string;
  notClocked: number;
  grouped: SectionGroup[];
  offMembers: OffMember[];
  shiftRequired?: Record<string, number>;
  enableDeparture: boolean;
  publishedAt: string | null;
  shiftChanges: ShiftChangeEntry[];
  myStaffId: string;
  churnRiskAlerts?: ChurnRiskAlert[];
  seatData: SeatData[];
  wallData: WallData[];
  seatStaffList: StaffInfo[];
  motaAccountSlotRecord?: Record<string, string>;
  hMotaRows: MotaRow[];
  initialMotaAssignments: MotaAssignment[];
  breakSlots?: BreakSlotSetting[];
  breakAssignments?: BreakSlotAssignment[];
  breakShortSettings?: BreakShortSetting[];
  breakRecords?: BreakRecord[];
  punchTimelines?: StaffTimeline[];
}

type SelectionMode = "reminder" | "request" | "followup";
type ModalState = null | "confirm" | "sending" | "results";

// ── メインコンポーネント ──────────────────────────────────
export default function AttendanceClient({
  projectId, today, prevDate, nextDate, dateLabel, projectName,
  notClocked,
  grouped, offMembers, shiftRequired = {}, enableDeparture,
  publishedAt, shiftChanges,
  myStaffId, churnRiskAlerts,
  seatData, wallData, seatStaffList, motaAccountSlotRecord = {},
  hMotaRows, initialMotaAssignments,
  breakSlots = [], breakAssignments = [],
  breakShortSettings = [], breakRecords = [],
  punchTimelines = [],
}: Props) {
  const [activeTab, setActiveTab] = useState<"today" | "changes" | "seating" | "break">("today");

  // 休憩スロット割り当てマップ（staffId → slotNumber）
  const breakAssignmentMap: Record<string, number> = {};
  for (const a of breakAssignments) {
    breakAssignmentMap[a.staff_id] = a.slot_number;
  }
  // 休憩スロット番号 → 開始時刻（HH:MM）
  const breakSlotTimeMap: Record<number, string> = {};
  for (const s of breakSlots) {
    breakSlotTimeMap[s.slot_number] = s.start_time.slice(0, 5);
  }
  // 催促・依頼の選択（トグル式）
  const [selectedMode, setSelectedMode] = useState<SelectionMode | null>(null);
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());

  // 離脱リスクフラグのローカルオーバーライド（楽観的更新）
  const [churnRiskOverrides, setChurnRiskOverrides] = useState<Map<string, boolean>>(new Map());

  function getEffectiveChurnRisk(staffId: string, original: boolean | undefined): boolean {
    if (churnRiskOverrides.has(staffId)) return churnRiskOverrides.get(staffId)!;
    return original ?? false;
  }

  async function handleChurnRiskToggle(staffId: string, newValue: boolean) {
    setChurnRiskOverrides(prev => new Map(prev).set(staffId, newValue));
    const res = await toggleChurnRiskAction(projectId, staffId, newValue);
    if (!res.ok) {
      // 失敗したら元に戻す
      setChurnRiskOverrides(prev => {
        const next = new Map(prev);
        next.delete(staffId);
        return next;
      });
      throw new Error(res.error);
    }
  }

  // ステータス手動変更
  const [isPending, startTransition] = useTransition();
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Map<string, StatusKey>>(
    () => {
      const map = new Map<string, StatusKey>();
      grouped.flatMap(g => g.shiftGroups.flatMap(sg => sg.members))
        .forEach(m => map.set(m.staffId, m.status));
      return map;
    }
  );
  const [statusMenuId, setStatusMenuId] = useState<string | null>(null);
  const [staffMenu, setStaffMenu] = useState<{ staffId: string; staffName: string; churnRisk: boolean } | null>(null);
  const [detailMember, setDetailMember] = useState<MemberRow | null>(null);

  // 日付変更時にローカルオーバーライドをリセット（key={today} による remount の補完）
  useEffect(() => {
    const map = new Map<string, StatusKey>();
    grouped.flatMap(g => g.shiftGroups.flatMap(sg => sg.members))
      .forEach(m => map.set(m.staffId, m.status));
    setLocalStatuses(map);
    setSectionOverrides(new Map());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  // ── セクション間ドラッグ ──────────────────────────────────
  const [dragStaffId, setDragStaffId] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const [sectionOverrides, setSectionOverrides] = useState<Map<string, string>>(new Map());
  const hMotaPanelRef = useRef<HMotaPanelRef>(null);

  // ボード用：セクション×シフトグループ×メンバー（ドラッグオーバーライド反映）
  type BoardMember = MemberRow & { shiftName: string; shiftStart: string | null };
  type BoardGroup  = { shiftName: string; shiftStart: string | null; members: BoardMember[] };
  type BoardSection = { section: string; groups: BoardGroup[] };

  const boardSections = useMemo((): BoardSection[] => {
    const all: BoardMember[] = grouped.flatMap(({ section: sec, shiftGroups }) =>
      shiftGroups.flatMap(({ shiftName, shiftStart, members }) =>
        members.map(m => ({ ...m, shiftName, shiftStart }))
      )
    );
    // Key: "section|||shiftName"
    const shiftMap = new Map<string, { shiftStart: string | null; members: BoardMember[] }>();
    for (const m of all) {
      const sec = sectionOverrides.get(m.staffId) ?? m.section;
      const key = `${sec}|||${m.shiftName}`;
      if (!shiftMap.has(key)) shiftMap.set(key, { shiftStart: m.shiftStart, members: [] });
      shiftMap.get(key)!.members.push(m);
    }
    const sectionOrder: string[] = [];
    const seen = new Set<string>();
    for (const { section: sec } of grouped) {
      if (!seen.has(sec)) { seen.add(sec); sectionOrder.push(sec); }
    }
    return sectionOrder.map(sec => {
      const groups: BoardGroup[] = [];
      for (const [key, val] of shiftMap) {
        const sepIdx = key.indexOf("|||");
        if (key.slice(0, sepIdx) === sec) {
          const getAccNum = (acct: string | null) => parseInt((acct ?? "").replace(/\D/g, "")) || 9999;
          const sortedMembers = [...val.members].sort((a, b) => getAccNum(a.accountNumber) - getAccNum(b.accountNumber));
          groups.push({ shiftName: key.slice(sepIdx + 3), shiftStart: val.shiftStart, members: sortedMembers });
        }
      }
      // 開始時刻昇順（早番→遅番）
      groups.sort((a, b) => {
        if (!a.shiftStart && !b.shiftStart) return a.shiftName.localeCompare(b.shiftName, "ja");
        if (!a.shiftStart) return 1;
        if (!b.shiftStart) return -1;
        return a.shiftStart.localeCompare(b.shiftStart);
      });
      return { section: sec, groups };
    });
  }, [grouped, sectionOverrides]);

  async function handleHMotaColumnDrop(e: React.DragEvent) {
    const raw = e.dataTransfer.getData("mota-card");
    setDragStaffId(null);
    setDragOverSection(null);
    if (!raw) return;
    let card: { name: string; accountNumber?: string };
    try { card = JSON.parse(raw); } catch { return; }
    if (!card.name) return;
    const result = await hMotaPanelRef.current?.dropStaffCard(card.name, card.accountNumber || null);
    if (result === "ok") {
      setStatusToast("H MOTAに複製配置しました");
      setTimeout(() => setStatusToast(null), 2500);
    } else if (result === "full") {
      setStatusToast("⚠️ H MOTAのスロットが全て埋まっています");
      setTimeout(() => setStatusToast(null), 3000);
    }
  }

  function handleSectionDrop(targetSection: string) {
    if (!dragStaffId) return;
    // H MOTAへのセクション移動は複製配置に変換（シフト変更なし）
    if (targetSection === "H MOTA" || targetSection === "H　MOTA") {
      const member = grouped
        .flatMap(g => g.shiftGroups.flatMap(sg => sg.members))
        .find(m => m.staffId === dragStaffId);
      setDragStaffId(null);
      setDragOverSection(null);
      if (member) {
        hMotaPanelRef.current?.dropStaffCard(member.name, member.accountNumber ?? null).then(result => {
          if (result === "ok") {
            setStatusToast("H MOTAに複製配置しました");
            setTimeout(() => setStatusToast(null), 2500);
          } else if (result === "full") {
            setStatusToast("⚠️ H MOTAのスロットが全て埋まっています");
            setTimeout(() => setStatusToast(null), 3000);
          }
        });
      }
      return;
    }

    const staffId = dragStaffId;
    const origSec = grouped
      .flatMap(g => g.shiftGroups.flatMap(sg => sg.members))
      .find(m => m.staffId === staffId)?.section ?? "";

    setDragStaffId(null);
    setDragOverSection(null);

    if (origSec === targetSection) return; // 同じセクションなら何もしない

    // 楽観的に画面に反映
    setSectionOverrides(prev => new Map(prev).set(staffId, targetSection));

    // DBへ即時反映（確定ボタン不要）
    moveSectionAction(projectId, staffId, today, targetSection).then(res => {
      if (!res.ok) {
        // 失敗したら元に戻す
        setSectionOverrides(prev => {
          const next = new Map(prev);
          next.delete(staffId);
          return next;
        });
        setStatusToast(`移動できませんでした: ${res.error}`);
        setTimeout(() => setStatusToast(null), 4000);
      } else {
        setStatusToast(`${targetSection}へ移動しました`);
        setTimeout(() => setStatusToast(null), 2500);
      }
    });
  }

  function handleSectionRevert(staffId: string, originalSection: string) {
    setSectionOverrides(prev => {
      const next = new Map(prev);
      next.delete(staffId);
      return next;
    });
    // DBも元のセクションに戻す
    moveSectionAction(projectId, staffId, today, originalSection).then(res => {
      if (!res.ok) {
        setStatusToast(`元に戻せませんでした: ${res.error}`);
        setTimeout(() => setStatusToast(null), 4000);
      }
    });
  }

  function handleStatusChange(staffId: string, newStatus: StatusKey) {
    setStatusMenuId(null);
    startTransition(async () => {
      const res = await changeAttendanceStatusAction(projectId, staffId, today, newStatus);
      if (!res.ok) {
        setStatusToast(`エラー: ${res.error}`);
        setTimeout(() => setStatusToast(null), 4000);
        return;
      }
      setLocalStatuses(prev => new Map(prev).set(staffId, newStatus));
      setStatusToast("ステータスを変更しました");
      setTimeout(() => setStatusToast(null), 2500);
    });
  }

  function toggleReminder(staffId: string, mode: SelectionMode) {
    if (selectedMode !== null && selectedMode !== mode) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(staffId)) next.delete(staffId); else next.add(staffId);
      if (next.size === 0) setSelectedMode(null); else setSelectedMode(mode);
      return next;
    });
  }

  // モーダル
  const [modalState, setModalState]   = useState<ModalState>(null);
  const [pendingSend, setPendingSend] = useState<{ staffIds: string[]; mode: SelectionMode } | null>(null);
  const [sendResults, setSendResults] = useState<SendResult[]>([]);

  // 全メンバーの名前引きマップ
  const memberLookup = useMemo(() => {
    const map = new Map<string, { name: string; accountNumber: string | null }>();
    grouped.flatMap(g => g.shiftGroups.flatMap(sg => sg.members))
      .forEach(m => map.set(m.staffId, { name: m.name, accountNumber: m.accountNumber }));
    offMembers.forEach(m => map.set(m.staffId, { name: m.name, accountNumber: m.accountNumber }));
    return map;
  }, [grouped, offMembers]);

  function toggleSelect(staffId: string, mode: SelectionMode) {
    if (selectedMode !== null && selectedMode !== mode) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(staffId)) next.delete(staffId); else next.add(staffId);
      if (next.size === 0) setSelectedMode(null); else setSelectedMode(mode);
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); setSelectedMode(null); }

  function openConfirm(staffIds: string[], mode: SelectionMode) {
    setPendingSend({ staffIds, mode });
    setModalState("confirm");
  }

  async function handleSend() {
    if (!pendingSend) return;
    setModalState("sending");
    const { staffIds, mode } = pendingSend;
    const { results } = mode === "reminder"
      ? await sendBulkDepartureReminderAction(projectId, staffIds)
      : mode === "followup"
      ? await sendBulkFollowupReminderAction(projectId, staffIds)
      : await sendBulkWorkRequestAction(projectId, staffIds);
    setSendResults(results);
    setModalState("results");
    clearSelection();
  }

  const confirmMembers = (pendingSend?.staffIds ?? [])
    .map(id => memberLookup.get(id) ?? { name: id, accountNumber: null });
  const confirmMsg = pendingSend?.mode === "reminder"
    ? `【出発確認】{名前}さん、${REMINDER_MSG}`
    : `【出勤依頼】{名前}さん、${REQUEST_MSG}`;

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 pt-5 pb-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">当日状況</h1>
                {notClocked > 0 && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500 text-white tabular-nums">
                    未打刻 {notClocked}名
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-zinc-400 mt-0.5">{projectName}</p>
            </div>
          </div>
        </div>
        {/* タブ */}
        <div className="max-w-6xl mx-auto px-4 pb-1 flex gap-1">
          <button
            onClick={() => setActiveTab("today")}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === "today"
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            出勤簿
          </button>
          <button
            onClick={() => setActiveTab("changes")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === "changes"
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            確定後変更
            {shiftChanges.length > 0 && (
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
                activeTab === "changes"
                  ? "bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900"
                  : "bg-red-500 text-white"
              }`}>
                {shiftChanges.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("seating")}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === "seating"
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            座席表
          </button>
          <button
            onClick={() => setActiveTab("break")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === "break"
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            休憩管理
            {breakAssignments.length > 0 && (
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
                activeTab === "break"
                  ? "bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900"
                  : "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300"
              }`}>
                {breakAssignments.length}
              </span>
            )}
          </button>
        </div>
        {/* 日付ナビ + タブ別アクション */}
        <div className="max-w-6xl mx-auto px-4 pb-2 flex items-center gap-2">
          <div className="flex-1">
            <DateNav prevDate={prevDate} nextDate={nextDate} dateLabel={dateLabel} noMargin />
          </div>
          {activeTab === "today" && (
            <button
              type="button"
              onClick={() => exportAttendanceXLSX(today, dateLabel, grouped, localStatuses)}
              className="flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shadow-sm"
            >
              <DownloadIcon className="w-3.5 h-3.5" />
              出力
            </button>
          )}
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 pt-4 pb-32">

        {/* ── 確定後変更タブ ── */}
        {activeTab === "changes" && (
          <div>
            <ShiftChangesTab
              publishedAt={publishedAt}
              shiftChanges={shiftChanges}
              grouped={grouped}
            />
          </div>
        )}

        {/* ── 座席表タブ ── */}
        {activeTab === "seating" && (
          <div>
            <SeatingClient
              projectId={projectId}
              today={today}
              seats={seatData}
              walls={wallData}
              isAdmin={true}
              myStaffId={myStaffId}
              staffList={seatStaffList}
              breakAssignmentMap={breakAssignmentMap}
              breakSlots={breakSlots}
              motaAccountSlotRecord={motaAccountSlotRecord}
              embedded
            />
          </div>
        )}

        {/* ── 休憩管理タブ ── */}
        {activeTab === "break" && (
          <div>
            <BreakManagementTab
              projectId={projectId}
              today={today}
              breakSlots={breakSlots}
              breakAssignments={breakAssignments}
              breakShortSettings={breakShortSettings}
              breakRecords={breakRecords}
              punchTimelines={punchTimelines}
              grouped={grouped}
            />
          </div>
        )}

        {/* ── 休憩スロット凡例 ── */}
        {activeTab === "today" && breakSlots.length > 0 && Object.keys(breakAssignmentMap).length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 px-1">
            {breakSlots.map(slot => (
              <div key={slot.slot_number} className="flex items-center gap-1.5">
                <span className={`w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold ${BREAK_BADGE_CLASS[slot.slot_number] ?? ""}`}>
                  {BREAK_SLOT_LABEL[slot.slot_number]}
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                  {slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── 離脱リスク候補アラート ── */}
        {activeTab === "today" && (churnRiskAlerts?.length ?? 0) > 0 && (
          <div className="mb-3 px-4 py-3 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
            <p className="text-xs font-bold text-red-700 dark:text-red-300 mb-1.5">⚠ 離脱リスク候補</p>
            <div className="space-y-1">
              {churnRiskAlerts!.map(a => (
                <p key={a.staffId} className="text-xs text-red-600 dark:text-red-400">
                  <span className="font-semibold">{a.staffName}</span>
                  <span className="ml-1 text-red-400">— {a.consecutiveDays}日連続欠勤</span>
                </p>
              ))}
            </div>
            <p className="text-[10px] text-red-400 mt-2">スタッフ設定で「離脱リスク」フラグをONにしてください</p>
          </div>
        )}

        {/* ── 出勤簿タブ（セクション横並びボード） ── */}
        {activeTab === "today" && grouped.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-10">本日の出勤予定者はいません</p>
        ) : activeTab === "today" && (
          <div className="overflow-x-auto -mx-4 px-4">
            <div className="flex gap-3 pb-4 items-start" style={{ minWidth: "max-content" }}>
              {boardSections.map(({ section, groups }) => {
                const allMembers = groups.flatMap(g => g.members);
                const isDragTarget = dragOverSection === section;
                const secCol = SECTION_COL[section] ?? SECTION_COL_FALLBACK;

                // H MOTA セクション：スロット配置パネルをカラム内に表示
                if (section === "H MOTA" || section === "H　MOTA") {
                  const isHMotaDragTarget = dragStaffId !== null;
                  return (
                    <div
                      key={section}
                      className={[
                        "flex flex-col rounded-2xl border-2 shrink-0 transition-all",
                        "h-[calc(100dvh-280px)] w-80",
                        isHMotaDragTarget
                          ? "border-purple-400 bg-purple-50/50 dark:bg-purple-950/30 shadow-lg"
                          : "border-purple-200 dark:border-purple-800 bg-white dark:bg-zinc-900",
                      ].join(" ")}
                      onDragOver={e => { e.preventDefault(); }}
                      onDrop={handleHMotaColumnDrop}
                    >
                      <div className="px-3 pt-2.5 pb-2 border-b shrink-0 rounded-t-2xl bg-purple-50 dark:bg-purple-950/30 border-b-purple-200 dark:border-b-purple-800">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-purple-800 dark:text-purple-100">H MOTA</span>
                          <span className="text-[10px] font-semibold text-purple-400">
                            {isHMotaDragTarget ? "ドロップで複製配置" : "スロット配置"}
                          </span>
                        </div>
                        {/* 他セクションと高さ揃え用スペーサー */}
                        <div style={{ minHeight: "38px" }} />
                      </div>
                      <HMotaPanel
                        ref={hMotaPanelRef}
                        projectId={projectId}
                        date={today}
                        rows={hMotaRows}
                        initialAssignments={initialMotaAssignments}
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={section}
                    className={[
                      "flex flex-col rounded-2xl border-2 transition-all w-72 shrink-0",
                      "h-[calc(100dvh-280px)]",
                      isDragTarget
                        ? "border-blue-400 bg-blue-50 dark:bg-blue-950/20 shadow-lg"
                        : `${secCol.border} bg-white dark:bg-zinc-900`,
                    ].join(" ")}
                    onDragOver={e => { e.preventDefault(); setDragOverSection(section); }}
                    onDragLeave={e => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node))
                        setDragOverSection(null);
                    }}
                    onDrop={() => handleSectionDrop(section)}
                  >
                    {/* カラムヘッダー（固定） */}
                    {(() => {
                      const totalRequired    = groups.reduce((s, g) => s + (shiftRequired[g.shiftName] ?? 0), 0);
                      const totalAssigned    = allMembers.length;
                      const totalSufficiency = totalRequired > 0 ? totalAssigned - totalRequired : null;
                      const getSt = (m: { staffId: string; status: StatusKey }) => localStatuses.get(m.staffId) ?? m.status;
                      const totalClockedIn   = allMembers.filter(m => { const s = getSt(m); return s === "working" || s === "clocked_out"; }).length;
                      const totalLate        = allMembers.filter(m => getSt(m) === "late").length;
                      const totalAbsent      = allMembers.filter(m => getSt(m) === "absent").length;
                      const totalNotPresent  = totalAssigned - totalClockedIn - totalLate - totalAbsent;
                      const suffixFmt = (suf: number | null) => suf === null ? null : suf > 0 ? `+${suf}` : String(suf);
                      const sufColor  = (suf: number | null) => suf === null ? "" : suf > 0 ? "text-blue-500 dark:text-blue-400" : suf < 0 ? "text-red-500 dark:text-red-400" : "text-emerald-500";
                      return (
                      <div className={`px-3 pt-2.5 pb-2 border-b shrink-0 rounded-t-2xl ${secCol.headerBg} ${secCol.border.replace("border-", "border-b-")}`}>

                        {/* セクション名行：配置/規定（充足）出勤 遅刻 欠勤 未出勤 */}
                        <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 tabular-nums">
                          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100 shrink-0">{section}</span>
                          <span className="text-xs text-zinc-600 dark:text-zinc-300">{totalAssigned}</span>
                          {totalRequired > 0 && (
                            <>
                              <span className="text-xs text-zinc-400">/{totalRequired}</span>
                              <span className={`text-xs font-bold ${sufColor(totalSufficiency)}`}>（{suffixFmt(totalSufficiency)}）</span>
                            </>
                          )}
                          <span className={`text-[11px] font-bold ${totalClockedIn > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>出{totalClockedIn}</span>
                          {totalLate > 0 && <span className="text-[11px] font-bold text-amber-500 dark:text-amber-400">遅{totalLate}</span>}
                          {totalAbsent > 0 && <span className="text-[11px] font-bold text-red-500 dark:text-red-400">欠{totalAbsent}</span>}
                          {totalNotPresent > 0 && <span className="text-[11px] text-zinc-400 dark:text-zinc-500">未{totalNotPresent}</span>}
                        </div>

                        {/* 早番/遅番 内訳（査定・販売のみ）+ 高さ合わせスペーサー */}
                        <div className="mt-1 pl-1" style={{ minHeight: "38px" }}>
                          {(section === "査定" || section === "販売") && (
                            <div className="space-y-0.5">
                              {groups.map(({ shiftName, members: grpMembers }) => {
                                const grpAssigned   = grpMembers.length;
                                const grpRequired   = shiftRequired[shiftName] ?? 0;
                                const grpSuf        = grpRequired > 0 ? grpAssigned - grpRequired : null;
                                const grpClockedIn  = grpMembers.filter(m => { const s = getSt(m); return s === "working" || s === "clocked_out"; }).length;
                                const grpLate       = grpMembers.filter(m => getSt(m) === "late").length;
                                const grpAbsent     = grpMembers.filter(m => getSt(m) === "absent").length;
                                const grpNotPresent = grpAssigned - grpClockedIn - grpLate - grpAbsent;
                                const label         = shiftName.includes("早") ? "早番" : shiftName.includes("遅") ? "遅番" : shiftName;
                                return (
                                  <div key={shiftName} className="flex items-center flex-wrap gap-x-1 gap-y-0 tabular-nums">
                                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400 w-7 shrink-0">{label}</span>
                                    <span className="text-[10px] text-zinc-600 dark:text-zinc-300">{grpAssigned}</span>
                                    {grpRequired > 0 && (
                                      <>
                                        <span className="text-[10px] text-zinc-400">/{grpRequired}</span>
                                        <span className={`text-[10px] font-bold ${sufColor(grpSuf)}`}>（{suffixFmt(grpSuf)}）</span>
                                      </>
                                    )}
                                    <span className={`text-[10px] font-bold ${grpClockedIn > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>出{grpClockedIn}</span>
                                    {grpLate > 0   && <span className="text-[10px] font-bold text-amber-500">遅{grpLate}</span>}
                                    {grpAbsent > 0 && <span className="text-[10px] font-bold text-red-500">欠{grpAbsent}</span>}
                                    {grpNotPresent > 0 && <span className="text-[10px] text-zinc-400 dark:text-zinc-500">未{grpNotPresent}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      );
                    })()}

                    {/* メンバーカード一覧（独立スクロール・スクロールバー非表示） */}
                    <div
                      className="flex flex-col gap-1.5 p-2 overflow-y-auto flex-1 min-h-0 [&::-webkit-scrollbar]:hidden"
                      style={{ scrollbarWidth: "none" }}
                    >
                      {groups.map(({ shiftName, members }, gi) => {
                        return (
                        <React.Fragment key={shiftName}>
                          {/* 複数シフトグループがある場合のみサブヘッダー（シフト名のみ） */}
                          {groups.length > 1 && (
                            <div className={`flex items-center gap-1.5 ${gi > 0 ? "mt-1" : ""}`}>
                              <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 shrink-0">
                                {shiftName}
                              </span>
                              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
                            </div>
                          )}
                      {members.map(m => {
                        const currentStatus = localStatuses.get(m.staffId) ?? m.status;
                        const isMenuOpen = statusMenuId === m.staffId;
                        const effectiveChurnRisk = getEffectiveChurnRisk(m.staffId, m.churnRisk);
                        const isMoved = sectionOverrides.has(m.staffId);
                        const isDragging = dragStaffId === m.staffId;
                        const canRemind = (enableDeparture && currentStatus === "not_departed") || currentStatus === "late";
                        const isSelected = selectedIds.has(m.staffId);

                        return (
                          <div
                            key={m.staffId}
                            draggable
                            onDragStart={e => {
                              setDragStaffId(m.staffId);
                              if (m.accountNumber) {
                                e.dataTransfer.setData("mota-card", JSON.stringify({
                                  accountNumber: m.accountNumber,
                                  name: m.name,
                                  isFixed: false,
                                }));
                              }
                            }}
                            onDragEnd={() => { setDragStaffId(null); setDragOverSection(null); }}
                            className={[
                              "rounded-lg border px-2 py-1.5 cursor-grab active:cursor-grabbing select-none transition-all",
                              isDragging ? "opacity-40 scale-95" : "",
                              currentStatus === "absent"
                                ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30"
                                : isMoved
                                ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20"
                                : getCardBg(section, m.shiftName, m.shiftStart),
                            ].join(" ")}
                          >
                            {/* 2列グリッド: Col1=AccNum(auto幅), Col2=コンテンツ(1fr) */}
                            <div className="grid gap-x-2 gap-y-1" style={{ gridTemplateColumns: "auto 1fr" }}>
                              {/* Row 1 Col 1: アカウント番号 */}
                              <span className="text-[10px] font-mono text-zinc-400 tabular-nums whitespace-nowrap self-center leading-none">
                                {m.accountNumber ?? "—"}
                              </span>
                              {/* Row 1 Col 2: 名前 + セクションバッジ（複数対応） */}
                              <div className="flex items-center gap-1 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => setStaffMenu({ staffId: m.staffId, staffName: m.name, churnRisk: effectiveChurnRisk })}
                                  className="flex-1 min-w-0 text-left"
                                >
                                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate block leading-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                                    {m.name}
                                  </span>
                                </button>
                                {(m.sections && m.sections.length > 0
                                  ? [...new Set(m.sections)]
                                  : [m.section]
                                ).map(sec => (
                                  <span key={sec} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0 ${SECTION_BADGE_COLOR[sec] ?? SECTION_BADGE_FALLBACK}`}>
                                    {sec}
                                  </span>
                                ))}
                              </div>

                              {/* Row 2 Col 1: spacer */}
                              <div />
                              {/* Row 2 Col 2: 休憩時間 | 打刻ステータス | 勤怠ステータス（全要素同サイズ） */}
                              <div className="flex items-center gap-1">
                                {breakAssignmentMap[m.staffId] && (
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded leading-none shrink-0 ${BREAK_BADGE_CLASS[breakAssignmentMap[m.staffId]] ?? ""}`}>
                                    {BREAK_SLOT_LABEL[breakAssignmentMap[m.staffId]] ?? ""}
                                    {breakSlotTimeMap[breakAssignmentMap[m.staffId]]
                                      ? `${breakSlotTimeMap[breakAssignmentMap[m.staffId]]}～`
                                      : ""}
                                  </span>
                                )}
                                <span className={[
                                  "text-[10px] font-bold px-1.5 py-0.5 rounded leading-none shrink-0",
                                  m.clockIn
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                    : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
                                ].join(" ")}>
                                  {m.clockIn ? "打刻済" : "打刻未"}
                                </span>
                                <div className="relative shrink-0 ml-auto">
                                  <button
                                    onClick={e => { e.stopPropagation(); setStatusMenuId(isMenuOpen ? null : m.staffId); }}
                                    className={[
                                      "text-[10px] font-bold px-1.5 py-0.5 rounded leading-none whitespace-nowrap",
                                      STATUS_COLOR[currentStatus],
                                      isPending ? "opacity-50" : "",
                                    ].join(" ")}
                                  >
                                    {(!enableDeparture && currentStatus === "not_departed") ? "未出勤" : STATUS_LABEL[currentStatus]} ▾
                                  </button>
                                  {isMenuOpen && (
                                    <StatusMenu
                                      current={currentStatus}
                                      onSelect={s => handleStatusChange(m.staffId, s)}
                                      onClose={() => setStatusMenuId(null)}
                                      enableDeparture={enableDeparture}
                                    />
                                  )}
                                </div>
                              </div>

                              {/* Row 3（条件付き）: アクションバッジ */}
                              {(currentStatus === "absent" || currentStatus === "late" || canRemind || isMoved) && (
                                <>
                                  <div />
                                  <div className="flex flex-wrap items-center gap-1">
                                    {currentStatus === "absent" && (
                                      <>
                                        <button type="button" onClick={() => toggleSelect(m.staffId, "followup")}
                                          className={[
                                            "text-[9px] font-bold px-1.5 py-0.5 rounded-full border leading-none transition-colors",
                                            selectedIds.has(m.staffId) && selectedMode === "followup"
                                              ? "bg-red-600 text-white border-red-600"
                                              : "bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800",
                                          ].join(" ")}>
                                          {selectedIds.has(m.staffId) && selectedMode === "followup" ? "✓ 催促選択中" : "経過報告催促"}
                                        </button>
                                        <button type="button" onClick={() => setDetailMember(m)}
                                          className="text-[9px] text-red-400 underline leading-none truncate max-w-[100px]">
                                          {m.absenceReason || "欠勤"}詳細
                                        </button>
                                      </>
                                    )}
                                    {currentStatus === "late" && (
                                      <button type="button" onClick={() => setDetailMember(m)}
                                        className="text-[9px] text-amber-500 underline leading-none truncate max-w-[120px]">
                                        {m.lateReason || "遅刻連絡"}詳細
                                      </button>
                                    )}
                                    {canRemind && (
                                      <button type="button" onClick={() => toggleSelect(m.staffId, "reminder")}
                                        className={[
                                          "text-[9px] font-bold px-1.5 py-0.5 rounded-full border leading-none transition-colors",
                                          isSelected
                                            ? "bg-blue-600 text-white border-blue-600"
                                            : "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800",
                                        ].join(" ")}>
                                        {isSelected ? "✓ 催促選択中" : "催促"}
                                      </button>
                                    )}
                                    {isMoved && (
                                      <>
                                        <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400">← 移動</span>
                                        <button type="button"
                                          onClick={e => { e.stopPropagation(); handleSectionRevert(m.staffId, m.section); }}
                                          className="text-[9px] text-zinc-400 hover:text-zinc-600 underline">
                                          元に戻す
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                        </React.Fragment>
                        );
                      })}

                      {/* 空のドロップゾーン */}
                      {allMembers.length === 0 && (
                        <div className={[
                          "flex-1 flex items-center justify-center py-6 rounded-xl border-2 border-dashed text-xs transition-colors",
                          isDragTarget
                            ? "border-blue-400 text-blue-400"
                            : "border-zinc-200 dark:border-zinc-700 text-zinc-300 dark:text-zinc-600",
                        ].join(" ")}>
                          ここにドロップ
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* まとめて送るアクションバー */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-24 inset-x-0 flex justify-center z-40 px-4 pointer-events-none">
          <div className="bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 pointer-events-auto w-full max-w-md">
            <span className="text-sm font-semibold flex-1 tabular-nums">
              {selectedIds.size}名を選択中
            </span>
            <button onClick={clearSelection} className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-200 dark:hover:text-zinc-700">
              解除
            </button>
            <button
              onClick={() => openConfirm(Array.from(selectedIds), selectedMode!)}
              className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm font-bold px-4 py-1.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {selectedMode === "reminder" ? `${selectedIds.size}名にまとめて催促する` : selectedMode === "followup" ? `${selectedIds.size}名に経過報告催促する` : `${selectedIds.size}名にまとめて依頼する`} →
            </button>
          </div>
        </div>
      )}

      {/* 確認 / 送信中 / 結果モーダル */}
      {modalState !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md shadow-2xl max-h-[80vh] flex flex-col">

            {modalState === "sending" && (
              <div className="p-10 text-center">
                <div className="animate-spin w-8 h-8 border-2 border-zinc-300 border-t-blue-600 rounded-full mx-auto mb-3" />
                <p className="text-sm text-zinc-500">送信中...</p>
              </div>
            )}

            {modalState === "results" && (
              <>
                <div className="px-5 pt-5 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                  <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">送信完了</h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    成功 {sendResults.filter(r => r.ok).length} / 失敗 {sendResults.filter(r => !r.ok).length}
                  </p>
                </div>
                <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
                  {sendResults.map(r => (
                    <div key={r.staffId} className="flex items-center gap-2 text-sm">
                      <span className={`font-bold ${r.ok ? "text-green-500" : "text-red-400"}`}>{r.ok ? "✓" : "✗"}</span>
                      <span className={`font-semibold ${r.ok ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-400"}`}>{r.name}</span>
                      {!r.ok && <span className="text-xs text-red-400">{r.error}</span>}
                    </div>
                  ))}
                </div>
                <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800">
                  <button onClick={() => setModalState(null)} className="w-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold py-2.5 rounded-xl hover:bg-zinc-700 transition-colors">
                    閉じる
                  </button>
                </div>
              </>
            )}

            {modalState === "confirm" && (
              <>
                <div className="px-5 pt-5 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                  <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    {pendingSend?.mode === "reminder" ? "出発催促を送信" : pendingSend?.mode === "followup" ? "経過報告催促を送信" : "出勤依頼を送信"}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">{confirmMembers.length}名に送信します</p>
                </div>
                <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
                  <p className="text-xs font-semibold text-zinc-400 mb-1.5">送信内容</p>
                  <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {confirmMsg}
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 px-5 py-3">
                  <p className="text-xs font-semibold text-zinc-400 mb-2">送信対象</p>
                  <div className="space-y-1.5">
                    {confirmMembers.map((m, i) => (
                      <div key={pendingSend!.staffIds[i]} className="flex items-baseline gap-1.5 text-sm">
                        <span className="text-xs font-mono text-zinc-400">{m.accountNumber ?? pendingSend!.staffIds[i]}</span>
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200">{m.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex gap-3">
                  <button
                    onClick={() => setModalState(null)}
                    className="flex-1 border border-zinc-200 dark:border-zinc-700 text-sm font-semibold py-2.5 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-zinc-700 dark:text-zinc-300"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleSend}
                    className="flex-1 bg-blue-600 text-white text-sm font-bold py-2.5 rounded-xl hover:bg-blue-700 transition-colors"
                  >
                    送信する
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ステータス変更トースト */}
      {statusToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-lg whitespace-nowrap">
          {statusToast}
        </div>
      )}

      {/* 欠勤 / 遅刻 詳細モーダル */}
      {detailMember && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4"
          onClick={() => setDetailMember(null)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <div>
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">{detailMember.name}</p>
                {detailMember.accountNumber && (
                  <p className="text-xs font-mono text-zinc-400 mt-0.5">{detailMember.accountNumber}</p>
                )}
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-lg ${STATUS_COLOR[detailMember.status]}`}>
                {STATUS_LABEL[detailMember.status]}
              </span>
            </div>

            {/* 内容 */}
            <div className="px-5 py-4 space-y-3">
              {/* 欠勤報告 */}
              {detailMember.status === "absent" && (
                <>
                  <DetailRow label="報告時刻">
                    {detailMember.absenceReportedAt
                      ? fmtTime(detailMember.absenceReportedAt)
                      : "—"}
                  </DetailRow>
                  <DetailRow label="欠勤理由">
                    {detailMember.absenceReason || "—"}
                  </DetailRow>
                  {detailMember.absenceNextDay !== null && (
                    <DetailRow label="翌日出勤">
                      <span className={detailMember.absenceNextDay
                        ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                        : "text-red-500 dark:text-red-400 font-semibold"}>
                        {detailMember.absenceNextDay ? "出勤可" : "欠勤予定"}
                      </span>
                    </DetailRow>
                  )}
                  {detailMember.absenceDayAfter !== null && (
                    <DetailRow label="翌々日出勤">
                      <span className={detailMember.absenceDayAfter
                        ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                        : "text-red-500 dark:text-red-400 font-semibold"}>
                        {detailMember.absenceDayAfter ? "出勤可" : "欠勤予定"}
                      </span>
                    </DetailRow>
                  )}
                </>
              )}
              {/* 遅刻報告 */}
              {detailMember.status === "late" && (
                <>
                  <DetailRow label="報告時刻">
                    {detailMember.lateReportedAt
                      ? fmtTime(detailMember.lateReportedAt)
                      : "—"}
                  </DetailRow>
                  <DetailRow label="遅刻理由">
                    {detailMember.lateReason || "—"}
                  </DetailRow>
                  {detailMember.expectedArrival && (
                    <DetailRow label="到着目安">
                      {detailMember.expectedArrival.slice(0, 5)}
                    </DetailRow>
                  )}
                </>
              )}
            </div>

            {/* フッター */}
            <div className="px-5 pb-5">
              <button
                type="button"
                onClick={() => setDetailMember(null)}
                className="w-full py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {staffMenu && (
        <StaffPopupMenu
          staffId={staffMenu.staffId}
          staffName={staffMenu.staffName}
          projectId={projectId}
          onClose={() => setStaffMenu(null)}
          churnRisk={staffMenu.churnRisk}
          onChurnRiskToggle={async (value) => {
            await handleChurnRiskToggle(staffMenu.staffId, value);
          }}
        />
      )}
    </main>
  );
}

// ── 詳細行コンポーネント ──────────────────────────────────────
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="flex-shrink-0 w-20 text-zinc-400">{label}</span>
      <span className="flex-1 text-zinc-800 dark:text-zinc-100 break-all">{children}</span>
    </div>
  );
}

// ── ステータス変更メニュー ──────────────────────────────────
const ALL_STATUSES: StatusKey[] = ["not_departed", "departed", "working", "clocked_out", "late", "absent"];

function StatusMenu({ current, onSelect, onClose, enableDeparture }: {
  current: StatusKey;
  onSelect: (s: StatusKey) => void;
  onClose: () => void;
  enableDeparture: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const statuses = enableDeparture
    ? ALL_STATUSES
    : ALL_STATUSES.filter(s => s !== "departed");

  function getLabel(s: StatusKey): string {
    if (!enableDeparture && s === "not_departed") return "未出勤";
    return STATUS_LABEL[s];
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl overflow-hidden min-w-[110px]"
    >
      {statuses.map(s => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          className={`w-full text-left px-3 py-2 text-xs font-semibold transition-colors flex items-center gap-2 ${
            s === current
              ? "bg-zinc-100 dark:bg-zinc-700"
              : "hover:bg-zinc-50 dark:hover:bg-zinc-700/50"
          }`}
        >
          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_COLOR[s]}`}>
            {getLabel(s)}
          </span>
          {s === current && <span className="text-zinc-400 text-[10px]">現在</span>}
        </button>
      ))}
    </div>
  );
}

// ── サブコンポーネント ──────────────────────────────────────

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

// ── 日付ナビゲーション（各タブ内に配置） ──────────────────────
function DateNav({ prevDate, nextDate, dateLabel, noMargin }: { prevDate: string; nextDate: string; dateLabel: string; noMargin?: boolean }) {
  const router = useRouter();
  return (
    <div className={`flex items-center justify-between ${noMargin ? "" : "mb-4"} bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 rounded-xl px-3 py-2 shadow-sm`}>
      <button
        type="button"
        onClick={() => router.push(`/attendance?date=${prevDate}`)}
        className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        aria-label="前日"
      >
        <ChevronLeft className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
      </button>
      <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">{dateLabel}</span>
      <button
        type="button"
        onClick={() => router.push(`/attendance?date=${nextDate}`)}
        className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        aria-label="翌日"
      >
        <ChevronRight className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
      </button>
    </div>
  );
}

// ── 確定後変更タブ（セクション別・アカウント番号順・確定版vs当日版） ──
function ShiftChangesTab({
  publishedAt,
  shiftChanges,
  grouped,
}: {
  publishedAt: string | null;
  shiftChanges: ShiftChangeEntry[];
  grouped: SectionGroup[];
}) {
  if (!publishedAt) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm font-semibold text-zinc-400">シフトが未展開です</p>
        <p className="text-xs text-zinc-400 mt-1">展開後の変更がここに表示されます</p>
      </div>
    );
  }

  const fmtPublished = new Date(publishedAt).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  // 現在のシフト状態マップ（grouped から展開）
  type CurrentInfo = { shiftName: string; section: string; accountNumber: string | null; staffName: string };
  const currentMap = new Map<string, CurrentInfo>();
  // grouped のセクション順を保持
  const sectionOrder: string[] = [];
  for (const { section, shiftGroups } of grouped) {
    if (!sectionOrder.includes(section)) sectionOrder.push(section);
    for (const { shiftName, members } of shiftGroups) {
      for (const m of members) {
        currentMap.set(m.staffId, { shiftName, section, accountNumber: m.accountNumber, staffName: m.name });
      }
    }
  }

  // 変更ログマップ：最初のエントリの beforeShift = 確定版
  const changeMap = new Map<string, { beforeShift: string | null }>();
  for (const c of shiftChanges) {
    if (!changeMap.has(c.staffId)) {
      changeMap.set(c.staffId, { beforeShift: c.beforeShift });
    }
  }

  // 比較行の型
  type CompareRow = {
    staffId: string;
    staffName: string;
    accountNumber: string | null;
    confirmedShift: string | null;
    currentShift: string | null;
    isChanged: boolean;
  };

  // セクション別に行を構築
  const sectionRowMap = new Map<string, CompareRow[]>();
  for (const [staffId, info] of currentMap) {
    if (!sectionRowMap.has(info.section)) sectionRowMap.set(info.section, []);
    const change = changeMap.get(staffId);
    const confirmedShift = change ? change.beforeShift : info.shiftName;
    sectionRowMap.get(info.section)!.push({
      staffId,
      staffName: info.staffName,
      accountNumber: info.accountNumber,
      confirmedShift,
      currentShift: info.shiftName,
      isChanged: change !== undefined && change.beforeShift !== info.shiftName,
    });
  }

  // 当日シフトなし（削除・休日変更など）
  const removedRows: CompareRow[] = [];
  const seen = new Set<string>();
  for (const c of shiftChanges) {
    if (!currentMap.has(c.staffId) && c.beforeShift && !seen.has(c.staffId)) {
      seen.add(c.staffId);
      removedRows.push({
        staffId: c.staffId,
        staffName: c.staffName,
        accountNumber: c.accountNumber,
        confirmedShift: c.beforeShift,
        currentShift: null,
        isChanged: true,
      });
    }
  }

  // セクション順・アカウント番号昇順にソート
  const sections = sectionOrder
    .map(sec => {
      const rows = sectionRowMap.get(sec) ?? [];
      rows.sort((a, b) => (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "", "ja"));
      return { section: sec, rows, changedCount: rows.filter(r => r.isChanged).length };
    })
    .filter(s => s.rows.length > 0);

  removedRows.sort((a, b) => (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "", "ja"));

  const totalChanged = sections.reduce((s, sec) => s + sec.changedCount, 0) + removedRows.length;

  // グリッド列定義
  const GRID = "48px 1fr 96px 14px 96px";

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400 tabular-nums">
        確定シフト展開：{fmtPublished}　／　変更：{totalChanged}件
      </p>

      {sections.map(({ section, rows, changedCount }) => (
        <div key={section}>
          <div className="flex items-center gap-2 mb-1.5 px-0.5">
            <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">{section}</span>
            {changedCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-white tabular-nums">
                {changedCount}件変更
              </span>
            )}
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            {/* 列ヘッダー */}
            <div className="grid px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800 text-[10px] font-semibold text-zinc-400 uppercase tracking-wide"
                 style={{ gridTemplateColumns: GRID }}>
              <span>番号</span><span>名前</span><span>確定版</span><span /><span>当日版</span>
            </div>
            {/* データ行 */}
            {rows.map(row => (
              <div
                key={row.staffId}
                className={`grid px-3 py-2 border-b last:border-b-0 border-zinc-100 dark:border-zinc-800 items-center ${row.isChanged ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}
                style={{ gridTemplateColumns: GRID }}
              >
                <span className="text-[10px] font-mono text-zinc-400 tabular-nums truncate">
                  {row.accountNumber ?? "—"}
                </span>
                <span className={`text-xs font-semibold truncate ${row.isChanged ? "text-zinc-800 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400"}`}>
                  {row.staffName}
                </span>
                <span className={`text-xs truncate ${row.isChanged ? "text-zinc-400 dark:text-zinc-500 line-through" : "text-zinc-600 dark:text-zinc-300 font-medium"}`}>
                  {row.confirmedShift ?? "—"}
                </span>
                <span className="text-[10px] text-zinc-400 text-center">{row.isChanged ? "→" : ""}</span>
                <span className={`text-xs truncate ${row.isChanged ? "text-amber-700 dark:text-amber-300 font-bold" : "text-zinc-400 dark:text-zinc-500"}`}>
                  {row.currentShift ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* 削除・休日変更 */}
      {removedRows.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1.5 px-0.5">
            <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">削除・休日変更</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white tabular-nums">
              {removedRows.length}件
            </span>
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            <div className="grid px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800 text-[10px] font-semibold text-zinc-400 uppercase tracking-wide"
                 style={{ gridTemplateColumns: GRID }}>
              <span>番号</span><span>名前</span><span>確定版</span><span /><span>当日版</span>
            </div>
            {removedRows.map(row => (
              <div
                key={row.staffId}
                className="grid px-3 py-2 border-b last:border-b-0 border-zinc-100 dark:border-zinc-800 items-center bg-red-50 dark:bg-red-950/20"
                style={{ gridTemplateColumns: GRID }}
              >
                <span className="text-[10px] font-mono text-zinc-400 tabular-nums truncate">{row.accountNumber ?? "—"}</span>
                <span className="text-xs font-semibold truncate text-zinc-800 dark:text-zinc-100">{row.staffName}</span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500 line-through truncate">{row.confirmedShift ?? "—"}</span>
                <span className="text-[10px] text-zinc-400 text-center">→</span>
                <span className="text-xs font-bold text-red-600 dark:text-red-400">なし</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {totalChanged === 0 && sections.every(s => s.changedCount === 0) && removedRows.length === 0 && (
        <div className="py-10 text-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
          <p className="text-sm font-semibold text-zinc-500">変更なし</p>
        </div>
      )}
    </div>
  );
}

// ── セクション別カラーマップ（出力用） ──────────────────────
const SECTION_EXCEL_COLORS: Record<string, { header: string; data: string }> = {
  "SV":       { header: "93C5FD", data: "EFF6FF" },
  "査定":     { header: "6EE7B7", data: "ECFDF5" },
  "販売":     { header: "FCD34D", data: "FFFBEB" },
  "MOTA":     { header: "FCA5A5", data: "FEF2F2" },
  "H MOTA":   { header: "D8B4FE", data: "FAF5FF" },
  "インフォ": { header: "7DD3FC", data: "F0F9FF" },
  "未アポ":   { header: "D4D4D8", data: "FAFAFA" },
  "ローン":   { header: "C4B5FD", data: "F5F3FF" },
};
const EXCEL_DEFAULT_COLORS = { header: "E4E4E7", data: "FAFAFA" };

// ── 出勤簿XLSX出力（セクション横並び・色付き） ──────────────
function exportAttendanceXLSX(
  today: string,
  dateLabel: string,
  grouped: SectionGroup[],
  localStatuses: Map<string, StatusKey>,
) {
  const getAccNum = (acct: string) => parseInt(acct.replace(/\D/g, "")) || 99999;

  type ColGroup = { header: string; rows: { accountNumber: string; name: string }[] };
  const colGroups: ColGroup[] = [];
  const SPLIT_SECTIONS = ["査定", "販売"];

  for (const { section, shiftGroups } of grouped) {
    if (SPLIT_SECTIONS.includes(section)) {
      const earlyRows: { accountNumber: string; name: string }[] = [];
      const lateRows:  { accountNumber: string; name: string }[] = [];
      for (const { shiftStart, shiftName, members } of shiftGroups) {
        const isEarly = shiftStart ? shiftStart.slice(0, 5) < "11:00" : shiftName.includes("早");
        for (const m of members) {
          if ((localStatuses.get(m.staffId) ?? m.status) === "absent") continue;
          (isEarly ? earlyRows : lateRows).push({ accountNumber: m.accountNumber ?? "", name: m.name });
        }
      }
      earlyRows.sort((a, b) => getAccNum(a.accountNumber) - getAccNum(b.accountNumber));
      lateRows.sort((a,  b) => getAccNum(a.accountNumber) - getAccNum(b.accountNumber));
      colGroups.push({ header: `${section}早番`, rows: earlyRows });
      colGroups.push({ header: `${section}遅番`, rows: lateRows });
    } else {
      const rows: { accountNumber: string; name: string }[] = [];
      for (const { members } of shiftGroups) {
        for (const m of members) {
          if ((localStatuses.get(m.staffId) ?? m.status) === "absent") continue;
          rows.push({ accountNumber: m.accountNumber ?? "", name: m.name });
        }
      }
      rows.sort((a, b) => getAccNum(a.accountNumber) - getAccNum(b.accountNumber));
      colGroups.push({ header: section, rows });
    }
  }

  const maxRows = Math.max(0, ...colGroups.map(g => g.rows.length));

  const getColors = (header: string) => {
    const base = header.replace(/[早遅]番$/, "").trim();
    return SECTION_EXCEL_COLORS[base] ?? EXCEL_DEFAULT_COLORS;
  };

  void import("exceljs").then(async (ExcelJS) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Raq Portal";
    const ws = wb.addWorksheet(dateLabel.slice(0, 31));

    // Row 1: セクションヘッダー（2列マージ）
    colGroups.forEach((g, i) => {
      const col1 = i * 2 + 1;
      ws.mergeCells(1, col1, 1, col1 + 1);
      const cell = ws.getCell(1, col1);
      cell.value = g.header;
      const c = getColors(g.header);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + c.header } };
      cell.font = { bold: true, size: 11 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "medium" as const }, left: { style: "medium" as const },
        bottom: { style: "thin" as const }, right: { style: "medium" as const },
      };
    });
    ws.getRow(1).height = 22;

    // Row 2: 列ラベル
    ws.addRow(colGroups.flatMap(() => ["アカウント番号", "名前"]));
    colGroups.forEach((g, i) => {
      const c = getColors(g.header);
      [i * 2 + 1, i * 2 + 2].forEach(col => {
        const cell = ws.getCell(2, col);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + c.header } };
        cell.font = { bold: true, size: 10 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = {
          top: { style: "thin" as const }, left: { style: "medium" as const },
          bottom: { style: "medium" as const }, right: { style: "medium" as const },
        };
      });
    });
    ws.getRow(2).height = 16;

    // データ行
    for (let i = 0; i < maxRows; i++) {
      ws.addRow(colGroups.flatMap(g => {
        const e = g.rows[i];
        return [e?.accountNumber ?? "", e?.name ?? ""];
      }));
      colGroups.forEach((g, ci) => {
        const c = getColors(g.header);
        [ci * 2 + 1, ci * 2 + 2].forEach(col => {
          const cell = ws.getCell(i + 3, col);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + c.data } };
          cell.font = { size: 10 };
          cell.border = {
            top: { style: "hair" as const }, bottom: { style: "hair" as const },
            left: { style: "medium" as const }, right: { style: "medium" as const },
          };
          cell.alignment = { horizontal: "left", vertical: "middle" };
        });
      });
    }

    // 列幅
    colGroups.forEach((_, i) => {
      ws.getColumn(i * 2 + 1).width = 16;
      ws.getColumn(i * 2 + 2).width = 12;
    });

    // ダウンロード
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `出勤簿_${today}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 100);
  });
}

// ── ダウンロードアイコン ──────────────────────────────────
function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}


