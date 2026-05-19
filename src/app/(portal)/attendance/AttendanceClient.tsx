"use client";
import { useState, useMemo, useTransition, useRef, useEffect } from "react";
import { ChevronLeftIcon } from "@/components/icons";
import StaffPopupMenu from "@/components/StaffPopupMenu";
import { sendBulkDepartureReminderAction, sendBulkWorkRequestAction, changeAttendanceStatusAction } from "./actions";
import type { SendResult } from "./actions";

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
  lateReason: string | null;
  expectedArrival: string | null;
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
  absent: number;
  notClocked: number;
  grouped: SectionGroup[];
  offMembers: OffMember[];
  enableDeparture: boolean;
}

type SelectionMode = "reminder" | "request";
type ModalState = null | "confirm" | "sending" | "results";

// ── メインコンポーネント ──────────────────────────────────
export default function AttendanceClient({
  projectId, today, dateLabel, projectName,
  total, departed, clockedIn, absent, notClocked,
  grouped, offMembers, enableDeparture,
}: Props) {
  // 催促・依頼の選択（トグル式）
  const [selectedMode, setSelectedMode] = useState<SelectionMode | null>(null);
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());

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
  const [staffMenu, setStaffMenu] = useState<{ staffId: string; staffName: string } | null>(null);

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
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-32">

        {/* ヘッダー */}
        <div className="mb-5">
          <a href="/dashboard" className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-blue-500 transition-colors mb-2">
            <ChevronLeftIcon className="w-4 h-4" />ホーム
          </a>
          <div className="flex items-baseline justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">当日状況</h1>
                {notClocked > 0 && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500 text-white tabular-nums">
                    未打刻 {notClocked}名
                  </span>
                )}
              </div>
              <p className="text-sm text-zinc-400 mt-0.5">{projectName}</p>
            </div>
            <span className="text-sm font-semibold text-zinc-500">{dateLabel}</span>
          </div>
        </div>

        {/* 全体サマリー */}
        <div className={`grid gap-3 mb-5 ${enableDeparture ? "grid-cols-3" : "grid-cols-2"}`}>
          {enableDeparture && (
            <SummaryCard value={departed}  total={total} label="出発済" color="text-blue-500" />
          )}
          <SummaryCard value={clockedIn} total={total} label="出勤済" color="text-green-500" />
          <SummaryCard value={absent}               label="欠勤"   color="text-red-500" />
        </div>

        {/* セクション別アコーディオン */}
        {grouped.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-10">本日の出勤予定者はいません</p>
        ) : (
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
                            const canRemind = currentStatus === "not_departed" || currentStatus === "late";
                            const isSelected = selectedIds.has(m.staffId);
                            const isMenuOpen = statusMenuId === m.staffId;
                            return (
                              <div
                                key={m.staffId}
                                className={`flex items-center gap-2 px-3 py-2 transition-colors ${isSelected ? "bg-blue-50 dark:bg-blue-950/20" : ""}`}
                              >
                                {/* アカウント番号 */}
                                <span className="w-10 text-xs font-mono text-zinc-400 tabular-nums flex-shrink-0 truncate">
                                  {m.accountNumber ?? ""}
                                </span>
                                {/* 名前 */}
                                <button
                                  type="button"
                                  onClick={() => setStaffMenu({ staffId: m.staffId, staffName: m.name })}
                                  className="flex-1 min-w-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate text-left hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                >
                                  {m.name}
                                </button>
                                {/* ステータスバッジ（タップで変更メニュー） */}
                                <div className="relative flex-shrink-0">
                                  <button
                                    onClick={() => setStatusMenuId(isMenuOpen ? null : m.staffId)}
                                    className={`text-xs font-semibold px-1.5 py-0.5 rounded whitespace-nowrap transition-opacity ${STATUS_COLOR[currentStatus]} ${isPending ? "opacity-50" : ""}`}
                                  >
                                    {STATUS_LABEL[currentStatus]} ▾
                                  </button>
                                  {isMenuOpen && (
                                    <StatusMenu
                                      current={currentStatus}
                                      onSelect={s => handleStatusChange(m.staffId, s)}
                                      onClose={() => setStatusMenuId(null)}
                                    />
                                  )}
                                </div>
                                {/* 時刻 */}
                                <span className="text-xs font-mono tabular-nums text-zinc-400 whitespace-nowrap flex-shrink-0">
                                  {m.clockIn  && `出${fmtTime(m.clockIn)}`}
                                  {m.clockOut && ` 退${fmtTime(m.clockOut)}`}
                                  {m.departureTime && !m.clockIn && `出発${fmtTime(m.departureTime)}`}
                                  {currentStatus === "late" && m.expectedArrival && `→${m.expectedArrival.slice(0,5)}`}
                                </span>
                                {/* 催促トグルボタン */}
                                {canRemind ? (
                                  <button
                                    onClick={() => toggleReminder(m.staffId, "reminder")}
                                    className={`flex-shrink-0 text-xs font-semibold px-2 py-1 rounded-lg border transition-colors whitespace-nowrap ${
                                      isSelected
                                        ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
                                        : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800"
                                    }`}
                                  >
                                    {isSelected ? "✓ 選択中" : "催促する"}
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
        {offMembers.length > 0 && (
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
                    <span className="w-10 text-xs font-mono text-zinc-400 tabular-nums flex-shrink-0 truncate">
                      {m.accountNumber ?? ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => setStaffMenu({ staffId: m.staffId, staffName: m.name })}
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

      {staffMenu && (
        <StaffPopupMenu
          staffId={staffMenu.staffId}
          staffName={staffMenu.staffName}
          projectId={projectId}
          onClose={() => setStaffMenu(null)}
        />
      )}
    </main>
  );
}

// ── ステータス変更メニュー ──────────────────────────────────
const ALL_STATUSES: StatusKey[] = ["not_departed", "departed", "working", "clocked_out", "late", "absent"];

function StatusMenu({ current, onSelect, onClose }: {
  current: StatusKey;
  onSelect: (s: StatusKey) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl overflow-hidden min-w-[110px]"
    >
      {ALL_STATUSES.map(s => (
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
            {STATUS_LABEL[s]}
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
