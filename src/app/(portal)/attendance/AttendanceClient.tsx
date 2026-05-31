"use client";
import React, { useState, useMemo, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import StaffPopupMenu from "@/components/StaffPopupMenu";
import { sendBulkDepartureReminderAction, sendBulkWorkRequestAction, sendBulkFollowupReminderAction, changeAttendanceStatusAction, toggleChurnRiskAction, moveSectionAction } from "./actions";
import type { SendResult } from "./actions";
import SeatingClient, { type SeatData, type WallData, type StaffInfo } from "@/app/(portal)/seating/SeatingClient";
import SeatingPlanClient, { type PlanSeat, type PlanStaff } from "@/app/(portal)/seating/plan/SeatingPlanClient";

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
  total: number;
  departed: number;
  clockedIn: number;
  late: number;
  absent: number;
  notClocked: number;
  grouped: SectionGroup[];
  offMembers: OffMember[];
  enableDeparture: boolean;
  publishedAt: string | null;
  shiftChanges: ShiftChangeEntry[];
  myStaffId: string;
  churnRiskAlerts?: ChurnRiskAlert[];
  seatData: SeatData[];
  wallData: WallData[];
  seatStaffList: StaffInfo[];
  tomorrow: string;
  planSeatData: PlanSeat[];
  planStaffData: PlanStaff[];
}

type SelectionMode = "reminder" | "request" | "followup";
type ModalState = null | "confirm" | "sending" | "results";

