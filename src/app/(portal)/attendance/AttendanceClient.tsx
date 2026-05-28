"use client";
import { useState, useMemo, useTransition, useRef, useEffect } from "react";
import StaffPopupMenu from "@/components/StaffPopupMenu";
import { sendBulkDepartureReminderAction, sendBulkWorkRequestAction, changeAttendanceStatusAction, toggleChurnRiskAction } from "./actions";
import type { SendResult } from "./actions";
import SeatingClient, { type SeatData, type WallData, type StaffInfo } from "@/app/(portal)/seating/SeatingClient";

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
  action: string;
  beforeShift: string | null;
  afterShift: string | null;
  changedBy: string;
  changedByName: string;
  changedAt: string;
};

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
}

type SelectionMode = "reminder" | "request";
type ModalState = null | "confirm" | "sending" | "results";

// ── メインコンポーネント ──────────────────────────────────
export default function AttendanceClient({
  projectId, today, dateLabel, projectName,
  total, departed, clockedIn, late, absent, notClocked,
  grouped, offMembers, enableDeparture,
  publishedAt, shiftChanges,
  myStaffId, churnRiskAlerts,
  seatData, wallData, seatStaffList,
}: Props) {
  const [activeTab, setActiveTab] = useState<"today" | "changes" | "seating">("today");
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
    <main className="min-h-screen bg-white dark:bg-zinc-950">
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
            当日シフト
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
          <ShiftChangesTab
            publishedAt={publishedAt}
            shiftChanges={shiftChanges}
          />
        )}

        {/* ── 座席表タブ ── */}
        {activeTab === "seating" && (
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

        {/* ── 当日シフトタブ ── */}
        {activeTab === "today" && grouped.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-10">本日の出勤予定者はいません</p>
        ) : activeTab === "today" && (
          <div className="space-y-2">
            {grouped.map(({ section, shiftGroups }) => {
              const sAll = shiftGroups.flatMap(g => g.members);
              const sDep = sAll.filter(m => m.departureTime || m.clockIn).length;
              const sClk = sAll.filter(m => m.clockIn).length;
              const sAbs = sAll.filter(m => m.status === "absent").length;
              const sTot = sAll.length;

              return (
                <details key={section} className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none list-none hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center gap-2">
                      <ChevronRight className="w-4 h-4 text-zinc-400 transition-transform group-open:rotate-90 flex-shrink-0" />
                      <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{section}</span>
                      <span className="text-xs text-zinc-400">{sTot}名</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs tabular-nums">
                      {enableDeparture && (
                        <span className="text-blue-600 dark:text-blue-400 font-semibold">出発 {sDep}/{sTot}</span>
                      )}
                      <span className="text-green-600 dark:text-green-400 font-semibold">出勤 {sClk}/{sTot}</span>
                      {sAbs > 0 && <span className="text-red-500 font-semibold">欠勤 {sAbs}</span>}
                    </div>
                  </summary>

                  <div className="border-t border-zinc-100 dark:border-zinc-800">
                    {shiftGroups.map(({ shiftName, shiftStart, shiftEnd, members: gMembers }) => (
                      <div key={shiftName}>
                        {/* シフト名サブヘッダー */}
                        <div className="px-4 py-1.5 bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-between">
                          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                            {shiftName}{shiftStart && shiftEnd && ` ${shiftStart}〜${shiftEnd}`}
                          </span>
                          <span className="text-xs text-zinc-400">{gMembers.length}名</span>
                        </div>
                        {/* メンバー1行リスト */}
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                          {gMembers.map(m => {
                            const currentStatus = localStatuses.get(m.staffId) ?? m.status;
                            const canRemind = (enableDeparture && currentStatus === "not_departed") || currentStatus === "late";
                            const isSelected = selectedIds.has(m.staffId);
                            const isMenuOpen = statusMenuId === m.staffId;
                            const effectiveChurnRisk = getEffectiveChurnRisk(m.staffId, m.churnRisk);
                            return (
                              <div
                                key={m.staffId}
                                className={`flex items-center gap-2 px-3 py-2 transition-colors ${isSelected ? "bg-blue-50 dark:bg-blue-950/20" : ""}`}
                              >
                                {/* アカウント番号 */}
                                <span className="w-16 text-xs font-mono text-zinc-400 tabular-nums flex-shrink-0 truncate" title={m.accountNumber ?? ""}>
                                  {m.accountNumber ?? ""}
                                </span>
                                {/* 名前 */}
                                <button
                                  type="button"
                                  onClick={() => setStaffMenu({ staffId: m.staffId, staffName: m.name, churnRisk: effectiveChurnRisk })}
                                  className="flex-1 min-w-0 text-left hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                >
                                  <span className="flex items-center gap-1.5 truncate">
                                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                      {m.name}
                                    </span>
                                    {effectiveChurnRisk && (
                                      <span className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 leading-none">
                                        離脱リスク
                                      </span>
                                    )}
                                  </span>
                                  {currentStatus === "absent" && m.absenceReason && (
                                    <span className="block text-[11px] text-red-500 dark:text-red-400 truncate">
                                      {m.absenceReason}
                                    </span>
                                  )}
                                  {currentStatus === "late" && m.lateReason && (
                                    <span className="block text-[11px] text-amber-500 dark:text-amber-400 truncate">
                                      {m.lateReason}
                                    </span>
                                  )}
                                </button>
                                {/* ステータスバッジ（タップで変更メニュー） */}
                                <div className="relative flex-shrink-0">
                                  <button
                                    onClick={() => setStatusMenuId(isMenuOpen ? null : m.staffId)}
                                    className={`text-xs font-semibold px-1.5 py-0.5 rounded whitespace-nowrap transition-opacity ${STATUS_COLOR[currentStatus]} ${isPending ? "opacity-50" : ""}`}
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
                                {/* 時刻 */}
                                <span className="text-xs font-mono tabular-nums text-zinc-400 whitespace-nowrap flex-shrink-0">
                                  {m.clockIn  && `出${fmtTime(m.clockIn)}`}
                                  {m.clockOut && ` 退${fmtTime(m.clockOut)}`}
                                  {enableDeparture && m.departureTime && !m.clockIn && `出発${fmtTime(m.departureTime)}`}
                                  {currentStatus === "late" && m.expectedArrival && `→${m.expectedArrival.slice(0,5)}`}
                                </span>
                                {/* 催促 / 詳細ボタン */}
                                {canRemind ? (
                                  <div className="flex-shrink-0 flex items-center gap-1">
                                    <button
                                      onClick={() => toggleReminder(m.staffId, "reminder")}
                                      className={`text-xs font-semibold px-2 py-1 rounded-lg border transition-colors whitespace-nowrap ${
                                        isSelected
                                          ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
                                          : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800"
                                      }`}
                                    >
                                      {isSelected ? "✓ 選択中" : "催促する"}
                                    </button>
                                    {currentStatus === "late" && (
                                      <button
                                        type="button"
                                        onClick={() => setDetailMember(m)}
                                        className="text-xs font-semibold px-1.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                                      >
                                        詳細
                                      </button>
                                    )}
                                  </div>
                                ) : currentStatus === "absent" ? (
                                  <button
                                    type="button"
                                    onClick={() => setDetailMember(m)}
                                    className="flex-shrink-0 text-xs font-semibold px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
                                  >
                                    詳細
                                  </button>
                                ) : (
                                  <div className="w-14 flex-shrink-0" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
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
              {selectedMode === "reminder" ? `${selectedIds.size}名にまとめて催促する` : `${selectedIds.size}名にまとめて依頼する`} →
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
                    {pendingSend?.mode === "reminder" ? "出発催促を送信" : "出勤依頼を送信"}
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

// ── 確定後変更タブ ────────────────────────────────────────
function ShiftChangesTab({
  publishedAt,
  shiftChanges,
}: {
  publishedAt: string | null;
  shiftChanges: ShiftChangeEntry[];
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

  // シフトパターン軸に変換
  // パターンごとに「外れた人」「入った人」を収集し、ペアは「変更 A⇒B」で表示
  const patternAdded   = new Map<string, string[]>(); // パターン → 入った人リスト
  const patternRemoved = new Map<string, string[]>(); // パターン → 外れた人リスト

  for (const c of shiftChanges) {
    const before = c.beforeShift;
    const after  = c.afterShift;
    if (!before && !after) continue;
    if (before === after) continue;

    if (before) {
      if (!patternRemoved.has(before)) patternRemoved.set(before, []);
      patternRemoved.get(before)!.push(c.staffName);
    }
    if (after) {
      if (!patternAdded.has(after)) patternAdded.set(after, []);
      patternAdded.get(after)!.push(c.staffName);
    }
  }

  // 全パターン名を収集（追加・削除両方）
  const allPatterns = [...new Set([...patternAdded.keys(), ...patternRemoved.keys()])];

  // パターンごとに表示行を生成
  type DisplayRow =
    | { kind: "swap";   patternName: string; from: string; to: string }
    | { kind: "add";    patternName: string; name: string }
    | { kind: "remove"; patternName: string; name: string };

  const displayRows: DisplayRow[] = [];
  for (const pat of allPatterns) {
    const added   = [...(patternAdded.get(pat)   ?? [])];
    const removed = [...(patternRemoved.get(pat) ?? [])];
    // ペアを「変更」として消化
    while (added.length > 0 && removed.length > 0) {
      displayRows.push({ kind: "swap", patternName: pat, from: removed.shift()!, to: added.shift()! });
    }
    // 余った追加
    for (const name of added)   displayRows.push({ kind: "add",    patternName: pat, name });
    // 余った削除
    for (const name of removed) displayRows.push({ kind: "remove", patternName: pat, name });
  }

  return (
    <div>
      <p className="text-xs text-zinc-400 mb-3 tabular-nums">
        確定シフト展開：{fmtPublished}
      </p>

      {displayRows.length === 0 ? (
        <div className="py-10 text-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
          <p className="text-sm font-semibold text-zinc-500">変更なし</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {displayRows.map((row, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                {/* パターン名 */}
                <span className="w-24 shrink-0 text-sm font-semibold text-zinc-700 dark:text-zinc-200 truncate">
                  {row.patternName}
                </span>
                {/* 種別ラベル */}
                {row.kind === "swap" && (
                  <>
                    <span className="shrink-0 text-xs font-semibold text-amber-600 dark:text-amber-400 w-8">変更</span>
                    <span className="text-sm text-zinc-800 dark:text-zinc-100 flex items-center gap-1">
                      <span className="text-zinc-500 dark:text-zinc-400">{row.from}</span>
                      <span className="text-zinc-400">⇒</span>
                      <span className="font-semibold">{row.to}</span>
                    </span>
                  </>
                )}
                {row.kind === "add" && (
                  <>
                    <span className="shrink-0 text-xs font-semibold text-emerald-600 dark:text-emerald-400 w-8">追加</span>
                    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{row.name}</span>
                  </>
                )}
                {row.kind === "remove" && (
                  <>
                    <span className="shrink-0 text-xs font-semibold text-red-500 dark:text-red-400 w-8">削除</span>
                    <span className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">{row.name}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

