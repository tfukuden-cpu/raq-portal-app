"use client";

/**
 * スタッフ情報パネル
 * シフト編集・確認モードでスタッフ名をタップしたときに表示するモーダル
 * セクション・稼働設定・優先・希望休申請・研修日を表示＋編集できる
 */

import { useState, useEffect, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { type TrainingEntry } from "@/components/TrainingSection";
import TrainingSection from "@/components/TrainingSection";
import OffRequestSection, { type OffRequestEntry } from "@/components/OffRequestSection";
import { fetchTrainingDatesAction } from "@/app/(portal)/admin/[projectId]/settings/training-actions";
import { fetchOffRequestsForStaffAction } from "@/app/(portal)/admin/[projectId]/settings/off-request-actions";
import { updateShiftSettingsAction } from "@/app/(portal)/admin/[projectId]/settings/actions";
import { overrideDraftCellsAction, deleteDraftCellsAction, replaceStaffHolidayDraftAction } from "@/app/(portal)/shifts/actions";

export type StaffInfoMember = {
  id: string;
  name: string;
  section: string | null;
  sections: string[];
  work_days_type: string | null;
  work_days_count: number | null;
  preferred_shift: string | null;
  preferred_section: string | null;
  max_consecutive_days: number | null;
  shift_note: string | null;
  endDate?: string | null;
};

// kept for backward compat — callers may still pass this but it's no longer displayed
export type StaffOffRequest = {
  request_date: string;
  priority: string;
  source: string;
};

export type StaffOffRequestEntry = {
  staff_id: string;
  request_date: string;
  priority: string;
  source?: string;
};

const OFF_PRIORITY_LABEL: Record<string, string> = {
  "第一希望休": "希休1",
  "第二希望休": "希休2",
  "第三希望休": "希休3",
  "第四希望休": "希休4",
  "冠婚葬祭":   "冠婚",
};

export default function StaffInfoPanel({
  member,
  projectId,
  availableSections,
  shiftPatternNames,
  staffOffRequests,
  onDraftCellsChanged,
  onDraftCellsRemoved,
  onSyncHolidays,
  onClose,
}: {
  member: StaffInfoMember;
  projectId: string;
  availableSections: string[];
  shiftPatternNames: string[];
  staffOffRequests?: StaffOffRequestEntry[];
  /** シフトドラフトへ即時反映するコールバック（ShiftEditGridのdraftsを更新） */
  onDraftCellsChanged?: (cells: { staffId: string; date: string; shiftName: string }[]) => void;
  onDraftCellsRemoved?: (cells: { staffId: string; date: string }[]) => void;
  /** 希望休の完全置換（months の月を全クリア後に newDates を希望休として再設定） */
  onSyncHolidays?: (staffId: string, months: string[], newDates: string[]) => void;
  onClose: () => void;
  /** @deprecated kept for compat, no longer used */
  offRequests?: StaffOffRequest[];
}) {
  const router = useRouter();

  // ── フェッチ状態 ──────────────────────────────────────────
  const [trainingDates,   setTrainingDates]   = useState<TrainingEntry[]>([]);
  const [offReqEntries,   setOffReqEntries]   = useState<OffRequestEntry[]>([]);
  const [fetching,        setFetching]        = useState(true);

  useEffect(() => {
    let cancelled = false;
    // スタッフ切り替え時に即座にリセット（古いデータで誤書き込みを防ぐ）
    setTrainingDates([]);
    setOffReqEntries([]);
    deletedOffDatesRef.current = new Set();
    setFetching(true);
    Promise.all([
      fetchTrainingDatesAction(member.id),
      fetchOffRequestsForStaffAction(projectId, member.id),
    ]).then(([trainings, offReqs]) => {
      if (cancelled) return;
      setTrainingDates(trainings);
      setOffReqEntries(offReqs);
      setFetching(false);
    }).catch(() => { if (!cancelled) setFetching(false); });
    return () => { cancelled = true; };
  }, [member.id, projectId]);

  // ── シフト設定編集状態 ────────────────────────────────────
  const [editOpen,           setEditOpen]           = useState(false);
  const [editSections,       setEditSections]       = useState<string[]>(member.sections.length > 0 ? member.sections : member.section ? [member.section] : []);
  const [editWorkDaysType,   setEditWorkDaysType]   = useState<"monthly" | "weekly">(
    (member.work_days_type as "monthly" | "weekly" | null) ?? "monthly"
  );
  const [editWorkDaysCount,  setEditWorkDaysCount]  = useState(String(member.work_days_count ?? ""));
  const [editPreferredShift, setEditPreferredShift] = useState(member.preferred_shift ?? "");
  const [editPreferredSec,   setEditPreferredSec]   = useState(member.preferred_section ?? "");
  const [editMaxConsec,      setEditMaxConsec]      = useState(String(member.max_consecutive_days ?? ""));
  const [editShiftNote,      setEditShiftNote]      = useState(member.shift_note ?? "");

  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTrans]   = useTransition();

  // ── シフト一括反映 ────────────────────────────────────────
  const [isApplying, startApplyTrans] = useTransition();
  const [applyMsg, setApplyMsg]       = useState<string | null>(null);
  // 最新データへアクセスするためref（保存ボタン押下時に最新値を参照）
  const trainingRef  = useRef(trainingDates);
  const offReqRef    = useRef(offReqEntries);
  trainingRef.current = trainingDates;
  offReqRef.current   = offReqEntries;

  // 今セッションで削除した希望休の日付を追跡（保存時に完全置換するため）
  const deletedOffDatesRef = useRef<Set<string>>(new Set());

  function handleApplyToShift() {
    if (!onDraftCellsChanged) return;
    startApplyTrans(async () => {
      const offEntries  = offReqRef.current;
      const trainEntries = trainingRef.current;

      // 希望休：差し替え対象月（現在の希望休の月 ＋ 削除した希望休の月）
      const holidayMonths = [...new Set([
        ...offEntries.map(r => r.request_date.slice(0, 7)),
        ...[...deletedOffDatesRef.current].map(d => d.slice(0, 7)),
      ])];

      const offDates = offEntries.map(r => r.request_date);
      const trainCells = trainEntries.map(t => ({ staffId: member.id, date: t.training_date, shiftName: t.training_name ?? "研修" }));

      if (holidayMonths.length === 0 && trainCells.length === 0) {
        setApplyMsg("反映する設定がありません");
        setTimeout(() => setApplyMsg(null), 2000);
        return;
      }

      // 希望休：月単位で完全置換（削除済み分も確実に消える）
      if (holidayMonths.length > 0) {
        await replaceStaffHolidayDraftAction(projectId, member.id, holidayMonths, offDates);
        onSyncHolidays?.(member.id, holidayMonths, offDates);
      }

      // 研修：追加のみ（既存保持）
      if (trainCells.length > 0) {
        await overrideDraftCellsAction(projectId, trainCells);
        onDraftCellsChanged(trainCells);
      }

      // 削除追跡をクリア（次回押下時に二重処理しない）
      deletedOffDatesRef.current = new Set();

      const total = offDates.length + trainCells.length;
      setApplyMsg(`${total}日をシフトに反映しました`);
      setTimeout(() => setApplyMsg(null), 2500);
    });
  }

  function handleSave() {
    setSaveError(null);
    startTrans(async () => {
      const r = await updateShiftSettingsAction(projectId, member.id, {
        sections:         editSections,
        workDaysType:     editWorkDaysType,
        workDaysCount:    editWorkDaysCount !== "" ? parseInt(editWorkDaysCount) : null,
        preferredShift:   editPreferredShift || null,
        preferredSection: editPreferredSec   || null,
        maxConsecDays:    editMaxConsec !== "" ? parseInt(editMaxConsec) : null,
        shiftNote:        editShiftNote      || null,
      });
      if (r.success) {
        setEditOpen(false);
        router.refresh();
      } else {
        setSaveError(r.message ?? "保存できませんでした");
      }
    });
  }

  const effectiveSections = editSections.length > 0
    ? editSections
    : member.sections.length > 0
      ? member.sections
      : member.section ? [member.section] : [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[90dvh] flex flex-col"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between shrink-0">
          <div>
            <p className="text-[11px] text-zinc-400 font-medium">スタッフ情報</p>
            <p className="text-base font-bold text-zinc-800 dark:text-zinc-100 leading-snug">{member.name}</p>
            <p className="text-xs text-zinc-400 tabular-nums">{member.id}</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-sm shrink-0 mt-0.5"
          >✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">

          {/* ── 基本設定（表示） ─────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">基本設定</p>
              <button
                type="button"
                onClick={() => { setEditOpen(v => !v); setSaveError(null); }}
                className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                {editOpen ? "閉じる" : "編集"}
              </button>
            </div>

            {!editOpen ? (
              /* ── 表示モード ── */
              <div className="space-y-1">
                <Row label="セクション">
                  {effectiveSections.length > 0
                    ? effectiveSections.map(s => (
                        <span key={s} className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold">{s}</span>
                      ))
                    : <span className="text-zinc-400 text-xs">未設定</span>
                  }
                </Row>
                <Row label="稼働設定">
                  <span className="text-xs text-zinc-700 dark:text-zinc-200">
                    {member.work_days_type === "weekly"
                      ? `週${member.work_days_count ?? "?"}日`
                      : `月${member.work_days_count ?? "?"}日`}
                  </span>
                </Row>
                <Row label="連勤上限">
                  <span className="text-xs text-zinc-700 dark:text-zinc-200">
                    {member.max_consecutive_days != null ? `${member.max_consecutive_days}日` : "未設定"}
                  </span>
                </Row>
                {member.preferred_shift && (
                  <Row label="優先シフト">
                    <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                      {member.preferred_shift}
                    </span>
                  </Row>
                )}
                {member.preferred_section && (
                  <Row label="優先セクション">
                    <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                      {member.preferred_section}
                    </span>
                  </Row>
                )}
                {member.shift_note && (
                  <Row label="備考">
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">{member.shift_note}</span>
                  </Row>
                )}
                {member.endDate && (
                  <Row label="退職予定日">
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold tabular-nums">{member.endDate}</span>
                  </Row>
                )}
              </div>
            ) : (
              /* ── 編集モード ── */
              <div className="space-y-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/10 p-3">

                {/* セクション */}
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold block mb-1">セクション（複数選択可）</label>
                  {availableSections.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {availableSections.map(s => {
                        const active = editSections.includes(s);
                        return (
                          <button key={s} type="button"
                            onClick={() => setEditSections(prev => active ? prev.filter(x => x !== s) : [...prev, s])}
                            className={["px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors",
                              active
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-blue-300",
                            ].join(" ")}>
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[10px] text-zinc-400">セクション未設定</p>
                  )}
                </div>

                {/* 稼働日数 */}
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold block mb-1">稼働日数</label>
                  <div className="flex items-center gap-2">
                    <select value={editWorkDaysType} onChange={e => setEditWorkDaysType(e.target.value as "monthly" | "weekly")}
                      className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-700 dark:text-zinc-300">
                      <option value="monthly">月</option>
                      <option value="weekly">週</option>
                    </select>
                    <input type="number" value={editWorkDaysCount}
                      onChange={e => setEditWorkDaysCount(e.target.value)}
                      placeholder="21" min={1} max={31}
                      className="w-16 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    <span className="text-xs text-zinc-500">日/{editWorkDaysType === "weekly" ? "週" : "月"}</span>
                  </div>
                </div>

                {/* 優先セクション（複数セクション時のみ） */}
                {editSections.length > 1 && (
                  <div>
                    <label className="text-[10px] text-zinc-500 font-semibold block mb-1">優先セクション</label>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => setEditPreferredSec("")}
                        className={["px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors",
                          !editPreferredSec
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700",
                        ].join(" ")}>
                        未設定
                      </button>
                      {editSections.map(s => (
                        <button key={s} type="button" onClick={() => setEditPreferredSec(s)}
                          className={["px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors",
                            editPreferredSec === s
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-blue-300",
                          ].join(" ")}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 優先シフトパターン */}
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold block mb-1">優先シフトパターン</label>
                  <select value={editPreferredShift} onChange={e => setEditPreferredShift(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                    <option value="">未設定</option>
                    {shiftPatternNames.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>

                {/* 連勤上限 */}
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold block mb-1">連勤上限（日）</label>
                  <input type="number" value={editMaxConsec}
                    onChange={e => setEditMaxConsec(e.target.value)}
                    placeholder="5（デフォルト）" min={1} max={31}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                </div>

                {/* 備考 */}
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold block mb-1">備考</label>
                  <input type="text" value={editShiftNote}
                    onChange={e => setEditShiftNote(e.target.value)}
                    placeholder="任意"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                </div>

                {saveError && <p className="text-[11px] text-red-500">{saveError}</p>}
                {isPending && <p className="text-[11px] text-zinc-400 animate-pulse">保存中…</p>}

                <div className="flex gap-2 pt-0.5">
                  <button type="button"
                    onClick={() => { setEditOpen(false); setSaveError(null); }}
                    disabled={isPending}
                    className="flex-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40">
                    キャンセル
                  </button>
                  <button type="button"
                    onClick={handleSave}
                    disabled={isPending}
                    className="flex-1 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-40 hover:bg-blue-700 transition-colors">
                    保存
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── 希望休 ───────────────────────────────────────── */}
          <section>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-1.5">希望休</p>
            {fetching ? (
              <p className="text-xs text-zinc-400 animate-pulse">読み込み中…</p>
            ) : (
              <OffRequestSection
                staffId={member.id}
                projectId={projectId}
                initialEntries={offReqEntries}
                onEntryAdded={async (newEntries) => {
                  const cells = newEntries.map(e => ({ staffId: member.id, date: e.date, shiftName: "希望休" }));
                  // 追加した日付は削除追跡から除外
                  for (const e of newEntries) deletedOffDatesRef.current.delete(e.date);
                  await overrideDraftCellsAction(projectId, cells);
                  onDraftCellsChanged?.(cells);
                }}
                onEntryRemoved={async (date) => {
                  // 削除した日付を追跡（保存ボタン押下時の完全置換に使う）
                  deletedOffDatesRef.current.add(date);
                  const cell = [{ staffId: member.id, date }];
                  await deleteDraftCellsAction(projectId, cell);
                  onDraftCellsRemoved?.(cell);
                }}
              />
            )}
          </section>

          {/* ── 研修設定 ─────────────────────────────────────── */}
          <section>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-1.5">研修設定</p>
            {fetching ? (
              <p className="text-xs text-zinc-400 animate-pulse">読み込み中…</p>
            ) : (
              <TrainingSection
                staffId={member.id}
                initialDates={trainingDates}
                onTrainingAdded={async (entries) => {
                  const cells = entries.map(e => ({ staffId: member.id, date: e.date, shiftName: e.name ?? "研修" }));
                  await overrideDraftCellsAction(projectId, cells);
                  onDraftCellsChanged?.(cells);
                }}
              />
            )}
          </section>

        </div>

        {/* フッター */}
        <div className="px-4 pb-3 pt-2 border-t border-zinc-100 dark:border-zinc-800 shrink-0 space-y-2">
          {/* シフト反映ボタン */}
          {onDraftCellsChanged && (
            <div>
              <button
                type="button"
                onClick={handleApplyToShift}
                disabled={isApplying || fetching}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 transition-colors"
              >
                {isApplying ? "反映中…" : "設定をシフトに保存・反映"}
              </button>
              {applyMsg && (
                <p className="text-center text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1">{applyMsg}</p>
              )}
            </div>
          )}
          <a
            href={`/members?edit=${member.id}`}
            className="block w-full py-2 rounded-xl text-center text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
          >
            メンバー設定を開く
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Row helper ─────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="text-[11px] text-zinc-400 w-20 shrink-0 pt-0.5">{label}</span>
      <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">{children}</div>
    </div>
  );
}