// ── メインコンポーネント ──────────────────────────────────
export default function AttendanceClient({
  projectId, today, prevDate, nextDate, dateLabel, projectName,
  total, departed, clockedIn, late, absent, notClocked,
  grouped, offMembers, enableDeparture,
  publishedAt, shiftChanges,
  myStaffId, churnRiskAlerts,
  seatData, wallData, seatStaffList,
  tomorrow, planSeatData, planStaffData,
}: Props) {
  const [activeTab, setActiveTab] = useState<"today" | "changes" | "seating">("today");
  const [seatSubTab, setSeatSubTab] = useState<"today" | "tomorrow">("today");
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
        if (key.slice(0, sepIdx) === sec)
          groups.push({ shiftName: key.slice(sepIdx + 3), shiftStart: val.shiftStart, members: val.members });
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

  function handleSectionDrop(targetSection: string) {
    if (!dragStaffId) return;
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
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-4">
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
            <span className="text-sm font-semibold text-zinc-500 tabular-nums">{dateLabel}</span>
          </div>
        </div>
        {/* サマリー（固定） */}
        <div className="max-w-5xl mx-auto px-4 py-3 grid grid-cols-3 gap-3">
          <SummaryCard value={clockedIn} total={total} label="出勤" color="text-green-500" />
          <SummaryCard value={late}                   label="遅刻" color="text-amber-500" />
          <SummaryCard value={absent}                 label="欠勤" color="text-red-500" />
        </div>
        {/* タブ */}
        <div className="max-w-5xl mx-auto px-4 pb-1 flex gap-1">
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
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-32">

        {/* ── 確定後変更タブ ── */}
        {activeTab === "changes" && (
          <div>
            <DateNav prevDate={prevDate} nextDate={nextDate} dateLabel={dateLabel} />
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
            <DateNav prevDate={prevDate} nextDate={nextDate} dateLabel={dateLabel} />
            {/* サブタブ */}
            <div className="flex gap-1 mb-3">
              <button
                onClick={() => setSeatSubTab("today")}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  seatSubTab === "today"
                    ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                }`}
              >
                当日座席
              </button>
              <button
                onClick={() => setSeatSubTab("tomorrow")}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  seatSubTab === "tomorrow"
                    ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                }`}
              >
                翌日配置
              </button>
            </div>
            {seatSubTab === "today" && (
              <SeatingClient
                projectId={projectId}
                today={today}
                seats={seatData}
                walls={wallData}
                isAdmin={true}
                myStaffId={myStaffId}
                staffList={seatStaffList}
                embedded
              />
            )}
            {seatSubTab === "tomorrow" && (
              <SeatingPlanClient
                projectId={projectId}
                date={tomorrow}
                seats={planSeatData}
                staff={planStaffData}
                walls={wallData}
                embedded
              />
            )}
          </div>
        )}

        {/* ── 出勤簿タブ：日付ナビ + 出力ボタン ── */}
        {activeTab === "today" && (
          <div className="flex items-center gap-2 mb-4">
            <div className="flex-1">
              <DateNav prevDate={prevDate} nextDate={nextDate} dateLabel={dateLabel} noMargin />
            </div>
            <button
              type="button"
              onClick={() => exportAttendanceCSV(today, dateLabel, grouped)}
              className="flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shadow-sm"
            >
              <DownloadIcon className="w-3.5 h-3.5" />
              出力
            </button>
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
                const present = allMembers.filter(m => {
                  const s = localStatuses.get(m.staffId) ?? m.status;
                  return s === "working" || s === "clocked_out" || s === "departed";
                }).length;
                const absCnt = allMembers.filter(m =>
                  (localStatuses.get(m.staffId) ?? m.status) === "absent"
                ).length;
                const isDragTarget = dragOverSection === section;
                const secCol = SECTION_COL[section] ?? SECTION_COL_FALLBACK;

                return (
                  <div
                    key={section}
                    className={[
                      "flex flex-col rounded-2xl border-2 transition-all w-52 shrink-0",
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
                    <div className={`px-3 pt-2.5 pb-2 border-b shrink-0 rounded-t-2xl ${secCol.headerBg} ${secCol.border.replace("border-", "border-b-")}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{section}</span>
                        <span className="text-xs font-bold tabular-nums text-green-600 dark:text-green-400">
                          {present}<span className="text-zinc-400 font-normal">/{allMembers.length}</span>
                        </span>
                      </div>
                      {absCnt > 0 && (
                        <span className="text-[11px] font-bold text-red-500 dark:text-red-400 block mt-0.5">
                          欠員 {absCnt}名
                        </span>
                      )}
                    </div>

                    {/* メンバーカード一覧（独立スクロール・スクロールバー非表示） */}
                    <div
                      className="flex flex-col gap-1.5 p-2 overflow-y-auto flex-1 min-h-0 [&::-webkit-scrollbar]:hidden"
                      style={{ scrollbarWidth: "none" }}
                    >
                      {groups.map(({ shiftName, members }, gi) => (
                        <React.Fragment key={shiftName}>
                          {/* 複数シフトグループがある場合のみサブヘッダー */}
                          {groups.length > 1 && (
                            <div className={`flex items-center gap-1.5 ${gi > 0 ? "mt-0.5" : ""}`}>
                              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
                              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 shrink-0 tabular-nums">
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
                            onDragStart={() => setDragStaffId(m.staffId)}
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
                            {/* 1行：番号 ＋ 名前 ＋ ステータス */}
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[10px] font-mono text-zinc-400 tabular-nums shrink-0 leading-none">
                                {m.accountNumber ?? "—"}
                              </span>
                              <button
                                type="button"
                                onClick={() => setStaffMenu({ staffId: m.staffId, staffName: m.name, churnRisk: effectiveChurnRisk })}
                                className="flex-1 min-w-0 text-left"
                              >
                                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate block leading-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                                  {m.name}
                                </span>
                              </button>
                              <div className="relative shrink-0">
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

                            {/* サブ情報（欠勤・遅刻・催促・移動）*/}
                            {currentStatus === "absent" && (
                              <button type="button" onClick={() => toggleSelect(m.staffId, "followup")}
                                className={["mt-1 w-full text-[10px] font-bold py-0.5 rounded border transition-colors",
                                  selectedIds.has(m.staffId) && selectedMode === "followup"
                                    ? "bg-red-600 text-white border-red-600"
                                    : "bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800",
                                ].join(" ")}>
                                {selectedIds.has(m.staffId) && selectedMode === "followup" ? "✓ 選択中" : "経過報告催促"}
                              </button>
                            )}
                            {currentStatus === "absent" && (
                              <button type="button" onClick={() => setDetailMember(m)}
                                className="mt-0.5 text-[10px] text-red-400 w-full text-left truncate block underline leading-none">
                                {m.absenceReason || "欠勤"}　詳細→
                              </button>
                            )}
                            {currentStatus === "late" && (
                              <button type="button" onClick={() => setDetailMember(m)}
                                className="mt-0.5 text-[10px] text-amber-500 w-full text-left truncate block underline leading-none">
                                {m.lateReason || "遅刻連絡あり"}　詳細→
                              </button>
                            )}
                            {canRemind && (
                              <button type="button" onClick={() => toggleSelect(m.staffId, "reminder")}
                                className={["mt-1 w-full text-[10px] font-bold py-0.5 rounded border transition-colors",
                                  isSelected ? "bg-blue-600 text-white border-blue-600"
                                    : "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800",
                                ].join(" ")}>
                                {isSelected ? "✓ 選択中" : "催促する"}
                              </button>
                            )}
                            {isMoved && (
                              <div className="flex items-center justify-between mt-0.5">
                                <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400">← 移動</span>
                                <button type="button"
                                  onClick={e => { e.stopPropagation(); handleSectionRevert(m.staffId, m.section); }}
                                  className="text-[9px] text-zinc-400 hover:text-zinc-600 underline">
                                  元に戻す
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                        </React.Fragment>
                      ))}

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

        {/* 本日休みスタッフ（補填調整用） */}
        {activeTab === "today" && offMembers.length > 0 && (
          <details className="group mt-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none list-none hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              <div className="flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-zinc-400 transition-transform group-open:rotate-90 flex-shrink-0" />
                <span className="text-sm font-bold text-zinc-500 dark:text-zinc-400">本日休み（補填調整）</span>
                <span className="text-xs text-zinc-400">{offMembers.length}名</span>
              </div>
            </summary>
            <div className="border-t border-zinc-100 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
              {offMembers.map(m => {
                const isSelected = selectedIds.has(m.staffId);
                const isLocked   = selectedMode === "reminder";
                return (
                  <div
                    key={m.staffId}
                    className={`flex items-center gap-2 px-3 py-2 transition-colors ${isSelected ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}
                  >
                    <span className="w-16 text-xs font-mono text-zinc-400 tabular-nums flex-shrink-0 truncate" title={m.accountNumber ?? ""}>
                      {m.accountNumber ?? ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => setStaffMenu({ staffId: m.staffId, staffName: m.name, churnRisk: false })}
                      className="flex-1 min-w-0 text-sm font-semibold text-zinc-700 dark:text-zinc-300 truncate text-left hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                      {m.name}
                    </button>
                    <span className="text-xs text-zinc-400 flex-shrink-0">{m.shiftName}</span>
                    <button
                      onClick={() => !isLocked && toggleReminder(m.staffId, "request")}
                      disabled={isLocked}
                      className={`flex-shrink-0 text-xs font-semibold px-2 py-1 rounded-lg border transition-colors whitespace-nowrap disabled:opacity-30 ${
                        isSelected
                          ? "bg-amber-500 text-white border-amber-500 hover:bg-amber-600"
                          : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800"
                      }`}
                    >
                      {isSelected ? "✓ 選択中" : "依頼する"}
                    </button>
                  </div>
                );
              })}
            </div>
          </details>
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
function SummaryCard({ value, total, label, color }: { value: number; total?: number; label: string; color: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-center">
      <div className={`text-xl font-bold tabular-nums ${color}`}>
        {value}{total !== undefined && <span className="text-sm text-zinc-400 font-normal">/{total}</span>}
      </div>
      <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
    </div>
  );
}

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

// ── 出勤簿CSV出力 ────────────────────────────────────────
function exportAttendanceCSV(today: string, dateLabel: string, grouped: SectionGroup[]) {
  const BOM = "﻿";
  const lines: string[] = [];

  // 日付ヘッダー
  lines.push(`日付,${dateLabel}`);
  lines.push("");

  // 列ヘッダー
  lines.push("セクション,アカウント番号,名前,シフト");

  // セクション順・アカウント番号順でデータ行
  for (const { section, shiftGroups } of grouped) {
    type Row = { accountNumber: string | null; staffName: string; shiftName: string };
    const rows: Row[] = [];
    for (const { shiftName, members } of shiftGroups) {
      for (const m of members) {
        rows.push({ accountNumber: m.accountNumber, staffName: m.name, shiftName });
      }
    }
    rows.sort((a, b) => (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "", "ja"));

    for (const r of rows) {
      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
      lines.push([esc(section), esc(r.accountNumber ?? ""), esc(r.staffName), esc(r.shiftName)].join(","));
    }
  }

  const csv = BOM + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `出勤簿_${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── ダウンロードアイコン ──────────────────────────────────
function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

