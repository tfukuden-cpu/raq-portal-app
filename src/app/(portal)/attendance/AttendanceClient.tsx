"use client";
import { useState } from "react";
import { ChevronLeftIcon } from "@/components/icons";
import { sendBulkDepartureReminderAction, sendBulkWorkRequestAction } from "./actions";
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

const REMINDER_MSG =
  "出発報告がまだのようです。出発時にアプリから報告をお願いします。";
const REQUEST_MSG =
  "本日はお休みのところ恐れ入ります。急なご連絡で申し訳ございませんが、本日の出勤は可能でしょうか？ご確認いただけますと幸いです。";

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ── コンポーネント Props ──────────────────────────────────
interface Props {
  projectId: string;
  dateLabel: string;
  projectName: string;
  total: number;
  departed: number;
  clockedIn: number;
  absent: number;
  grouped: SectionGroup[];
  offMembers: OffMember[];
}

type SelectionMode = "reminder" | "request";
type ModalState = null | "confirm" | "sending" | "results";

// ── メインコンポーネント ──────────────────────────────────
export default function AttendanceClient({
  projectId,
  dateLabel,
  projectName,
  total,
  departed,
  clockedIn,
  absent,
  grouped,
  offMembers,
}: Props) {
  const [selectedMode, setSelectedMode] = useState<SelectionMode | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [modalState, setModalState] = useState<ModalState>(null);
  const [sendResults, setSendResults] = useState<SendResult[]>([]);

  function toggle(staffId: string, mode: SelectionMode) {
    if (selectedMode !== null && selectedMode !== mode) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(staffId)) next.delete(staffId);
      else next.add(staffId);
      if (next.size === 0) setSelectedMode(null);
      else setSelectedMode(mode);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectedMode(null);
  }

  async function handleConfirmSend() {
    setModalState("sending");
    const ids = Array.from(selectedIds);
    const { results } = selectedMode === "reminder"
      ? await sendBulkDepartureReminderAction(projectId, ids)
      : await sendBulkWorkRequestAction(projectId, ids);
    setSendResults(results);
    setModalState("results");
    clearSelection();
  }

  // 確認モーダル用: 選択中メンバーの名前リスト
  const selectedMembers: { staffId: string; name: string; accountNumber: string | null }[] =
    selectedMode === "reminder"
      ? grouped.flatMap(g => g.shiftGroups.flatMap(sg => sg.members))
          .filter(m => selectedIds.has(m.staffId))
          .map(m => ({ staffId: m.staffId, name: m.name, accountNumber: m.accountNumber }))
      : offMembers
          .filter(m => selectedIds.has(m.staffId))
          .map(m => ({ staffId: m.staffId, name: m.name, accountNumber: m.accountNumber }));

  const confirmTitle = selectedMode === "reminder" ? "出発催促を送信" : "出勤依頼を送信";
  const confirmMsg   = selectedMode === "reminder"
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
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">当日状況</h1>
              <p className="text-sm text-zinc-400 mt-0.5">{projectName}</p>
            </div>
            <span className="text-sm font-semibold text-zinc-500">{dateLabel}</span>
          </div>
        </div>

        {/* 全体サマリー */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <SummaryCard value={departed}  total={total} label="出発済" color="text-blue-500" />
          <SummaryCard value={clockedIn} total={total} label="出勤済" color="text-green-500" />
          <SummaryCard value={absent}               label="欠勤"   color="text-red-500" />
        </div>

        {/* セクション別アコーディオン */}
        {grouped.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-10">本日の出勤予定者はいません</p>
        ) : (
          <div className="space-y-2">
            {grouped.map(({ section, shiftGroups }) => {
              const sAll  = shiftGroups.flatMap(g => g.members);
              const sDep  = sAll.filter(m => m.departureTime || m.clockIn).length;
              const sClk  = sAll.filter(m => m.clockIn).length;
              const sAbs  = sAll.filter(m => m.status === "absent").length;
              const sTot  = sAll.length;

              return (
                <details key={section} className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none list-none hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center gap-2">
                      <ChevronRight className="w-4 h-4 text-zinc-400 transition-transform group-open:rotate-90 flex-shrink-0" />
                      <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{section}</span>
                      <span className="text-xs text-zinc-400">{sTot}名</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs tabular-nums">
                      <span className="text-blue-600 dark:text-blue-400 font-semibold">出発 {sDep}/{sTot}</span>
                      <span className="text-green-600 dark:text-green-400 font-semibold">出勤 {sClk}/{sTot}</span>
                      {sAbs > 0 && <span className="text-red-500 font-semibold">欠勤 {sAbs}</span>}
                    </div>
                  </summary>

                  <div className="border-t border-zinc-100 dark:border-zinc-800">
                    {shiftGroups.map(({ shiftName, shiftStart, shiftEnd, members: gMembers }) => (
                      <div key={shiftName}>
                        {/* シフト名ヘッダー */}
                        <div className="px-4 py-1.5 bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-between">
                          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                            {shiftName}{shiftStart && shiftEnd && ` ${shiftStart}〜${shiftEnd}`}
                          </span>
                          <span className="text-xs text-zinc-400">{gMembers.length}名</span>
                        </div>
                        {/* メンバー行 */}
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                          {gMembers.map(m => {
                            const canSelect = m.status === "not_departed" || m.status === "late";
                            const isSelected = selectedIds.has(m.staffId);
                            const isDisabled = selectedMode === "request";
                            return (
                              <div
                                key={m.staffId}
                                className={`px-4 py-2.5 flex items-start gap-3 transition-colors ${isSelected ? "bg-blue-50 dark:bg-blue-950/20" : ""}`}
                              >
                                {/* チェックボックス（常に表示、選択不可なら空スペース） */}
                                <div className="mt-0.5 w-5 flex-shrink-0 flex justify-center">
                                  {canSelect ? (
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      disabled={isDisabled}
                                      onChange={() => toggle(m.staffId, "reminder")}
                                      className="w-4 h-4 rounded border-zinc-300 accent-blue-600 cursor-pointer disabled:opacity-30"
                                    />
                                  ) : null}
                                </div>

                                {/* 名前・ステータス */}
                                <div className="flex-1 min-w-0">
                                  {/* 1行目: アカウント番号 + 名前 */}
                                  <div className="flex items-baseline gap-1.5">
                                    {m.accountNumber && (
                                      <span className="text-xs font-mono text-zinc-400 tabular-nums flex-shrink-0">{m.accountNumber}</span>
                                    )}
                                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{m.name}</span>
                                  </div>
                                  {/* 2行目: ステータスバッジ + 補足情報 */}
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${STATUS_COLOR[m.status]}`}>
                                      {STATUS_LABEL[m.status]}
                                    </span>
                                    {m.departureTime && !m.clockIn && (
                                      <span className="text-blue-600 dark:text-blue-400">
                                        出発 {fmtTime(m.departureTime)}{m.etaMinutes !== null && ` · 約${m.etaMinutes}分後`}
                                      </span>
                                    )}
                                    {m.status === "absent" && (
                                      <span className="text-red-500">欠勤: {m.absenceReason || "未記入"}</span>
                                    )}
                                    {m.status === "late" && (
                                      <span className="text-amber-600 dark:text-amber-400">
                                        遅刻: {m.lateReason || "未記入"}
                                        {m.expectedArrival && ` · 到着予定 ${m.expectedArrival.slice(0, 5)}`}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* 打刻時刻 */}
                                <div className="flex-shrink-0 text-right text-xs font-mono tabular-nums space-y-0.5 pt-0.5">
                                  {m.clockIn  && <div className="text-green-600 dark:text-green-400">出 {fmtTime(m.clockIn)}</div>}
                                  {m.clockOut && <div className="text-zinc-400">退 {fmtTime(m.clockOut)}</div>}
                                </div>
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
              <span className="text-xs text-zinc-400 pr-1">出勤依頼を一括送信できます</span>
            </summary>
            <div className="border-t border-zinc-100 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
              {offMembers.map(m => {
                const isSelected = selectedIds.has(m.staffId);
                const isDisabled = selectedMode === "reminder";
                return (
                  <div
                    key={m.staffId}
                    className={`px-4 py-2.5 flex items-center gap-3 transition-colors ${isSelected ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isDisabled}
                      onChange={() => toggle(m.staffId, "request")}
                      className="w-4 h-4 rounded border-zinc-300 accent-amber-500 cursor-pointer disabled:opacity-30 flex-shrink-0"
                    />
                    <div className="flex items-baseline gap-1.5 flex-1 min-w-0">
                      {m.accountNumber && (
                        <span className="text-xs font-mono text-zinc-400 tabular-nums flex-shrink-0">{m.accountNumber}</span>
                      )}
                      <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 truncate">{m.name}</span>
                      <span className="text-xs text-zinc-400 flex-shrink-0">{m.shiftName}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>

      {/* 選択中アクションバー */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-24 inset-x-0 flex justify-center z-40 px-4 pointer-events-none">
          <div className="bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 pointer-events-auto w-full max-w-md">
            <span className="text-sm font-semibold flex-1 tabular-nums">
              {selectedIds.size}名を選択中
            </span>
            <button
              onClick={clearSelection}
              className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-200 dark:hover:text-zinc-700 transition-colors"
            >
              解除
            </button>
            <button
              onClick={() => setModalState("confirm")}
              className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm font-bold px-4 py-1.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {selectedMode === "reminder" ? "出発催促を送る" : "出勤依頼を送る"} →
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
                      <span className={`font-bold text-base leading-none ${r.ok ? "text-green-500" : "text-red-400"}`}>
                        {r.ok ? "✓" : "✗"}
                      </span>
                      <span className={`font-semibold ${r.ok ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-400"}`}>
                        {r.name}
                      </span>
                      {!r.ok && <span className="text-xs text-red-400">{r.error}</span>}
                    </div>
                  ))}
                </div>
                <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800">
                  <button
                    onClick={() => setModalState(null)}
                    className="w-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold py-2.5 rounded-xl hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors"
                  >
                    閉じる
                  </button>
                </div>
              </>
            )}

            {modalState === "confirm" && (
              <>
                <div className="px-5 pt-5 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                  <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">{confirmTitle}</h2>
                  <p className="text-xs text-zinc-400 mt-0.5">{selectedMembers.length}名に送信します</p>
                </div>
                {/* メッセージプレビュー */}
                <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
                  <p className="text-xs font-semibold text-zinc-400 mb-1.5">送信内容（{"{名前}"}は各自の名前に置き換わります）</p>
                  <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {confirmMsg}
                  </div>
                </div>
                {/* 送信対象リスト */}
                <div className="overflow-y-auto flex-1 px-5 py-3">
                  <p className="text-xs font-semibold text-zinc-400 mb-2">送信対象</p>
                  <div className="space-y-1.5">
                    {selectedMembers.map(m => (
                      <div key={m.staffId} className="flex items-baseline gap-1.5 text-sm">
                        <span className="text-xs font-mono text-zinc-400 tabular-nums flex-shrink-0">
                          {m.accountNumber ?? m.staffId}
                        </span>
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200">{m.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* ボタン */}
                <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex gap-3">
                  <button
                    onClick={() => setModalState(null)}
                    className="flex-1 border border-zinc-200 dark:border-zinc-700 text-sm font-semibold py-2.5 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-zinc-700 dark:text-zinc-300"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleConfirmSend}
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
    </main>
  );
}

// ── サブコンポーネント ──────────────────────────────────────
function SummaryCard({ value, total, label, color }: { value: number; total?: number; label: string; color: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-center">
      <div className={`text-xl font-bold tabular-nums ${color}`}>
        {value}
        {total !== undefined && <span className="text-sm text-zinc-400 font-normal">/{total}</span>}
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
