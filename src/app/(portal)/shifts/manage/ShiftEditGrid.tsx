"use client";

/**
 * ShiftEditGrid — パターン軸グリッド編集モード
 *
 * 行 = シフトパターン、列 = 日付
 * 各セルにそのパターンで働くスタッフ名を上詰め表示
 *
 * ドラッグ: スタッフ名チップを別セルへ → パターン/日付を変更
 * タップ:  スタッフチップ → パターン変更/削除
 *          空セル        → スタッフを追加（希望休・公休スタッフも選択可）
 *          カウント行    → 必要人数をインライン編集
 *
 * 仮保存:  確定しないまま DB に下書きを保存、次回ロード時に続きから編集
 * 確定:    実際の shifts テーブルへ反映（変更ログ付き）
 */

import React, { useState, useMemo, useTransition, useRef, useEffect } from "react";
import {
  bulkUpsertShiftsAction,
  saveGridDraftAction,
  clearGridDraftAction,
  type BulkUpsertItem,
  type BulkDeleteItem,
  type GridDraftEntry,
} from "../actions";
import { upsertSlotRequirementsAction, notifyShiftChangesAction, regenerateShiftDraftAction, setSectionLockedAction, acquireEditLockAction, heartbeatEditLockAction, releaseEditLockAction, toggleShiftPublishedAction, setSvOrderAction } from "./actions";
import StaffInfoPanel from "./StaffInfoPanel";

// ── Types ──────────────────────────────────────────────────────

type Shift = {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
};
type Member = {
  id: string; name: string; section: string | null; sections: string[]; endDate?: string | null;
  work_days_type?: string | null; work_days_count?: number | null;
  preferred_shift?: string | null; preferred_section?: string | null;
  max_consecutive_days?: number | null; shift_note?: string | null;
  accountNumber?: string | null; churn_risk?: boolean; churn_risk_since?: string | null;
  company_name?: string | null; role?: string | null; start_date?: string | null;
  shift_published?: boolean | null; svOrder?: number | null;
};
type Pattern = {
  name: string;
  required_count: number;
  required_weekday: number | null;
  required_weekend: number | null;
  section: string | null;
  start_time: string | null;
  end_time: string | null;
};
type SlotReq = { section: string; pattern_name: string; shift_date: string; required_count: number };

export type ChangeLog = {
  staff_id: string;
  shift_date: string;
  action: string;
  before_shift_name: string | null;
  after_shift_name: string | null;
  changed_by_name: string;
  changed_at: string;
};

type DraftValue = { shiftName: string | null; shiftStart: string | null; shiftEnd: string | null };
type DraftCell = DraftValue | null;


type PendingNotify = {
  changes: { staffId: string; staffName: string; date: string; from: string | null; to: string | null }[];
  // まだ DB に書いていない保存データ
  upserts: BulkUpsertItem[];
  dels: BulkDeleteItem[];
  slotChanges: { patternName: string; date: string; section: string | null; requiredCount: number }[];
  targetMonth: string;
};

type OffRequest = { staff_id: string; request_date: string; priority: string; source?: string };

interface Props {
  projectId: string;
  targetMonth: string;
  allDates: string[];
  shifts: Shift[];
  activeMembers: Member[];
  shiftPatterns: Pattern[];
  slotRequirements: SlotReq[];
  changeLogs: ChangeLog[];
  initialDraft: GridDraftEntry[] | null;
  draftSavedBy: string | null;
  draftSavedAt: string | null;
  offRequests?: OffRequest[];
  isPublished?: boolean;
  initialLockedSections?: string[];
  initialSlotLockedSections?: string[];
  initialEditLock?: { lockedByName: string; lockedAt: string } | null;
  prevMonthShifts?: { staff_id: string; shift_date: string; shift_name: string | null }[];
  sortByAccount?: boolean;
  initialDeclinedIds?: string[];
  onSaved: () => void;
  onCancel: () => void;
}

// ── Section compatibility ──────────────────────────────────────
// パターンにセクション指定がある場合、スタッフも同じセクションでなければ配置不可
// sections（複数）と section（単一）の両方を考慮する
function canAssign(member: Member, pattern: Pattern): boolean {
  if (!pattern.section) return true;
  const secs = (member as { sections?: string[] }).sections;
  const effectiveSections = (secs && secs.length > 0)
    ? secs
    : (member.section ? [member.section] : []);
  return effectiveSections.includes(pattern.section);
}

// ── Date helpers ───────────────────────────────────────────────

const todayJST = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

function dowLabel(d: string) {
  return ["日", "月", "火", "水", "木", "金", "土"][new Date(d + "T00:00:00+09:00").getDay()];
}
function dowNum(d: string) {
  return new Date(d + "T00:00:00+09:00").getDay();
}
function fmtDate(d: string) {
  return `${parseInt(d.slice(5, 7))}/${parseInt(d.slice(8))}（${dowLabel(d)}）`;
}
function fmtAt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── InlinePatternPicker ─────────────────────────────────────────

function InlinePatternPicker({
  staffId, date, currentShift, staffMember, patterns,
  logs, consecutiveDays, isDuplicate, projectId,
  onAssign, onRemove, onClose,
  anchorRect,
}: {
  staffId: string; date: string; currentShift: string | null;
  staffMember: Member | null;
  patterns: Pattern[];
  logs: ChangeLog[];
  consecutiveDays: number;
  isDuplicate: boolean;
  projectId: string;
  onAssign: (p: string) => void;
  onRemove: () => void;
  onClose: () => void;
  anchorRect: { top: number; left: number; width: number; height: number };
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  // Position: try below the cell, flip up if near bottom
  const POPOVER_H = 280;
  const spaceBelow = window.innerHeight - anchorRect.top - anchorRect.height;
  const top = spaceBelow >= POPOVER_H + 8
    ? anchorRect.top + anchorRect.height + 4
    : anchorRect.top - POPOVER_H - 4;
  const left = Math.min(
    Math.max(4, anchorRect.left),
    window.innerWidth - 220 - 4,
  );

  const applicable = patterns.filter(p => !staffMember || canAssign(staffMember, p));

  return (
    <div
      ref={ref}
      className="fixed z-50 w-52 bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
      style={{ top, left }}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* ヘッダー */}
      <div className="px-3 pt-3 pb-2 border-b border-zinc-100 dark:border-zinc-800">
        <p className="text-[11px] text-zinc-400">{fmtDate(date)}</p>
        <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100 leading-snug truncate">
          {staffMember?.name ?? staffId}
        </p>
        {/* セクション */}
        {staffMember && (() => {
          const secs = (staffMember.sections ?? []).filter(Boolean);
          const display = secs.length > 0 ? secs : (staffMember.section ? [staffMember.section] : []);
          return display.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">
              {display.map(s => (
                <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[10px] text-zinc-400 mt-0.5 block">セクション未設定</span>
          );
        })()}
        {currentShift && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{currentShift}</p>
        )}
      </div>

      {/* 警告 */}
      {isDuplicate && (
        <div className="mx-2 mt-1.5 px-2 py-1 rounded-lg bg-red-50 dark:bg-red-950/40 text-[10px] font-bold text-red-600 dark:text-red-400">
          ⚠ この日に重複配置があります
        </div>
      )}
      {consecutiveDays >= 5 && (
        <div className="mx-2 mt-1.5 px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-[10px] font-bold text-amber-700 dark:text-amber-300">
          ⚠ {consecutiveDays}連勤になります
        </div>
      )}

      {/* パターンボタン */}
      <div className="max-h-40 overflow-y-auto px-2 pt-2 space-y-0.5">
        {applicable.map(p => (
          <button key={p.name} onClick={() => onAssign(p.name)}
            className={[
              "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left transition-colors",
              currentShift === p.name
                ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-bold"
                : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200",
            ].join(" ")}>
            <span className="text-xs font-semibold flex-1">{p.name}</span>
            {p.start_time && p.end_time && (
              <span className="text-[10px] text-zinc-400 tabular-nums shrink-0">
                {p.start_time.slice(0, 5)}～{p.end_time.slice(0, 5)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 公休ボタン + 閉じる */}
      <div className="px-2 pb-2 pt-1.5 space-y-1">
        <button onClick={onRemove}
          className={[
            "w-full py-1.5 rounded-xl text-xs font-semibold transition-colors",
            currentShift === "公休"
              ? "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
              : "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 hover:bg-amber-100",
          ].join(" ")}>
          公休に変更
        </button>

        {/* 変更履歴 */}
        {logs.length > 0 && (
          <div className="mt-1 space-y-0.5">
            <p className="text-[10px] text-zinc-400 px-1">変更履歴</p>
            <div className="max-h-24 overflow-y-auto space-y-0.5">
              {logs.map((l, i) => (
                <div key={i} className="text-[10px] text-zinc-500 dark:text-zinc-400 px-2 py-0.5 bg-zinc-50 dark:bg-zinc-800/60 rounded-lg leading-snug">
                  <span className="font-semibold text-zinc-600 dark:text-zinc-300">{l.changed_by_name}</span>
                  {" "}
                  {l.action === "delete" ? "削除"
                    : l.action === "create" ? "追加"
                    : `${l.before_shift_name ?? "（なし）"} → ${l.after_shift_name ?? "（なし）"}`}
                  <span className="ml-1 text-zinc-400">{fmtAt(l.changed_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={onClose}
          className="w-full py-1 rounded-xl text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ── SummaryModal ────────────────────────────────────────────────

function SummaryModal({
  draftChanges, onClose,
}: {
  draftChanges: { staffName: string; date: string; from: string | null; to: string | null }[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">変更サマリー</h2>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3">
          <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
            変更一覧（{draftChanges.length}件）
          </p>
          {draftChanges.length === 0 ? (
            <p className="text-sm text-zinc-400 text-center py-3">変更なし</p>
          ) : (
            <div className="space-y-1.5">
              {draftChanges.map((c, i) => (
                <div key={i} className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-700 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 truncate">{c.staffName}</p>
                    <p className="text-[11px] text-zinc-400">{fmtDate(c.date)}</p>
                  </div>
                  <div className="text-xs shrink-0 text-right leading-snug">
                    {!c.from && c.to && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">新規 {c.to}</span>
                    )}
                    {c.from && !c.to && (
                      <span className="text-red-500 dark:text-red-400 font-bold">{c.from} 削除</span>
                    )}
                    {c.from && c.to && (
                      <span>
                        <span className="text-zinc-400">{c.from}</span>
                        <span className="text-zinc-300 mx-1">→</span>
                        <span className="text-blue-600 dark:text-blue-400 font-semibold">{c.to}</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 pb-4 pt-2 shrink-0">
          <button onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

// ── NotifyModal ─────────────────────────────────────────────────

function NotifyModal({
  projectId, changes, upserts, dels, slotChanges, targetMonth,
  onCancel, onSaved,
}: {
  projectId: string;
  changes: PendingNotify["changes"];
  upserts: PendingNotify["upserts"];
  dels: PendingNotify["dels"];
  slotChanges: PendingNotify["slotChanges"];
  targetMonth: string;
  onCancel: () => void;  // 保存キャンセル（編集に戻る）
  onSaved: () => void;   // 保存完了
}) {
  // スタッフ別にグループ化
  const groups = useMemo(() => {
    const map = new Map<string, { staffId: string; staffName: string; rows: { date: string; from: string | null; to: string | null }[] }>();
    for (const c of changes) {
      if (!map.has(c.staffId)) map.set(c.staffId, { staffId: c.staffId, staffName: c.staffName, rows: [] });
      map.get(c.staffId)!.rows.push({ date: c.date, from: c.from, to: c.to });
    }
    return [...map.values()];
  }, [changes]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(groups.map(g => g.staffId)));
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; noLine: string[] } | null>(null);

  function toggleAll() {
    setSelected(prev => prev.size === groups.length ? new Set() : new Set(groups.map(g => g.staffId)));
  }

  // DB 保存（スロット必要数＋シフト）
  async function doSave(): Promise<boolean> {
    if (slotChanges.length > 0) {
      const rc = await upsertSlotRequirementsAction(projectId, slotChanges);
      if (!rc.success) { setSaveError(rc.message ?? "必要人数の保存に失敗しました"); return false; }
    }
    if (upserts.length > 0 || dels.length > 0) {
      const r = await bulkUpsertShiftsAction(projectId, upserts, dels);
      if (!r.success) { setSaveError(r.message ?? "保存に失敗しました"); return false; }
    }
    await clearGridDraftAction(projectId, targetMonth);
    return true;
  }

  // 「通知なしで確定」：保存のみ
  async function handleSaveOnly() {
    setBusy(true);
    setSaveError(null);
    const ok = await doSave();
    setBusy(false);
    if (ok) onSaved();
  }

  // 「LINEで送信」で保存＋通知
  async function handleSend() {
    setBusy(true);
    setSaveError(null);
    const ok = await doSave();
    if (!ok) { setBusy(false); return; }
    const targets = groups
      .filter(g => selected.has(g.staffId))
      .map(g => ({ staffId: g.staffId, staffName: g.staffName, changes: g.rows }));
    const r = await notifyShiftChangesAction(projectId, targets);
    setBusy(false);
    setResult({ sent: r.sent ?? 0, noLine: r.noLine ?? [] });
  }

  const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
  function fmtD(d: string) {
    const dt = new Date(d + "T00:00:00+09:00");
    return `${dt.getMonth() + 1}/${dt.getDate()}（${WEEKDAY_JP[dt.getDay()]}）`;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={result ? onSaved : undefined}>
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">
            {result ? "通知完了" : "変更をLINEで通知しますか？"}
          </h2>
          {!result && (
            <p className="text-xs text-zinc-400 mt-0.5">LINE未連携のスタッフには送信されません</p>
          )}
        </div>

        {/* 保存エラー */}
        {saveError && (
          <div className="px-4 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800 shrink-0">
            {saveError}
          </div>
        )}

        {result ? (
          <div className="px-4 py-6 flex-1 space-y-3">
            <p className="text-sm text-zinc-700 dark:text-zinc-200">
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{result.sent}件</span> 送信しました
            </p>
            {result.noLine.length > 0 && (
              <p className="text-xs text-zinc-400">
                LINE未連携: {result.noLine.join("、")}
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
            {/* 全選択 */}
            {changes.length > 0 && (
              <button
                onClick={toggleAll}
                className="text-xs text-blue-600 dark:text-blue-400 font-semibold"
              >
                {selected.size === groups.length ? "全て解除" : "全て選択"}
              </button>
            )}

            {groups.map(g => (
              <div key={g.staffId} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(g.staffId)}
                  onChange={() => setSelected(prev => {
                    const n = new Set(prev);
                    n.has(g.staffId) ? n.delete(g.staffId) : n.add(g.staffId);
                    return n;
                  })}
                  className="mt-1 w-4 h-4 rounded accent-blue-600 shrink-0"
                />
                <div className="flex-1 min-w-0 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl px-3 py-2 border border-zinc-100 dark:border-zinc-700">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">{g.staffName}</p>
                  {g.rows.map((r, i) => (
                    <p key={i} className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums leading-snug">
                      {fmtD(r.date)}{" "}
                      {!r.from && r.to && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{r.to} 新規追加</span>}
                      {r.from && !r.to && <span className="text-red-500 dark:text-red-400 font-semibold">{r.from} 削除</span>}
                      {r.from && r.to && <span>{r.from} → <span className="text-blue-600 dark:text-blue-400 font-semibold">{r.to}</span></span>}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-4 pb-4 pt-2 flex flex-col gap-2 shrink-0">
          {result ? (
            <button onClick={onSaved}
              className="py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors">
              閉じる
            </button>
          ) : (
            <>
              {/* LINE送信：保存＋通知（メインアクション） */}
              <button onClick={handleSend} disabled={busy || selected.size === 0}
                className="py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors">
                {busy ? "保存中…" : `LINEで通知して確定（${selected.size}名）`}
              </button>
              <div className="flex gap-2">
                {/* キャンセル：保存せず編集に戻る */}
                <button onClick={onCancel} disabled={busy}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors">
                  キャンセル
                </button>
                {/* 通知なしで確定：保存のみ */}
                <button onClick={handleSaveOnly} disabled={busy}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors">
                  通知なしで確定
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Main ────────────────────────────────────────────────────────

// ── セクション × 早番/遅番 カラーテーブル ───────────────────────
// セクションのメインカラーを決め、early（早番）=薄色、late（遅番）=濃色
const SECTION_SHIFT_COLORS: Record<string, { early: string; late: string; def: string }> = {
  "SV":       { early: "bg-blue-100 dark:bg-blue-900/50",     late: "bg-blue-300 dark:bg-blue-700/70",     def: "bg-blue-200 dark:bg-blue-800/60" },
  "査定":     { early: "bg-emerald-100 dark:bg-emerald-900/50", late: "bg-emerald-300 dark:bg-emerald-700/70", def: "bg-emerald-200 dark:bg-emerald-800/60" },
  "販売":     { early: "bg-orange-100 dark:bg-orange-900/50",  late: "bg-orange-300 dark:bg-orange-700/70",  def: "bg-orange-200 dark:bg-orange-800/60" },
  "MOTA":     { early: "bg-red-100 dark:bg-red-900/50",       late: "bg-red-300 dark:bg-red-700/70",       def: "bg-red-200 dark:bg-red-800/60" },
  "リメイク": { early: "bg-pink-100 dark:bg-pink-900/50",     late: "bg-pink-300 dark:bg-pink-700/70",     def: "bg-pink-200 dark:bg-pink-800/60" },
  "ローン":   { early: "bg-violet-100 dark:bg-violet-900/50", late: "bg-violet-300 dark:bg-violet-700/70", def: "bg-violet-200 dark:bg-violet-800/60" },
};
const SECTION_SHIFT_FALLBACK = { early: "bg-sky-100 dark:bg-sky-900/50", late: "bg-sky-300 dark:bg-sky-700/70", def: "bg-sky-200 dark:bg-sky-800/60" };

function getPatternBg(shiftName: string | null, pattern: Pattern | null): string {
  if (!shiftName || shiftName === "公休" || shiftName === "希望休" || shiftName === "有休" || shiftName === "特別休暇") return "";
  if (!pattern) return "";
  const colors = SECTION_SHIFT_COLORS[pattern.section ?? ""] ?? SECTION_SHIFT_FALLBACK;
  // パターン名で早番/遅番を判定（優先）
  if (shiftName.includes("早番")) return colors.early;
  if (shiftName.includes("遅番")) return colors.late;
  // 名前に含まれない場合は開始時刻で判定
  const startH = pattern.start_time ? parseInt(pattern.start_time.split(":")[0], 10) : null;
  if (startH !== null && startH < 12) return colors.early;
  if (startH !== null && startH >= 12) return colors.late;
  return colors.def;
}

const OFF_PRIORITY_LABEL: Record<string, string> = {
  "第一希望休": "希休1",
  "第二希望休": "希休2",
  "第三希望休": "希休3",
  "第四希望休": "希休4",
  "冠婚葬祭":   "冠婚",
};

export default function ShiftEditGrid({
  projectId, targetMonth, allDates, shifts, activeMembers,
  shiftPatterns, slotRequirements, changeLogs,
  initialDraft, draftSavedBy, draftSavedAt,
  offRequests, isPublished, initialLockedSections, initialSlotLockedSections,
  initialEditLock,
  prevMonthShifts, sortByAccount,
  initialDeclinedIds = [],
  onSaved, onCancel,
}: Props) {
  // 追加不可フラグ
  const [declinedIds, setDeclinedIds] = useState<Set<string>>(() => new Set(initialDeclinedIds));
  const [decliningKey, setDecliningKey] = useState<string | null>(null);

  async function handleToggleDeclineEdit(staffId: string, date: string) {
    const key = `${staffId}__${date}`;
    setDecliningKey(key);
    const { toggleWorkRequestDeclineShiftAction } = await import("./actions");
    const res = await toggleWorkRequestDeclineShiftAction(projectId, staffId, date);
    if (res.ok) {
      setDeclinedIds(prev => {
        const next = new Set(prev);
        if (res.isDeclined) next.add(key); else next.delete(key);
        return next;
      });
    }
    setDecliningKey(null);
  }

  // offRequests マップ: staffId__date → priority
  const offRequestMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of offRequests ?? []) m.set(`${r.staff_id}__${r.request_date}`, r.priority);
    return m;
  }, [offRequests]);
  // ── Draft 状態 ─────────────────────────────────────────────────
  const [drafts, setDrafts] = useState<Map<string, DraftCell>>(() => {
    if (!initialDraft || initialDraft.length === 0) return new Map();
    const m = new Map<string, DraftCell>();
    for (const e of initialDraft) {
      // 旧フォーマット互換: { staffId, date, shiftName, shiftStart, shiftEnd }
      // 新フォーマット:     { k, n, s, e, d }
      const raw = e as unknown as Record<string, unknown>;
      const key = (typeof e.k === "string" && e.k)
        ? e.k
        : (typeof raw.staffId === "string" && typeof raw.date === "string")
        ? `${raw.staffId}__${raw.date}`
        : null;
      if (!key) continue;
      const shiftName = (typeof e.n === "string" ? e.n : typeof raw.shiftName === "string" ? raw.shiftName : null);
      const shiftStart = (typeof e.s === "string" ? e.s : typeof raw.shiftStart === "string" ? raw.shiftStart : null);
      const shiftEnd  = (typeof e.e === "string" ? e.e : typeof raw.shiftEnd  === "string" ? raw.shiftEnd  : null);
      const isDelete  = e.d === true;
      m.set(key, isDelete ? null : { shiftName, shiftStart, shiftEnd });
    }
    return m;
  });
  const [showSummary, setShowSummary] = useState(false);
  const [isPending] = useTransition();
  const [isSavingDraft, startDraftTransition] = useTransition();
  const [isRegenerating, startRegenTransition] = useTransition();
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenDone, setRegenDone] = useState<number | null>(null); // 完了後の割当数
  const [regenSection, setRegenSection] = useState<string>(""); // "" = 全セクション
  // 仮確定セクション管理（人確定・枠確定の2種類）
  const [staffLockedSections, setStaffLockedSections] = useState<Set<string>>(
    () => new Set(initialLockedSections ?? [])
  );
  const [slotLockedSections, setSlotLockedSections] = useState<Set<string>>(
    () => new Set(initialSlotLockedSections ?? [])
  );
  const [isLocking, startLockTransition] = useTransition();
  const [lockError, setLockError] = useState<string | null>(null);
  // 同時編集ロック
  const [editLock, setEditLock] = useState<{ lockedByName: string; lockedAt: string } | null>(
    initialEditLock ?? null
  );
  const [isLockedByOther, setIsLockedByOther] = useState(!!initialEditLock);
  // undo/redo スタック（個別セル編集・再仮組みを追跡）
  const MAX_UNDO = 50;
  const [undoStack, setUndoStack] = useState<Array<Map<string, DraftCell>>>([]);
  const [redoStack, setRedoStack] = useState<Array<Map<string, DraftCell>>>([]);
  // 保存系エラー（上部バナー）
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);
  // 確定後通知モーダル
  const [pendingNotify, setPendingNotify] = useState<PendingNotify | null>(null);
  // 充足サマリー行の表示/非表示
  const [showSummaryRows, setShowSummaryRows] = useState(true);
  // 並び順：既定はアカウント番号順（基本1）。トグルでセクション順にも切替可
  const [sortByAccountLocal, setSortByAccountLocal] = useState(sortByAccount ?? true);
  // SV のみ手動並び替え可（DB project_members.sort_order に永続化・楽観更新）
  const [svOrderLocal, setSvOrderLocal] = useState<string[]>(() =>
    [...activeMembers]
      .filter(m => m.section === "SV")
      .sort((a, b) => {
        const oa = a.svOrder ?? Infinity;
        const ob = b.svOrder ?? Infinity;
        return oa !== ob ? oa - ob : a.name.localeCompare(b.name, "ja");
      })
      .map(m => m.id)
  );
  const svRankMap = useMemo(() => {
    const m = new Map<string, number>();
    svOrderLocal.forEach((id, i) => m.set(id, i));
    return m;
  }, [svOrderLocal]);
  // SV を一つ上/下へ移動して並び順を保存
  const moveSv = (staffId: string, dir: -1 | 1) => {
    setSvOrderLocal(prev => {
      const list = prev.includes(staffId) ? [...prev] : [...prev, staffId];
      const i = list.indexOf(staffId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return prev;
      [list[i], list[j]] = [list[j], list[i]];
      void setSvOrderAction(projectId, list);
      return list;
    });
  };
  // セクションフィルタ（"" = 全員表示）
  const [filterSection, setFilterSection] = useState<string>("");
  // 個別シフト公開フラグ（staffId → published）- 楽観的更新
  const [publishedOverrides, setPublishedOverrides] = useState<Map<string, boolean>>(() => {
    const m = new Map<string, boolean>();
    for (const member of activeMembers) {
      if (member.shift_published === false) m.set(member.id, false);
    }
    return m;
  });
  const [publishingId, setPublishingId] = useState<string | null>(null);

  async function handleToggleShiftPublished(staffId: string) {
    const current = publishedOverrides.get(staffId) ?? true;
    const next = !current;
    setPublishedOverrides(prev => new Map(prev).set(staffId, next));
    setPublishingId(staffId);
    const res = await toggleShiftPublishedAction(projectId, staffId, next);
    if (!res.success) {
      setPublishedOverrides(prev => new Map(prev).set(staffId, current));
    }
    setPublishingId(null);
  }

  // 日付ソート・フィルター（null = 無効）
  type ActiveDateFilter = {
    date: string;
    sortBy: "section" | "shift";
    filterSections: string[];
    filterShifts: string[];
  };
  const [activeDateFilter, setActiveDateFilter] = useState<ActiveDateFilter | null>(null);
  const [dateFilterPopoverDate, setDateFilterPopoverDate] = useState<string | null>(null);
  const [dateFilterPopoverRect, setDateFilterPopoverRect] = useState<DOMRect | null>(null);

  function openDateFilterPopover(date: string, rect: DOMRect) {
    if (dateFilterPopoverDate === date) {
      setDateFilterPopoverDate(null);
      return;
    }
    setDateFilterPopoverDate(date);
    setDateFilterPopoverRect(rect);
    if (!activeDateFilter || activeDateFilter.date !== date) {
      setActiveDateFilter({ date, sortBy: "section", filterSections: [], filterShifts: [] });
    }
  }

  const shiftsOnDate = useMemo(() => {
    if (!dateFilterPopoverDate) return [];
    const names = new Set<string>();
    for (const m of activeMembers) {
      const key = `${m.id}__${dateFilterPopoverDate}`;
      const sn = drafts.has(key)
        ? (drafts.get(key)?.shiftName ?? null)
        : (shifts.find(s => s.staff_id === m.id && s.shift_date === dateFilterPopoverDate)?.shift_name ?? null);
      if (sn) names.add(sn);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "ja"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilterPopoverDate, drafts, shifts, activeMembers]);
  // インラインパターンピッカー
  type PopoverTarget = { staffId: string; date: string; rect: DOMRect };
  const [popover, setPopover] = useState<PopoverTarget | null>(null);
  // 不足対応：充足サマリーセルのタップで選択
  const [selectedShortage, setSelectedShortage] = useState<{ date: string; patternName: string } | null>(null);
  // スタッフ情報パネル
  const [staffInfoTarget, setStaffInfoTarget] = useState<Member | null>(null);
  // 離脱リスクのローカルオーバーライド（トグル直後のライブ反映用）
  const [churnRiskOverrides, setChurnRiskOverrides] = useState<Map<string, { churn_risk: boolean; churn_risk_since: string | null }>>(new Map());
  // 候補スタッフ選択（行フォーカス）
  const [focusedCandidateId, setFocusedCandidateId] = useState<string | null>(null);
  const staffRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  // ── 必要枠数インライン編集 ────────────────────────────────────────
  // サーバー DB に保存後、ページリロードなしで即時反映するためのローカルオーバーライド
  const [localSlotReqOverrides, setLocalSlotReqOverrides] = useState<Map<string, number>>(new Map());
  const [reqEditPattern, setReqEditPattern] = useState<Pattern | null>(null);
  const [reqEditValues, setReqEditValues] = useState<Map<string, string>>(new Map());
  const [isSavingReqs, startReqSaveTransition] = useTransition();
  const [reqSaveMsg, setReqSaveMsg] = useState<string | null>(null);

  // ── 分割ペイン ──────────────────────────────────────────────────
  const [splitRatio, setSplitRatio] = useState(0.32);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingDiv = useRef(false);
  const sufficiencyPaneRef = useRef<HTMLDivElement>(null);
  const staffPaneRef = useRef<HTMLDivElement>(null);
  const isSyncingScrollX = useRef(false);

  const handleEditGridSufficiencyScroll = (scrollLeft: number) => {
    if (isSyncingScrollX.current) return;
    isSyncingScrollX.current = true;
    if (staffPaneRef.current) staffPaneRef.current.scrollLeft = scrollLeft;
    requestAnimationFrame(() => { isSyncingScrollX.current = false; });
  };
  const handleEditGridStaffScroll = (scrollLeft: number) => {
    if (isSyncingScrollX.current) return;
    isSyncingScrollX.current = true;
    if (sufficiencyPaneRef.current) sufficiencyPaneRef.current.scrollLeft = scrollLeft;
    requestAnimationFrame(() => { isSyncingScrollX.current = false; });
  };
  const handleDividerDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDraggingDiv.current = true;
    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!isDraggingDiv.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const clientY = "touches" in ev ? ev.touches[0].clientY : ev.clientY;
      const ratio = (clientY - rect.top) / rect.height;
      setSplitRatio(Math.min(0.8, Math.max(0.1, ratio)));
    };
    const onUp = () => {
      isDraggingDiv.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
  };

  // 候補スタッフ選択時にその行へスクロール
  useEffect(() => {
    if (!focusedCandidateId) return;
    const el = staffRowRefs.current.get(focusedCandidateId);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focusedCandidateId]);

  // 充足テーブルON時: スタッフペインのscrollLeftに合わせて同期
  useEffect(() => {
    if (showSummaryRows && sufficiencyPaneRef.current && staffPaneRef.current) {
      sufficiencyPaneRef.current.scrollLeft = staffPaneRef.current.scrollLeft;
    }
  }, [showSummaryRows]);

  // ── Lookup maps ─────────────────────────────────────────────────
  const shiftsByKey = useMemo(() => {
    const m = new Map<string, Shift>();
    for (const s of shifts) m.set(`${s.staff_id}__${s.shift_date}`, s);
    return m;
  }, [shifts]);

  const memberById = useMemo(() => {
    const m = new Map<string, Member>();
    for (const mb of activeMembers) m.set(mb.id, mb);
    return m;
  }, [activeMembers]);

  const patternByName = useMemo(() => {
    const m = new Map<string, Pattern>();
    for (const p of shiftPatterns) m.set(p.name, p);
    return m;
  }, [shiftPatterns]);

  // 勤務パターン名セット（希望休・公休を区別するため）
  const patternNameSet = useMemo(
    () => new Set(shiftPatterns.map(p => p.name)),
    [shiftPatterns]
  );

  const slotReqMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of slotRequirements) m.set(`${r.pattern_name}__${r.shift_date}`, r.required_count);
    return m;
  }, [slotRequirements]);

  // 変更ログ: staffId__shiftDate → ChangeLog[]
  const changeLogMap = useMemo(() => {
    const m = new Map<string, ChangeLog[]>();
    for (const l of changeLogs) {
      const key = `${l.staff_id}__${l.shift_date}`;
      const arr = m.get(key) ?? [];
      arr.push(l);
      m.set(key, arr);
    }
    return m;
  }, [changeLogs]);

  // 離脱リスクスタッフ: staffId → churn_risk_since (フラグが立っているものだけ、オーバーライド込み)
  const churnRiskSinceMap = useMemo(
    () => {
      const map = new Map<string, string | null>();
      for (const m of activeMembers) {
        const ov = churnRiskOverrides.get(m.id);
        const risk  = ov !== undefined ? ov.churn_risk  : (m.churn_risk ?? false);
        const since = ov !== undefined ? ov.churn_risk_since : (m.churn_risk_since ?? null);
        if (risk) map.set(m.id, since);
      }
      return map;
    },
    [activeMembers, churnRiskOverrides]
  );

  // 充足カウント（離脱リスク & フラグ設定日以降のシフト日は除外）
  function getEffectiveCount(patternName: string, date: string): number {
    return (resolvedGrid.get(`${patternName}__${date}`) ?? [])
      .filter(id => {
        if (!churnRiskSinceMap.has(id)) return true;        // フラグなし → カウント対象
        const since = churnRiskSinceMap.get(id) ?? null;
        if (!since) return false;                            // since 未設定 → 全除外
        return date < since;                                 // フラグ設定日より前 → カウント対象
      }).length;
  }

  function getRequired(patternName: string, date: string): number {
    // インライン編集後のローカルオーバーライドを最優先
    const localKey = `${patternName}__${date}`;
    if (localSlotReqOverrides.has(localKey)) return localSlotReqOverrides.get(localKey)!;
    // DB の日別オーバーライド
    const k = `${patternName}__${date}`;
    if (slotReqMap.has(k)) return slotReqMap.get(k)!;
    // パターンの平日/土日デフォルト
    const pattern = shiftPatterns.find(p => p.name === patternName);
    if (!pattern) return 0;
    const dow = new Date(date).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    if (isWeekend && pattern.required_weekend != null) return pattern.required_weekend;
    if (!isWeekend && pattern.required_weekday != null) return pattern.required_weekday;
    return pattern.required_count;
  }

  // ── Resolve cell ───────────────────────────────────────────────
  function resolveCell(staffId: string, date: string): DraftValue | null {
    const key = `${staffId}__${date}`;
    if (drafts.has(key)) return drafts.get(key) ?? null;
    const s = shiftsByKey.get(key);
    if (!s) return null;
    return { shiftName: s.shift_name, shiftStart: s.shift_start, shiftEnd: s.shift_end };
  }

  // ── resolvedGrid: patternName__date → staffId[] (上詰め) ──────
  const resolvedGrid = useMemo(() => {
    const grid = new Map<string, string[]>();
    for (const s of shifts) {
      if (!s.shift_name) continue;
      const k = `${s.shift_name}__${s.shift_date}`;
      const arr = grid.get(k) ?? [];
      arr.push(s.staff_id);
      grid.set(k, arr);
    }
    for (const [draftKey, draftVal] of drafts) {
      const [staffId, shiftDate] = draftKey.split("__");
      const orig = shiftsByKey.get(draftKey);
      if (orig?.shift_name) {
        const k = `${orig.shift_name}__${shiftDate}`;
        grid.set(k, (grid.get(k) ?? []).filter((id) => id !== staffId));
      }
      if (draftVal !== null && draftVal.shiftName) {
        const k = `${draftVal.shiftName}__${shiftDate}`;
        const arr = grid.get(k) ?? [];
        if (!arr.includes(staffId)) { arr.push(staffId); grid.set(k, arr); }
      }
    }
    return grid;
  }, [shifts, drafts, shiftsByKey]);

  // ── 重複検出: staffId__date → 配置パターン[] ─────────────────
  const duplicateStaffDates = useMemo(() => {
    const countMap = new Map<string, string[]>();
    for (const date of allDates) {
      for (const p of shiftPatterns) {
        const staffList = resolvedGrid.get(`${p.name}__${date}`) ?? [];
        for (const staffId of staffList) {
          const k = `${staffId}__${date}`;
          const arr = countMap.get(k) ?? [];
          arr.push(p.name);
          countMap.set(k, arr);
        }
      }
    }
    const dupSet = new Set<string>();
    for (const [k, patterns] of countMap) {
      if (patterns.length > 1) dupSet.add(k);
    }
    return { set: dupSet, map: countMap };
  }, [resolvedGrid, allDates, shiftPatterns]);

  // ── 人数不足リスト ─────────────────────────────────────────────
  // ── セクション仮確定ステータス ─────────────────────────────────
  // 'none' = 未着手, 'draft' = ドラフト済, 'staff_locked' = 人確定, 'slot_locked' = 枠確定
  const sectionDraftStatus = useMemo(() => {
    const status = new Map<string, "none" | "draft" | "staff_locked" | "slot_locked">();
    const sections = [...new Set(
      shiftPatterns.map(p => p.section).filter((s): s is string => !!s)
    )];
    for (const section of sections) {
      if (staffLockedSections.has(section)) {
        status.set(section, "staff_locked");
        continue;
      }
      if (slotLockedSections.has(section)) {
        status.set(section, "slot_locked");
        continue;
      }
      const sectionPatternNames = new Set(
        shiftPatterns.filter(p => p.section === section).map(p => p.name)
      );
      let hasDraft = false;
      for (const [, val] of drafts) {
        if (val !== null && val.shiftName && sectionPatternNames.has(val.shiftName)) {
          hasDraft = true;
          break;
        }
      }
      status.set(section, hasDraft ? "draft" : "none");
    }
    return status;
  }, [shiftPatterns, staffLockedSections, slotLockedSections, drafts]);

  // 仮確定トグル（枠確定 / 人確定 / 解除）
  // 確定時は現在のdraftをDBに同時保存する（再仮組み時の除外保護を確実にするため）
  function handleToggleLock(sectionName: string, lockType: "none" | "slot" | "staff") {
    setLockError(null);
    startLockTransition(async () => {
      const currentEntries = serializeDrafts();
      const r = await setSectionLockedAction(projectId, targetMonth, sectionName, lockType, currentEntries);
      if (r.success) {
        setStaffLockedSections(prev => {
          const next = new Set(prev);
          next.delete(sectionName);
          if (lockType === "staff") next.add(sectionName);
          return next;
        });
        setSlotLockedSections(prev => {
          const next = new Set(prev);
          next.delete(sectionName);
          if (lockType === "slot") next.add(sectionName);
          return next;
        });
      } else {
        setLockError(r.message ?? "仮確定の変更に失敗しました");
      }
    });
  }

  // ── 変更一覧（サマリー用） ─────────────────────────────────────
  const draftChanges = useMemo(() => {
    const changes: { staffId: string; staffName: string; date: string; from: string | null; to: string | null }[] = [];
    for (const [key, draftVal] of drafts) {
      const [sId, shiftDate] = key.split("__");
      const staffName = memberById.get(sId)?.name ?? sId;
      const fromPattern = shiftsByKey.get(key)?.shift_name ?? null;
      const toPattern = draftVal?.shiftName ?? null;
      changes.push({ staffId: sId, staffName, date: shiftDate, from: fromPattern, to: toPattern });
    }
    return changes.sort((a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName));
  }, [drafts, memberById, shiftsByKey]);


  // ── 連続勤務日数計算 ───────────────────────────────────────────
  function isStaffWorkingOn(staffId: string, date: string): boolean {
    for (const p of shiftPatterns) {
      if ((resolvedGrid.get(`${p.name}__${date}`) ?? []).includes(staffId)) return true;
    }
    return false;
  }
  function getConsecutiveDays(staffId: string, date: string): number {
    const idx = allDates.indexOf(date);
    if (idx < 0) return 1;
    let before = 0, after = 0;
    for (let i = idx - 1; i >= 0; i--) {
      if (!isStaffWorkingOn(staffId, allDates[i])) break;
      before++;
    }
    for (let i = idx + 1; i < allDates.length; i++) {
      if (!isStaffWorkingOn(staffId, allDates[i])) break;
      after++;
    }
    return before + 1 + after;
  }

  // ── undo/redo ─────────────────────────────────────────────────
  // 編集を追跡して undoStack に push し drafts を更新
  function applyEdit(newState: Map<string, DraftCell>) {
    setUndoStack(prev => [...prev.slice(-(MAX_UNDO - 1)), new Map(drafts)]);
    setRedoStack([]);
    setDrafts(newState);
  }

  function handleUndo() {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, new Map(drafts)]);
    setDrafts(new Map(prev));
    setUndoStack(s => s.slice(0, -1));
    setSaveError(null);
  }

  function handleRedo() {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(s => [...s, new Map(drafts)]);
    setDrafts(new Map(next));
    setRedoStack(r => r.slice(0, -1));
    setSaveError(null);
  }

  // ── Popover handlers ──────────────────────────────────────────
  function handlePopoverAssign(patternName: string) {
    if (!popover) return;
    const { staffId, date } = popover;
    const key = `${staffId}__${date}`;
    const p = patternByName.get(patternName);
    const orig = shiftsByKey.get(key);
    const next = new Map(drafts);
    next.set(key, { shiftName: patternName, shiftStart: p?.start_time ?? orig?.shift_start ?? null, shiftEnd: p?.end_time ?? orig?.shift_end ?? null });
    applyEdit(next);
    setPopover(null);
  }
  function handlePopoverRemove() {
    if (!popover) return;
    const key = `${popover.staffId}__${popover.date}`;
    const next = new Map(drafts);
    next.set(key, { shiftName: "公休", shiftStart: null, shiftEnd: null });
    applyEdit(next);
    setPopover(null);
  }

  // ── 仮保存 ────────────────────────────────────────────────────
  function serializeDrafts(): GridDraftEntry[] {
    const entries: GridDraftEntry[] = [];
    for (const [k, v] of drafts) {
      if (v === null) {
        entries.push({ k, n: null, s: null, e: null, d: true });
      } else {
        entries.push({ k, n: v.shiftName, s: v.shiftStart, e: v.shiftEnd, d: false });
      }
    }
    return entries;
  }

  function handleSaveDraft() {
    const entries = serializeDrafts();
    setSaveError(null);
    startDraftTransition(async () => {
      const r = await saveGridDraftAction(projectId, targetMonth, entries);
      if (r.ok) {
        const now = new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
        setDraftMsg(`仮保存しました（${now}）`);
        setTimeout(() => setDraftMsg(null), 3000);
      } else {
        setSaveError(r.message ?? "仮保存に失敗しました");
      }
    });
  }

  // ── 再仮組み ──────────────────────────────────────────────────
  // overrideLocked=true のときのみロック済みセクションも上書き（明示的な全上書き）
  function handleRegen(targetSection?: string, overrideLocked?: boolean) {
    setRegenError(null);
    setRegenDone(null);
    startRegenTransition(async () => {
      const [y, m] = targetMonth.split("-").map(Number);
      // noSave=true: DBへ書き込まず、返ってきたエントリのみグリッドに反映
      // 全体再仮組みかつ overrideLocked でない場合はロック済みセクションをサーバー側でもスキップ
      const allLockedForSkip = new Set([...staffLockedSections, ...slotLockedSections]);
      const skipForServer = (!targetSection && !overrideLocked && allLockedForSkip.size > 0)
        ? [...allLockedForSkip] : undefined;
      const r = await regenerateShiftDraftAction(projectId, y, m, targetSection || undefined, true, skipForServer);
      if (!r.success) {
        setRegenError(r.message ?? "再仮組みに失敗しました");
        return;
      }

      // draftEntries → Map に変換するヘルパー
      function parseDraftEntries(entries: typeof r.draftEntries): Map<string, DraftCell> {
        const result = new Map<string, DraftCell>();
        for (const e of entries ?? []) {
          const raw = e as unknown as Record<string, unknown>;
          const key = (typeof e.k === "string" && e.k)
            ? e.k
            : (typeof raw.staffId === "string" && typeof raw.date === "string")
            ? `${raw.staffId}__${raw.date}` : null;
          if (!key) continue;
          const shiftName  = typeof e.n === "string" ? e.n : null;
          const shiftStart = typeof e.s === "string" ? e.s : null;
          const shiftEnd   = typeof e.e === "string" ? e.e : null;
          result.set(key, e.d ? null : { shiftName, shiftStart, shiftEnd });
        }
        return result;
      }

      let newState: Map<string, DraftCell>;
      if (targetSection) {
        // セクション指定の場合: 対象セクションのエントリのみ差し替え、他セクションは現在の drafts を保持
        const regenPatternNames = new Set(
          shiftPatterns.filter(p => p.section === targetSection).map(p => p.name)
        );
        // 全パターン名セット（研修・公休など「パターン外の特殊シフト」の判定に使用）
        const allPatternNames = new Set(shiftPatterns.map(p => p.name));
        const merged = new Map(drafts);
        for (const [key, val] of [...merged]) {
          if (val !== null && val.shiftName && regenPatternNames.has(val.shiftName)) {
            merged.delete(key);
          }
          // 削除済みパターン名のエントリも除去（サーバー側の staleOverride で上書きされる）
          if (val !== null && val.shiftName && !allPatternNames.has(val.shiftName)) {
            merged.delete(key);
          }
        }
        for (const [key, val] of parseDraftEntries(r.draftEntries)) {
          if (
            val === null ||                                                   // 削除マーカー
            !val.shiftName ||                                                 // 空エントリ
            regenPatternNames.has(val.shiftName) ||                          // 再仮組み対象パターン
            !allPatternNames.has(val.shiftName)                              // 研修・公休など特殊シフト
          ) {
            merged.set(key, val);
          }
        }
        newState = merged;
      } else {
        const parsed = parseDraftEntries(r.draftEntries);
        // ロック済みセクションのエントリをクライアント側でも保持
        const allLocked = new Set([...staffLockedSections, ...slotLockedSections]);
        if (!overrideLocked && allLocked.size > 0) {
          const lockedPatterns = new Set(
            shiftPatterns.filter(p => p.section && allLocked.has(p.section)).map(p => p.name)
          );
          const merged = new Map(parsed);
          for (const [key, val] of drafts) {
            if (val !== null && val.shiftName && lockedPatterns.has(val.shiftName)) {
              merged.set(key, val);
            }
          }
          newState = merged;
        } else {
          newState = parsed;
        }
      }

      // 再仮組み前の状態を undo スタックに積む（戻れるようにする）
      setUndoStack(prev => [...prev.slice(-(MAX_UNDO - 1)), new Map(drafts)]);
      setRedoStack([]);
      setDrafts(newState);
      setRegenDone(r.assignedCount ?? 0);
    });
  }

  // ── 確定保存 ─────────────────────────────────────────────────

  function handleCommit() {
    const snapshot = [...draftChanges]; // 通知用にスナップショット
    const upserts: BulkUpsertItem[] = [];
    const dels: BulkDeleteItem[] = [];
    for (const [key, draft] of drafts) {
      const [staffId, shiftDate] = key.split("__");
      if (draft === null) { if (shiftsByKey.has(key)) dels.push({ staffId, shiftDate }); }
      else upserts.push({ staffId, shiftDate, shiftName: draft.shiftName, shiftStart: draft.shiftStart, shiftEnd: draft.shiftEnd });
    }

    if (upserts.length === 0 && dels.length === 0) { onCancel(); return; }
    // DB 書き込みはモーダル側で行う（キャンセル可能にするため）
    setPendingNotify({ changes: snapshot, upserts, dels, slotChanges: [], targetMonth });
  }

  // スタッフ軸ビュー用: セクション指定順ソート
  const SECTION_ORDER = ["SV", "査定", "販売", "MOTA", "リメイク", "ローン"];
  const sectionRank = (s: string | null) => {
    const idx = SECTION_ORDER.indexOf(s ?? "");
    return idx === -1 ? SECTION_ORDER.length : idx;
  };
  const getAccNumGrid = (acc: string | null | undefined): number => {
    if (!acc) return Infinity;
    const m = acc.match(/(\d+)/);
    return m ? parseInt(m[1]) : Infinity;
  };

  // SV サブタイプ判定ヘルパー（sortedMembersBySection より前に定義が必要）
  const svSubType = (m: Member | { preferred_shift: string | null }): "早番" | "中番" | "遅番" | "その他" => {
    const ps = (m as Member).preferred_shift ?? "";
    if (ps.includes("早")) return "早番";
    if (ps.includes("中")) return "中番";
    if (ps.includes("遅")) return "遅番";
    return "その他";
  };

  // SV グループ表示順: 早番 → 遅番 → 中番
  const SV_SUB_ORDER: Record<string, number> = { "早番": 0, "遅番": 1, "中番": 2, "その他": 3 };

  // SV を手動並び順（svRankMap）で比較。未設定は末尾→名前順
  const compareSv = (a: Member, b: Member) => {
    const ra = svRankMap.has(a.id) ? svRankMap.get(a.id)! : Infinity;
    const rb = svRankMap.has(b.id) ? svRankMap.get(b.id)! : Infinity;
    return ra !== rb ? ra - rb : a.name.localeCompare(b.name, "ja");
  };

  const sortedMembersBySection = useMemo(() => {
    if (sortByAccountLocal) {
      // 番号順モード（基本）：SV を上部固定（手動並び順）、SV以外をアカウント番号昇順
      return [...activeMembers].sort((a, b) => {
        const aIsSV = a.section === "SV";
        const bIsSV = b.section === "SV";
        if (aIsSV !== bIsSV) return aIsSV ? -1 : 1;
        if (aIsSV) return compareSv(a, b);
        const na = getAccNumGrid(a.accountNumber);
        const nb = getAccNumGrid(b.accountNumber);
        return na !== nb ? na - nb : a.name.localeCompare(b.name, "ja");
      });
    }
    // セクション順モード：SVはsvSubType順・その他はアカウント番号順
    return [...activeMembers].sort((a, b) => {
      const ra = sectionRank(a.section);
      const rb = sectionRank(b.section);
      if (ra !== rb) return ra - rb;
      const aIsSV = a.section === "SV";
      const bIsSV = b.section === "SV";
      if (aIsSV && bIsSV) {
        const sa = SV_SUB_ORDER[svSubType(a)] ?? 3;
        const sb = SV_SUB_ORDER[svSubType(b)] ?? 3;
        if (sa !== sb) return sa - sb;
        return a.name.localeCompare(b.name, "ja");
      }
      if (a.section !== "SV") {
        const na = getAccNumGrid(a.accountNumber);
        const nb = getAccNumGrid(b.accountNumber);
        if (na !== nb) return na - nb;
      }
      return a.name.localeCompare(b.name, "ja");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMembers, sortByAccountLocal, svRankMap]);

  // セクションフィルタ適用済みリスト
  const displayMembers = useMemo(() => {
    let members = filterSection
      ? sortedMembersBySection.filter(m => {
          const secs = m.sections?.length ? m.sections : (m.section ? [m.section] : []);
          return secs.includes(filterSection);
        })
      : sortedMembersBySection;

    if (activeDateFilter) {
      const { date, sortBy, filterSections, filterShifts } = activeDateFilter;

      // セクションフィルター
      if (filterSections.length > 0) {
        members = members.filter(m => {
          const secs = m.sections?.length ? m.sections : (m.section ? [m.section] : []);
          return secs.some(s => filterSections.includes(s));
        });
      }

      // シフトフィルター（対象日のシフト名で絞り込み）
      if (filterShifts.length > 0) {
        members = members.filter(m => {
          const key = `${m.id}__${date}`;
          const sn = drafts.has(key)
            ? (drafts.get(key)?.shiftName ?? null)
            : (shifts.find(s => s.staff_id === m.id && s.shift_date === date)?.shift_name ?? null);
          return sn !== null && filterShifts.includes(sn);
        });
      }

      // シフト順ソート
      if (sortBy === "shift") {
        const patternStartMap = new Map(shiftPatterns.map(p => [p.name, p.start_time ?? "ZZ"]));
        members = [...members].sort((a, b) => {
          const ka = `${a.id}__${date}`;
          const kb = `${b.id}__${date}`;
          const sna = drafts.has(ka) ? (drafts.get(ka)?.shiftName ?? null) : (shifts.find(s => s.staff_id === a.id && s.shift_date === date)?.shift_name ?? null);
          const snb = drafts.has(kb) ? (drafts.get(kb)?.shiftName ?? null) : (shifts.find(s => s.staff_id === b.id && s.shift_date === date)?.shift_name ?? null);
          return (sna ? patternStartMap.get(sna) ?? "ZZ" : "ZZ").localeCompare(snb ? patternStartMap.get(snb) ?? "ZZ" : "ZZ");
        });
      }
    }
    return members;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedMembersBySection, filterSection, activeDateFilter, shiftPatterns, drafts, shifts]);

  // フィルタ用セクション一覧（実際にスタッフがいるセクションのみ）
  const availableSections = useMemo(() => {
    const s = new Set<string>();
    for (const m of activeMembers) {
      const secs = (m as { sections?: string[] }).sections?.length
        ? (m as { sections?: string[] }).sections!
        : m.section ? [m.section] : [];
      for (const sec of secs) if (sec) s.add(sec);
    }
    return SECTION_ORDER.filter(sec => s.has(sec)).concat(
      [...s].filter(sec => !SECTION_ORDER.includes(sec)).sort()
    );
  }, [activeMembers]);

  const SV_GROUP_STYLES = {
    "早番": { header: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300", row: "bg-amber-50 dark:bg-amber-950" },
    "中番": { header: "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500",        row: "bg-zinc-100 dark:bg-zinc-800" },
    "遅番": { header: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300", row: "bg-purple-50 dark:bg-purple-950" },
    "その他": { header: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500", row: "bg-white dark:bg-zinc-950" },
  } as const;

  // 充足サマリーに表示するパターン（SVは各パターン個別に表示）
  const summaryPatterns = useMemo(() =>
    shiftPatterns.filter(p => {
      if (p.section === "SV") return true;  // SV は各パターン個別行で表示
      if ((p.required_count ?? 0) > 0) return true;
      if ((p.required_weekday ?? 0) > 0) return true;
      if ((p.required_weekend ?? 0) > 0) return true;
      return slotRequirements.some(r => r.pattern_name === p.name);
    }).sort((a, b) => {
      // SV パターン内は 早番→遅番→中番 の順に並べる
      if (a.section !== "SV" || b.section !== "SV") return 0;
      const rankA = a.name.includes("早") ? 0 : a.name.includes("遅") ? 1 : a.name.includes("中") ? 2 : 3;
      const rankB = b.name.includes("早") ? 0 : b.name.includes("遅") ? 1 : b.name.includes("中") ? 2 : 3;
      return rankA - rankB;
    }),
  [shiftPatterns, slotRequirements]);

  // 選択不足セルの候補スタッフ（スコアリング付き）
  const shortageCandidates = useMemo(() => {
    if (!selectedShortage) return [];
    const { date, patternName } = selectedShortage;
    const patSection = patternByName.get(patternName)?.section ?? null;

    // 不足日を含む週（月〜日）の日付セット（当日除く）
    const dt = new Date(date + "T00:00:00+09:00");
    const dow = dt.getDay();
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(dt);
    monday.setDate(dt.getDate() + diffToMon);
    const weekDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const s = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
      if (s !== date) weekDates.push(s);
    }

    const dateIdx = allDates.indexOf(date);

    return activeMembers
      .filter(m => {
        if (patSection && m.section !== patSection) return false;
        const cell = resolveCell(m.id, date);
        return cell !== null && (cell.shiftName === "公休" || cell.shiftName === "希望休");
      })
      .map(m => {
        const reason = resolveCell(m.id, date)!.shiftName! as "公休" | "希望休";

        // この週の他の休み日数
        const otherRestDaysThisWeek = weekDates.filter(d => {
          const cell = resolveCell(m.id, d);
          return cell !== null && (cell.shiftName === "公休" || cell.shiftName === "希望休");
        }).length;

        // 移動した場合の連続勤務日数
        let before = 0, after = 0;
        for (let i = dateIdx - 1; i >= 0; i--) {
          const cell = resolveCell(m.id, allDates[i]);
          if (cell?.shiftName && patternNameSet.has(cell.shiftName)) before++;
          else break;
        }
        for (let i = dateIdx + 1; i < allDates.length; i++) {
          const cell = resolveCell(m.id, allDates[i]);
          if (cell?.shiftName && patternNameSet.has(cell.shiftName)) after++;
          else break;
        }
        const consecutiveDaysIfMoved = before + 1 + after;

        // 優先度スコア
        // 1=希望休+代替休あり  2=希望休のみ  3=公休+スワップ可  4=公休のみ(代休必要)
        const priority: 1 | 2 | 3 | 4 =
          reason === "希望休" && otherRestDaysThisWeek > 0 ? 1 :
          reason === "希望休"                               ? 2 :
          reason === "公休"  && otherRestDaysThisWeek > 0  ? 3 : 4;

        return { staffId: m.id, staffName: m.name, section: m.section,
          reason, otherRestDaysThisWeek, consecutiveDaysIfMoved, priority };
      })
      .sort((a, b) =>
        a.priority !== b.priority ? a.priority - b.priority :
        a.consecutiveDaysIfMoved !== b.consecutiveDaysIfMoved ? a.consecutiveDaysIfMoved - b.consecutiveDaysIfMoved :
        a.staffName.localeCompare(b.staffName, "ja")
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShortage, drafts, activeMembers, shiftsByKey, patternByName, allDates, patternNameSet]);

  // 候補スタッフIDセット（グリッドハイライト用）
  const candidateStaffIds = useMemo(
    () => new Set(shortageCandidates.map(c => c.staffId)),
    [shortageCandidates],
  );

  // ── 編集ロック取得・ハートビート・解放 ───────────────────────────
  useEffect(() => {
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let released = false;

    async function acquire() {
      const r = await acquireEditLockAction(projectId, targetMonth);
      if (!r.success) return;
      if (r.acquired) {
        setIsLockedByOther(false);
        setEditLock(null);
        // ハートビート：3分ごとに editing_at を更新
        heartbeatTimer = setInterval(() => {
          heartbeatEditLockAction(projectId, targetMonth);
        }, 3 * 60 * 1000);
      } else if (r.lockedByName) {
        setIsLockedByOther(true);
        setEditLock({ lockedByName: r.lockedByName, lockedAt: r.lockedAt ?? "" });
      }
    }

    acquire();

    return () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (!released) {
        released = true;
        releaseEditLockAction(projectId, targetMonth);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, targetMonth]);

  /** ロックを強制取得（相手のロックが stale になっていれば取れる） */
  async function handleForceTakeOver() {
    const r = await acquireEditLockAction(projectId, targetMonth);
    if (r.acquired) {
      setIsLockedByOther(false);
      setEditLock(null);
    } else if (r.lockedByName) {
      setEditLock({ lockedByName: r.lockedByName, lockedAt: r.lockedAt ?? "" });
    }
  }

  // ── Render ────────────────────────────────────────────────────
  const draftCount = drafts.size;
  const hasChanges = draftCount > 0;

  const PRIORITY_CFG = {
    1: { badge: "推奨",   badgeCls: "bg-emerald-500 text-white", borderCls: "border-emerald-300 dark:border-emerald-700", desc: "希望休・代替休あり" },
    2: { badge: "可",     badgeCls: "bg-blue-500 text-white",    borderCls: "border-blue-200 dark:border-blue-700",       desc: "希望休・代替休なし" },
    3: { badge: "要調整", badgeCls: "bg-amber-500 text-white",   borderCls: "border-amber-200 dark:border-amber-700",     desc: "公休・週内スワップ可" },
    4: { badge: "代休必要", badgeCls: "bg-red-400 text-white",   borderCls: "border-red-200 dark:border-red-700",         desc: "公休・代替休なし" },
  } as const;
  const COL_W = 50;
  const PREV_COL_W = 36; // 前月列幅（当月より狭め）
  const ACCT_W = 92;    // アカウント番号列幅（3桁＋"ASS "が見切れないよう拡大）
  const NAME_W = 112;   // 名前列幅（名前が見切れないよう拡大）
  const TOT_W = 52;     // 合計列幅
  const SUM_ROW_H = 22; // 22px (充足サマリー行の高さ)
  const GRAND_TOTAL_EXCLUDE = ["SV", "ローン", "リメイク", "H MOTA"]; // 全体合計から除外（SVは早+遅合計行で別表示）
  const GRAY_ROW_SECTIONS  = ["ローン", "リメイク", "H MOTA"];       // グレーアウト対象セクション

  // 前月末5日間の日付リスト
  const prevDates = useMemo(() => {
    if (!prevMonthShifts || !allDates.length) return [];
    const firstDate = allDates[0];
    const result: string[] = [];
    for (let i = 5; i >= 1; i--) {
      const d = new Date(firstDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      result.push(d.toISOString().slice(0, 10));
    }
    return result;
  }, [prevMonthShifts, allDates]);

  // 前月シフトルックアップ: staffId__date → shift_name
  const prevShiftsByKey = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const s of prevMonthShifts ?? []) {
      m.set(`${s.staff_id}__${s.shift_date}`, s.shift_name);
    }
    return m;
  }, [prevMonthShifts]);

  // 連勤日数マップ: staffId__date → 当該日を末日とする連続出勤日数
  const consecutiveMap = useMemo(() => {
    const working = new Map<string, Set<string>>(); // staffId → 出勤日Set

    function addWorking(staffId: string, date: string, shiftName: string | null) {
      if (!shiftName || shiftName === "公休" || shiftName === "希望休" || shiftName === "有休" || shiftName === "特別休暇") return;
      if (!patternNameSet.has(shiftName)) return;
      if (!working.has(staffId)) working.set(staffId, new Set());
      working.get(staffId)!.add(date);
    }

    // 前月シフト
    for (const s of prevMonthShifts ?? []) addWorking(s.staff_id, s.shift_date, s.shift_name);

    // 当月確定シフト（ドラフトで上書きされていないもの）
    for (const s of shifts) {
      if (drafts.has(`${s.staff_id}__${s.shift_date}`)) continue;
      addWorking(s.staff_id, s.shift_date, s.shift_name);
    }

    // ドラフト
    for (const [key, draftVal] of drafts) {
      if (!draftVal) continue;
      const lastIdx = key.lastIndexOf("__");
      addWorking(key.slice(0, lastIdx), key.slice(lastIdx + 2), draftVal.shiftName);
    }

    // 当月日付ごとに連続日数を計算
    const result = new Map<string, number>();
    for (const [staffId, workDates] of working) {
      for (const date of allDates) {
        if (!workDates.has(date)) continue;
        let count = 1;
        let d = date;
        for (;;) {
          const prev = new Date(d + "T00:00:00Z");
          prev.setUTCDate(prev.getUTCDate() - 1);
          const prevStr = prev.toISOString().slice(0, 10);
          if (!workDates.has(prevStr)) break;
          count++;
          d = prevStr;
          if (count > 31) break;
        }
        result.set(`${staffId}__${date}`, count);
      }
    }
    return result;
  }, [prevMonthShifts, shifts, drafts, patternNameSet, allDates]);

  const totalW = ACCT_W + NAME_W + PREV_COL_W * prevDates.length + COL_W * allDates.length + TOT_W;

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 shrink-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-amber-800 dark:text-amber-300 leading-tight">
            {draftCount > 0 ? `${draftCount}件 変更中` : "シフト編集"}
          </span>
          <span className="text-xs text-amber-700 dark:text-amber-400 font-medium leading-tight">
            {targetMonth.split("-").map(Number)[0]}年{targetMonth.split("-").map(Number)[1]}月
          </span>
          {draftMsg && (
            <span className="text-[10px] text-green-600 dark:text-green-400">{draftMsg}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* 充足サマリー ON/OFF */}
          <button
            onClick={() => setShowSummaryRows(v => !v)}
            title="充足サマリーを表示/非表示"
            className={[
              "px-2 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors",
              showSummaryRows
                ? "bg-zinc-700 dark:bg-zinc-200 text-white dark:text-zinc-900 border-zinc-700"
                : "bg-white dark:bg-zinc-800 text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50",
            ].join(" ")}
          >
            充足
          </button>
          {/* 並び順トグル */}
          <button
            type="button"
            onClick={() => setSortByAccountLocal(v => !v)}
            title={sortByAccountLocal ? "番号順（クリックでセクション順に戻す）" : "セクション順（クリックで番号順に切替）"}
            className={[
              "px-2 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors",
              sortByAccountLocal
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white dark:bg-zinc-800 text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50",
            ].join(" ")}
          >
            {sortByAccountLocal ? "番号順" : "セクション順"}
          </button>
          {/* セパレーター */}
          <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

          {/* ── 操作系ボタン ── */}
          <button onClick={() => setShowSummary(true)} disabled={isPending || isSavingDraft}
            className="relative px-2.5 py-1.5 text-xs font-semibold rounded-lg text-zinc-500 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition-colors">
            履歴
            {draftChanges.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                {draftChanges.length}
              </span>
            )}
          </button>
          {/* 戻る・進む（個別編集・再仮組みを追跡） */}
          <button
            onClick={handleUndo}
            disabled={isPending || isSavingDraft || undoStack.length === 0}
            title={undoStack.length > 0 ? `${undoStack.length}ステップ戻れます` : undefined}
            className="px-2 py-1.5 text-xs font-semibold rounded-lg text-zinc-500 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition-colors"
          >
            ← 戻る{undoStack.length > 0 ? ` (${undoStack.length})` : ""}
          </button>
          <button
            onClick={handleRedo}
            disabled={isPending || isSavingDraft || redoStack.length === 0}
            title={redoStack.length > 0 ? `${redoStack.length}ステップ進めます` : undefined}
            className="px-2 py-1.5 text-xs font-semibold rounded-lg text-zinc-500 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition-colors"
          >
            進む →{redoStack.length > 0 ? ` (${redoStack.length})` : ""}
          </button>
          {!isPublished && (
            <button
              onClick={() => { setRegenError(null); setLockError(null); setRegenDone(null); setRegenSection(""); setShowRegenConfirm(true); }}
              disabled={isPending || isSavingDraft || isRegenerating || isLockedByOther}
              className="relative px-2.5 py-1.5 text-xs font-semibold rounded-lg text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-700 hover:bg-orange-100 disabled:opacity-40 transition-colors"
            >
              再仮組み
              {(staffLockedSections.size + slotLockedSections.size) > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                  {staffLockedSections.size + slotLockedSections.size}
                </span>
              )}
            </button>
          )}
          <button onClick={onCancel} disabled={isPending || isSavingDraft}
            className="px-2 py-1.5 text-xs font-semibold rounded-lg text-zinc-500 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition-colors">
            閉じる
          </button>
          <button onClick={handleSaveDraft} disabled={isPending || isSavingDraft || isLockedByOther}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 hover:bg-amber-200 disabled:opacity-40 transition-colors">
            {isSavingDraft ? "保存中…" : "仮保存"}
          </button>
          <button onClick={handleCommit} disabled={isPending || isSavingDraft || !hasChanges || isLockedByOther}
            className="px-3 py-1.5 text-xs font-bold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {isPending ? "確定中…" : "確定"}
          </button>
        </div>
        </div>
        {/* ── セクションフィルタ ── */}
        {availableSections.length > 1 && (
          <div className="flex items-center gap-1.5 px-3 pb-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            <button
              onClick={() => setFilterSection("")}
              className={[
                "px-2.5 py-1 text-[11px] font-semibold rounded-full border whitespace-nowrap transition-colors shrink-0",
                filterSection === ""
                  ? "bg-zinc-700 dark:bg-zinc-200 text-white dark:text-zinc-900 border-zinc-700 dark:border-zinc-200"
                  : "bg-white dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50",
              ].join(" ")}
            >
              全員
            </button>
            {availableSections.map(sec => (
              <button
                key={sec}
                onClick={() => setFilterSection(sec === filterSection ? "" : sec)}
                className={[
                  "px-2.5 py-1 text-[11px] font-semibold rounded-full border whitespace-nowrap transition-colors shrink-0",
                  filterSection === sec
                    ? "bg-zinc-700 dark:bg-zinc-200 text-white dark:text-zinc-900 border-zinc-700 dark:border-zinc-200"
                    : "bg-white dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50",
                ].join(" ")}
              >
                {sec === "販売" ? "販売／インフォ" : sec}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 再仮組み確認モーダル */}
      {showRegenConfirm && (() => {
        const sectionOptions = [...new Set(
          shiftPatterns.map(p => p.section).filter((s): s is string => !!s)
        )].sort();
        return (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
            onClick={() => { if (!isRegenerating && !isLocking) { setShowRegenConfirm(false); setRegenSection(""); } }}>
            <div className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm flex flex-col max-h-[90dvh]"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
              onClick={e => e.stopPropagation()}>

              {/* ヘッダー */}
              <div className="px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
                <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">再仮組み</h2>
                <p className="text-xs text-zinc-400 mt-0.5">セクションを選んで再生成、または仮確定で保護</p>
              </div>

              {/* 完了メッセージ */}
              {regenDone !== null && (
                <div className="px-4 py-5 text-center space-y-1">
                  <p className="text-2xl">✓</p>
                  <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{regenDone} 件割当しました</p>
                </div>
              )}

              {/* セクションリスト */}
              {regenDone === null && (
                <div className="overflow-y-auto flex-1 px-3 py-3 space-y-1.5">
                  {sectionOptions.map(section => {
                    const st = sectionDraftStatus.get(section) ?? "none";
                    const isStaffLocked = st === "staff_locked";
                    const isLocked = isStaffLocked;
                    const isSelected = regenSection === section;
                    return (
                      <div key={section} className={[
                        "rounded-2xl border transition-all overflow-hidden",
                        isLocked
                          ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20"
                          : isSelected
                          ? "border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/20"
                          : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800",
                      ].join(" ")}>
                        {/* メイン行 */}
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          {/* セクション選択（ロック中は選択不可） */}
                          <button
                            onClick={() => { if (!isLocked) setRegenSection(isSelected ? "" : section); }}
                            disabled={isLocked || isRegenerating}
                            className="flex items-center gap-2.5 flex-1 min-w-0 text-left disabled:cursor-default"
                          >
                            {/* ステータスアイコン */}
                            {isLocked ? (
                              <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center shrink-0">
                                <svg viewBox="0 0 10 10" className="w-3 h-3 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <path d="M1.5 5l2.5 2.5 4.5-4" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </span>
                            ) : isSelected ? (
                              <span className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
                                <span className="w-2 h-2 rounded-full bg-white" />
                              </span>
                            ) : (
                              <span className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-600 shrink-0" />
                            )}

                            <div className="flex items-baseline gap-2 min-w-0">
                              <span className={[
                                "text-sm font-bold truncate",
                                isLocked
                                  ? "text-emerald-700 dark:text-emerald-300"
                                  : "text-zinc-800 dark:text-zinc-100",
                              ].join(" ")}>{section}</span>
                              <span className={[
                                "text-[10px] font-semibold shrink-0",
                                isLocked ? "text-emerald-600 dark:text-emerald-400"
                                : st === "draft" ? "text-blue-500 dark:text-blue-400"
                                : "text-zinc-400",
                              ].join(" ")}>
                                {isLocked ? "仮確定済" : st === "draft" ? "ドラフト済" : "未着手"}
                              </span>
                            </div>
                          </button>

                          {/* 仮確定トグル */}
                          <button
                            onClick={() => handleToggleLock(section, isLocked ? "none" : "staff")}
                            disabled={isRegenerating || isLocking}
                            className={[
                              "shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-40",
                              isLocked
                                ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200"
                                : "bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600",
                            ].join(" ")}
                          >
                            {isLocked ? "解除" : "仮確定"}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                </div>
              )}

              {/* 警告・エラー */}
              {regenDone === null && (regenError || lockError) && (
                <p className="mx-3 mb-2 text-xs text-red-500 bg-red-50 dark:bg-red-950/40 rounded-xl px-3 py-2 shrink-0">
                  {regenError || lockError}
                </p>
              )}

              {/* フッターボタン */}
              <div className="px-3 pb-4 pt-2 space-y-2 shrink-0 border-t border-zinc-100 dark:border-zinc-800">
                {regenDone === null ? (
                  <>
                    <button
                      onClick={() => handleRegen(regenSection || undefined)}
                      disabled={isRegenerating || isLocking}
                      className="w-full py-3 rounded-2xl text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 transition-colors"
                    >
                      {isRegenerating
                        ? "生成中…"
                        : regenSection
                        ? `「${regenSection}」を再仮組み`
                        : (staffLockedSections.size + slotLockedSections.size) > 0
                        ? `再仮組み（仮確定${staffLockedSections.size + slotLockedSections.size}件はスキップ）`
                        : "全セクションを再仮組み"}
                    </button>
                    <button
                      onClick={() => { setShowRegenConfirm(false); setRegenSection(""); }}
                      disabled={isRegenerating || isLocking}
                      className="w-full py-2 rounded-2xl text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                    >
                      キャンセル
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { setShowRegenConfirm(false); setRegenDone(null); setRegenSection(""); }}
                    className="w-full py-3 rounded-2xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                  >
                    閉じる
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 同時編集ロックバナー ── */}
      {isLockedByOther && editLock && (
        <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between gap-2 shrink-0">
          <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            {editLock.lockedByName} が編集中です（{fmtAt(editLock.lockedAt)}〜）— 保存・再仮組みは無効です
          </span>
          <button
            onClick={handleForceTakeOver}
            className="shrink-0 px-2 py-1 rounded-lg text-[11px] font-bold bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
          >
            引き継ぐ
          </button>
        </div>
      )}

      {/* 保存エラーバナー（保存失敗時のみ） */}
      {saveError && (
        <div className="px-4 py-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border-b border-red-200 shrink-0 flex items-center justify-between gap-2">
          <span>{saveError}</span>
          <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-600 shrink-0 text-xs">✕</button>
        </div>
      )}

      {/* ── メインエリア（グリッド + PC右パネル） ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── グリッド列 ── */}
        <div className="flex flex-col flex-1 min-w-0">

      {/* ── 分割ペイン（充足テーブル ＋ スタッフテーブル） ── */}
      <div ref={splitContainerRef} className="flex flex-col flex-1 min-h-0">

        {/* ── 充足テーブルペイン ── */}
        {showSummaryRows && (
          <div
            ref={sufficiencyPaneRef}
            className="overflow-auto shrink-0"
            style={{ flex: `0 0 ${splitRatio * 100}%`, scrollbarWidth: "none" } as React.CSSProperties}
            onScroll={(e) => handleEditGridSufficiencyScroll(e.currentTarget.scrollLeft)}
          >
            <table className="border-separate"
              style={{ tableLayout: "fixed", width: `${totalW}px`, minWidth: `${totalW}px`, borderSpacing: 0 }}>
              <colgroup>
                <col style={{ width: `${ACCT_W}px` }} />
                <col style={{ width: `${NAME_W}px` }} />
                {prevDates.map((d) => <col key={`prev-col-s-${d}`} style={{ width: `${PREV_COL_W}px` }} />)}
                {allDates.map((d) => <col key={`col-s-${d}`} style={{ width: `${COL_W}px` }} />)}
                <col style={{ width: `${TOT_W}px` }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-30 h-11 bg-white dark:bg-zinc-950 border-b border-r border-zinc-200 dark:border-zinc-700">
                    <span className="text-[9px] font-semibold text-zinc-400 px-1">番号</span>
                  </th>
                  <th className="sticky top-0 z-30 h-11 bg-white dark:bg-zinc-950 border-b border-r-2 border-zinc-200 dark:border-zinc-700" style={{ left: ACCT_W }}>
                    <span className="text-[9px] font-semibold text-zinc-400 px-1">氏名</span>
                  </th>
                  {prevDates.map((date, pi) => {
                    const day = parseInt(date.slice(8)); const dw = dowLabel(date);
                    const dn = dowNum(date); const isSun = dn === 0, isSat = dn === 6;
                    const isLast = pi === prevDates.length - 1;
                    return (
                      <th key={`prev-hs-${date}`} className={["sticky top-0 z-20 h-11 border-b bg-zinc-100 dark:bg-zinc-800/70",
                        isLast ? "border-r-2 border-r-zinc-400 dark:border-r-zinc-500" : "border-r border-zinc-300 dark:border-zinc-600"].join(" ")}>
                        <div className="flex flex-col items-center justify-center h-full gap-0">
                          <span className={`text-[10px] font-medium tabular-nums leading-none ${isSun ? "text-red-400" : isSat ? "text-blue-400" : "text-zinc-400 dark:text-zinc-500"}`}>{day}</span>
                          <span className={`text-[8px] leading-none ${isSun ? "text-red-300" : isSat ? "text-blue-300" : "text-zinc-300 dark:text-zinc-600"}`}>{dw}</span>
                        </div>
                      </th>
                    );
                  })}
                  {allDates.map((date) => {
                    const day = parseInt(date.slice(8)); const dw = dowLabel(date);
                    const dn = dowNum(date); const isSun = dn === 0, isSat = dn === 6, isToday = date === todayJST;
                    const isActive = activeDateFilter?.date === date;
                    const isOpen = dateFilterPopoverDate === date;
                    return (
                      <th key={`hs-${date}`}
                        title="ソート・フィルター設定"
                        onClick={(e) => openDateFilterPopover(date, e.currentTarget.getBoundingClientRect())}
                        className={["sticky top-0 z-20 h-11 border-b border-r border-zinc-200 dark:border-zinc-700 cursor-pointer select-none",
                          isOpen ? "bg-blue-100 dark:bg-blue-900/40" : isActive ? "bg-amber-100 dark:bg-amber-900/40" : isToday ? "bg-blue-600" : "bg-white dark:bg-zinc-950"].join(" ")}>
                        <div className="flex flex-col items-center justify-center h-full gap-0.5">
                          <span className={`text-[11px] font-bold tabular-nums leading-none ${isOpen ? "text-blue-700 dark:text-blue-300" : isActive ? "text-amber-700 dark:text-amber-300" : isToday ? "text-white" : isSun ? "text-red-500" : isSat ? "text-blue-500" : "text-zinc-700 dark:text-zinc-300"}`}>{day}</span>
                          <span className={`text-[9px] leading-none ${isOpen ? "text-blue-500" : isActive ? "text-amber-500" : isToday ? "text-blue-100" : isSun ? "text-red-400" : isSat ? "text-blue-400" : "text-zinc-400"}`}>{dw}</span>
                          {isActive && <span className="text-[8px] leading-none font-bold text-amber-500">▼</span>}
                        </div>
                      </th>
                    );
                  })}
                  <th className="sticky top-0 right-0 z-30 h-11 bg-white dark:bg-zinc-950 border-b border-l-2 border-zinc-300 dark:border-zinc-600">
                    <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">合計</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {summaryPatterns.map((pattern, patIdx, arr) => {
                  // 早番+遅番 合計行: 遅番の最後パターン直後（次が中番 or SV外）に表示
                  const svEarlyPats = arr.filter(p => p.section === "SV" && p.name.includes("早"));
                  const svLatePats  = arr.filter(p => p.section === "SV" && p.name.includes("遅"));
                  const hasEarlyOrLate = svEarlyPats.length > 0 || svLatePats.length > 0;
                  // 「遅番パターンの最後」＝次が中番 or SV以外 or 配列末尾
                  const isEarlyLateTotal = hasEarlyOrLate
                    && pattern.section === "SV"
                    && (pattern.name.includes("早") || pattern.name.includes("遅"))
                    && (arr[patIdx + 1]?.section !== "SV"
                        || arr[patIdx + 1]?.name.includes("中")
                        || (!arr[patIdx + 1]?.name.includes("早") && !arr[patIdx + 1]?.name.includes("遅")));
                  const isFirst = patIdx === 0;
                  const isLast  = patIdx === arr.length - 1;
                  // SV中番 または ローン/リメイク/H MOTA はグレーアウト表示（SV早/遅は通常表示）
                  const isGrayedRow =
                    (pattern.section === "SV" && pattern.name.includes("中")) ||
                    GRAY_ROW_SECTIONS.includes(pattern.section ?? "");
                  return (
                    <React.Fragment key={`sum-frag-${pattern.name}`}>
                    <tr style={{ height: `${SUM_ROW_H}px` }} className={isGrayedRow ? "bg-zinc-100 dark:bg-zinc-800/70" : "bg-zinc-50 dark:bg-zinc-900"}>
                      <td colSpan={2} className={["p-0 overflow-hidden border-r-2 border-zinc-400 dark:border-zinc-500 cursor-pointer transition-colors",
                        isGrayedRow
                          ? "bg-zinc-300 dark:bg-zinc-600 hover:bg-zinc-400 dark:hover:bg-zinc-500"
                          : "bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600",
                        isFirst ? "border-t-2 border-t-zinc-400 dark:border-t-zinc-500" : "border-t border-t-zinc-300 dark:border-t-zinc-600",
                        isLast  ? "border-b-2 border-b-zinc-400 dark:border-b-zinc-500" : "border-b border-b-zinc-300 dark:border-b-zinc-600",
                      ].join(" ")} style={{ position: "sticky", left: 0, zIndex: 10 }}
                        onClick={() => { setReqEditPattern(pattern); setReqEditValues(new Map()); setReqSaveMsg(null); }}
                        title="クリックして必要枠数を編集">
                        <div style={{ height: `${SUM_ROW_H}px`, overflow: "hidden" }} className="flex items-center px-2 gap-1">
                          <span className={["text-[10px] font-bold leading-none truncate block", isGrayedRow ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-700 dark:text-zinc-200"].join(" ")}>{pattern.name}</span>
                          <span className="text-[9px] text-zinc-400 dark:text-zinc-500 shrink-0">✎</span>
                        </div>
                      </td>
                      {prevDates.map((d, pi) => (
                        <td key={`prev-sum-${d}`} className={["p-0",
                          isGrayedRow ? "bg-zinc-300 dark:bg-zinc-600" : "bg-zinc-200 dark:bg-zinc-700",
                          isFirst ? "border-t-2 border-t-zinc-400 dark:border-t-zinc-500" : "border-t border-t-zinc-300 dark:border-t-zinc-600",
                          isLast  ? "border-b-2 border-b-zinc-400 dark:border-b-zinc-500" : "border-b border-b-zinc-300 dark:border-b-zinc-600",
                          pi === prevDates.length - 1 ? "border-r-2 border-r-zinc-400 dark:border-r-zinc-500" : "border-r border-r-zinc-300 dark:border-r-zinc-600",
                        ].join(" ")} />
                      ))}
                      {allDates.map((date) => {
                        const assigned = getEffectiveCount(pattern.name, date);
                        const required = getRequired(pattern.name, date);
                        const net = required - assigned;
                        const isToday = date === todayJST;
                        const isSelected = selectedShortage?.date === date && selectedShortage?.patternName === pattern.name;
                        const isShortage = net > 0;
                        let netDisplay: string, netCls: string, bgCls: string;
                        const showSubLine = required > 0;
                        if (required === 0) {
                          netDisplay = assigned > 0 ? String(assigned) : "";
                          netCls = isGrayedRow ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-400 dark:text-zinc-500";
                          bgCls = isToday ? "bg-blue-100 dark:bg-blue-950" : isGrayedRow ? "bg-zinc-200 dark:bg-zinc-800" : "bg-zinc-100 dark:bg-zinc-800";
                        } else if (net > 0) {
                          netDisplay = `-${net}`;
                          netCls = isSelected ? "text-white font-bold" : isGrayedRow ? "text-red-400 dark:text-red-500 font-bold opacity-70" : "text-red-600 dark:text-red-400 font-bold";
                          bgCls = isSelected ? "bg-red-500 dark:bg-red-600" : isToday ? "bg-red-200 dark:bg-red-950" : isGrayedRow ? "bg-red-50 dark:bg-red-950/40" : "bg-red-100 dark:bg-red-950";
                        } else if (net < 0) {
                          netDisplay = `+${-net}`;
                          netCls = isGrayedRow ? "text-emerald-500 dark:text-emerald-600 font-bold opacity-70" : "text-emerald-700 dark:text-emerald-400 font-bold";
                          bgCls = isToday ? "bg-emerald-200 dark:bg-emerald-950" : isGrayedRow ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-emerald-100 dark:bg-emerald-950";
                        } else {
                          netDisplay = "✓";
                          netCls = isGrayedRow ? "text-zinc-300 dark:text-zinc-600 font-bold" : "text-emerald-400 dark:text-emerald-500 font-bold";
                          bgCls = isToday ? "bg-blue-100 dark:bg-blue-950" : isGrayedRow ? "bg-zinc-200 dark:bg-zinc-800" : "bg-zinc-100 dark:bg-zinc-800";
                        }
                        return (
                          <td key={date}
                            onClick={isShortage ? () => setSelectedShortage(isSelected ? null : { date, patternName: pattern.name }) : undefined}
                            className={["tabular-nums p-0 overflow-hidden", isShortage ? "cursor-pointer" : "", bgCls,
                              isFirst ? "border-t-2 border-t-zinc-400 dark:border-t-zinc-500" : "border-t border-t-zinc-300 dark:border-t-zinc-600",
                              isLast  ? "border-b-2 border-b-zinc-400 dark:border-b-zinc-500 border-r border-r-zinc-200 dark:border-r-zinc-700"
                                      : "border-b border-b-zinc-300 dark:border-b-zinc-600 border-r border-r-zinc-200 dark:border-r-zinc-700",
                            ].join(" ")}
                          >
                            <div style={{ height: `${SUM_ROW_H}px`, overflow: "hidden" }} className="flex flex-col items-center justify-center gap-0.5">
                              <span className={`text-[13px] font-bold leading-none ${netCls}`}>{netDisplay}</span>
                              {showSubLine && (
                                <span className={`text-[9px] leading-none opacity-80 ${isSelected ? "text-white" : "text-zinc-500 dark:text-zinc-400"}`}>{assigned}/{required}</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      {(() => {
                        const totalAssigned = allDates.reduce((s, d) => s + getEffectiveCount(pattern.name, d), 0);
                        const totalRequired = allDates.reduce((s, d) => s + getRequired(pattern.name, d), 0);
                        const totalNet = totalRequired - totalAssigned;
                        let totNetDisplay: string, totText: string, totBg: string;
                        const totShowSubLine = totalRequired > 0;
                        if (totalRequired === 0) {
                          totNetDisplay = totalAssigned > 0 ? String(totalAssigned) : "—";
                          totText = "text-zinc-400 dark:text-zinc-500"; totBg = "bg-zinc-100 dark:bg-zinc-800";
                        } else if (totalNet > 0) {
                          totNetDisplay = `-${totalNet}`;
                          totText = "text-red-600 dark:text-red-400 font-bold"; totBg = "bg-red-100 dark:bg-red-950";
                        } else if (totalNet < 0) {
                          totNetDisplay = `+${-totalNet}`;
                          totText = "text-emerald-700 dark:text-emerald-400 font-bold"; totBg = "bg-emerald-100 dark:bg-emerald-950";
                        } else {
                          totNetDisplay = "✓";
                          totText = "text-emerald-400 dark:text-emerald-500 font-bold"; totBg = "bg-zinc-100 dark:bg-zinc-800";
                        }
                        return (
                          <td className={["tabular-nums p-0 overflow-hidden border-l-2 border-zinc-300 dark:border-zinc-600", totBg,
                            isFirst ? "border-t-2 border-t-zinc-400 dark:border-t-zinc-500" : "border-t border-t-zinc-300 dark:border-t-zinc-600",
                            isLast  ? "border-b-2 border-b-zinc-400 dark:border-b-zinc-500" : "border-b border-b-zinc-300 dark:border-b-zinc-600",
                          ].join(" ")} style={{ position: "sticky", right: 0, zIndex: 12 }}>
                            <div style={{ height: `${SUM_ROW_H}px`, overflow: "hidden" }} className="flex flex-col items-center justify-center gap-0.5">
                              <span className={`text-[13px] font-bold leading-none ${totText}`}>{totNetDisplay}</span>
                              {totShowSubLine && (
                                <span className="text-[9px] leading-none opacity-80 text-zinc-500 dark:text-zinc-400">{totalAssigned}/{totalRequired}</span>
                              )}
                            </div>
                          </td>
                        );
                      })()}
                    </tr>
                    {/* 早番+遅番 合計行（中番の前に表示） */}
                    {isEarlyLateTotal && (() => {
                      const elPats = [...svEarlyPats, ...svLatePats];
                      const elAssignedByDate = allDates.map(d => elPats.reduce((s, p) => s + getEffectiveCount(p.name, d), 0));
                      const elRequiredByDate = allDates.map(d => elPats.reduce((s, p) => s + getRequired(p.name, d), 0));
                      const elGrandAsgn = elAssignedByDate.reduce((s, v) => s + v, 0);
                      const elGrandReq  = elRequiredByDate.reduce((s, v) => s + v, 0);
                      const elGrandNet  = elGrandReq - elGrandAsgn;
                      let elTotDisp: string, elTotText: string, elTotBg: string;
                      if (elGrandReq === 0) { elTotDisp = elGrandAsgn > 0 ? String(elGrandAsgn) : "—"; elTotText = "text-zinc-400 dark:text-zinc-500"; elTotBg = "bg-zinc-200 dark:bg-zinc-700"; }
                      else if (elGrandNet > 0) { elTotDisp = `-${elGrandNet}`; elTotText = "text-red-600 dark:text-red-400 font-bold"; elTotBg = "bg-red-200 dark:bg-red-900/60"; }
                      else if (elGrandNet < 0) { elTotDisp = `+${-elGrandNet}`; elTotText = "text-emerald-700 dark:text-emerald-400 font-bold"; elTotBg = "bg-emerald-200 dark:bg-emerald-900/60"; }
                      else { elTotDisp = "✓"; elTotText = "text-emerald-400 dark:text-emerald-500 font-bold"; elTotBg = "bg-zinc-200 dark:bg-zinc-700"; }
                      return (
                        <tr key="sv-el-total-row" style={{ height: `${SUM_ROW_H}px` }} className="bg-zinc-100 dark:bg-zinc-800">
                          <td colSpan={2} className="p-0 overflow-hidden bg-zinc-400 dark:bg-zinc-500 border-r-2 border-zinc-500 dark:border-zinc-400 border-t border-t-zinc-400 dark:border-t-zinc-500 border-b-2 border-b-zinc-500 dark:border-b-zinc-400"
                            style={{ position: "sticky", left: 0, zIndex: 10 }}>
                            <div style={{ height: `${SUM_ROW_H}px`, overflow: "hidden" }} className="flex items-center px-2">
                              <span className="text-[10px] font-bold text-white dark:text-zinc-900 leading-none truncate block">合計</span>
                            </div>
                          </td>
                          {prevDates.map((d) => (
                            <td key={`prev-eltot-${d}`} className="p-0 bg-zinc-400 dark:bg-zinc-500 border-t border-t-zinc-400 dark:border-t-zinc-500 border-b-2 border-b-zinc-500 dark:border-b-zinc-400 border-r border-r-zinc-300 dark:border-r-zinc-600" />
                          ))}
                          {allDates.map((date, di) => {
                            const asgn = elAssignedByDate[di];
                            const req  = elRequiredByDate[di];
                            const net  = req - asgn;
                            const isToday = date === todayJST;
                            let nd: string, tc: string, bc: string;
                            const showSub = req > 0;
                            if (req === 0) { nd = asgn > 0 ? String(asgn) : ""; tc = "text-zinc-500 dark:text-zinc-400"; bc = isToday ? "bg-blue-100 dark:bg-blue-950" : "bg-zinc-100 dark:bg-zinc-800"; }
                            else if (net > 0) { nd = `-${net}`; tc = "text-red-600 dark:text-red-400 font-bold"; bc = isToday ? "bg-red-200 dark:bg-red-950" : "bg-red-100 dark:bg-red-950"; }
                            else if (net < 0) { nd = `+${-net}`; tc = "text-emerald-700 dark:text-emerald-400 font-bold"; bc = isToday ? "bg-emerald-200 dark:bg-emerald-950" : "bg-emerald-100 dark:bg-emerald-950"; }
                            else { nd = "✓"; tc = "text-emerald-400 dark:text-emerald-500 font-bold"; bc = isToday ? "bg-blue-100 dark:bg-blue-950" : "bg-zinc-100 dark:bg-zinc-800"; }
                            return (
                              <td key={date} className={["tabular-nums p-0 overflow-hidden border-t border-t-zinc-400 dark:border-t-zinc-500 border-b-2 border-b-zinc-500 dark:border-b-zinc-400 border-r border-r-zinc-200 dark:border-r-zinc-700", bc].join(" ")}>
                                <div style={{ height: `${SUM_ROW_H}px`, overflow: "hidden" }} className="flex flex-col items-center justify-center gap-0.5">
                                  <span className={`text-[13px] font-bold leading-none ${tc}`}>{nd}</span>
                                  {showSub && <span className="text-[9px] leading-none opacity-80 text-zinc-500 dark:text-zinc-400">{asgn}/{req}</span>}
                                </div>
                              </td>
                            );
                          })}
                          <td className={["tabular-nums p-0 overflow-hidden border-l-2 border-zinc-400 dark:border-zinc-500 border-t border-t-zinc-400 dark:border-t-zinc-500 border-b-2 border-b-zinc-500 dark:border-b-zinc-400", elTotBg].join(" ")}
                            style={{ position: "sticky", right: 0, zIndex: 12 }}>
                            <div style={{ height: `${SUM_ROW_H}px`, overflow: "hidden" }} className="flex flex-col items-center justify-center gap-0.5">
                              <span className={`text-[13px] font-bold leading-none ${elTotText}`}>{elTotDisp}</span>
                              {elGrandReq > 0 && <span className="text-[9px] leading-none opacity-80 text-zinc-500 dark:text-zinc-400">{elGrandAsgn}/{elGrandReq}</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                    {/* ── 全体合計行（ローン・リメイク除く）：最後のメインパターンの直後に挿入 ── */}
                    {(() => {
                      const isGrandExcluded = (p: Pattern) =>
                        GRAND_TOTAL_EXCLUDE.includes(p.section ?? "");
                      const mainPats = arr.filter(p => !isGrandExcluded(p));
                      if (mainPats.length === 0) return null;
                      const lastMainIdx = arr.reduce((acc, p, i) => !isGrandExcluded(p) ? i : acc, -1);
                      // isEarlyLateTotal がある場合は合計行の後に出力するためそちらに任せる
                      const insertHere = patIdx === lastMainIdx && !isEarlyLateTotal;
                      const insertAfterEarlyLate = patIdx === lastMainIdx && isEarlyLateTotal;
                      if (!insertHere && !insertAfterEarlyLate) return null;
                  const gtByDate = allDates.map(d => ({
                    asgn: mainPats.reduce((s, p) => s + getEffectiveCount(p.name, d), 0),
                    req:  mainPats.reduce((s, p) => s + getRequired(p.name, d), 0),
                  }));
                  const gtGrandAsgn = gtByDate.reduce((s, v) => s + v.asgn, 0);
                  const gtGrandReq  = gtByDate.reduce((s, v) => s + v.req,  0);
                  const gtGrandNet  = gtGrandReq - gtGrandAsgn;
                  let gtTotDisp: string, gtTotText: string, gtTotBg: string;
                  if (gtGrandReq === 0) { gtTotDisp = gtGrandAsgn > 0 ? String(gtGrandAsgn) : "—"; gtTotText = "text-zinc-400 dark:text-zinc-500"; gtTotBg = "bg-zinc-200 dark:bg-zinc-700"; }
                  else if (gtGrandNet > 0) { gtTotDisp = `-${gtGrandNet}`; gtTotText = "text-red-600 dark:text-red-400 font-bold"; gtTotBg = "bg-red-200 dark:bg-red-900/60"; }
                  else if (gtGrandNet < 0) { gtTotDisp = `+${-gtGrandNet}`; gtTotText = "text-emerald-700 dark:text-emerald-400 font-bold"; gtTotBg = "bg-emerald-200 dark:bg-emerald-900/60"; }
                  else { gtTotDisp = "✓"; gtTotText = "text-emerald-400 dark:text-emerald-500 font-bold"; gtTotBg = "bg-zinc-200 dark:bg-zinc-700"; }
                  return (
                    <tr key="grand-total-row" style={{ height: `${SUM_ROW_H}px` }} className="bg-zinc-200 dark:bg-zinc-700">
                      <td colSpan={2} className="p-0 overflow-hidden bg-zinc-500 dark:bg-zinc-400 border-r-2 border-zinc-600 dark:border-zinc-300 border-t-2 border-t-zinc-500 dark:border-t-zinc-400 border-b-2 border-b-zinc-600 dark:border-b-zinc-300"
                        style={{ position: "sticky", left: 0, zIndex: 10 }}>
                        <div style={{ height: `${SUM_ROW_H}px`, overflow: "hidden" }} className="flex items-center px-2">
                          <span className="text-[10px] font-bold text-white dark:text-zinc-900 leading-none truncate block">全体合計</span>
                        </div>
                      </td>
                      {prevDates.map((d) => (
                        <td key={`prev-gt-${d}`} className="p-0 bg-zinc-400 dark:bg-zinc-500 border-t-2 border-t-zinc-500 dark:border-t-zinc-400 border-b-2 border-b-zinc-600 dark:border-b-zinc-300 border-r border-r-zinc-300 dark:border-r-zinc-600" />
                      ))}
                      {allDates.map((date, di) => {
                        const { asgn, req } = gtByDate[di];
                        const net = req - asgn;
                        const isToday = date === todayJST;
                        let nd: string, tc: string, bc: string;
                        if (req === 0) { nd = asgn > 0 ? String(asgn) : ""; tc = "text-zinc-500 dark:text-zinc-400"; bc = isToday ? "bg-blue-100 dark:bg-blue-950" : "bg-zinc-200 dark:bg-zinc-700"; }
                        else if (net > 0) { nd = `-${net}`; tc = "text-red-600 dark:text-red-400 font-bold"; bc = isToday ? "bg-red-200 dark:bg-red-950" : "bg-red-100 dark:bg-red-950"; }
                        else if (net < 0) { nd = `+${-net}`; tc = "text-emerald-700 dark:text-emerald-400 font-bold"; bc = isToday ? "bg-emerald-200 dark:bg-emerald-950" : "bg-emerald-100 dark:bg-emerald-950"; }
                        else { nd = "✓"; tc = "text-emerald-400 dark:text-emerald-500 font-bold"; bc = isToday ? "bg-blue-100 dark:bg-blue-950" : "bg-zinc-200 dark:bg-zinc-700"; }
                        return (
                          <td key={date} className={["tabular-nums p-0 overflow-hidden border-t-2 border-t-zinc-500 dark:border-t-zinc-400 border-b-2 border-b-zinc-600 dark:border-b-zinc-300 border-r border-r-zinc-200 dark:border-r-zinc-700", bc].join(" ")}>
                            <div style={{ height: `${SUM_ROW_H}px`, overflow: "hidden" }} className="flex flex-col items-center justify-center gap-0">
                              <span className={`text-[12px] font-bold leading-none ${tc}`}>{nd}</span>
                              {req > 0 && <span className="text-[9px] leading-none opacity-70 text-zinc-600 dark:text-zinc-300">{asgn}/{req}</span>}
                            </div>
                          </td>
                        );
                      })}
                      <td className={["tabular-nums p-0 overflow-hidden border-l-2 border-zinc-500 dark:border-zinc-400 border-t-2 border-t-zinc-500 dark:border-t-zinc-400 border-b-2 border-b-zinc-600 dark:border-b-zinc-300", gtTotBg].join(" ")}
                        style={{ position: "sticky", right: 0, zIndex: 12 }}>
                        <div style={{ height: `${SUM_ROW_H}px`, overflow: "hidden" }} className="flex flex-col items-center justify-center gap-0">
                          <span className={`text-[12px] font-bold leading-none ${gtTotText}`}>{gtTotDisp}</span>
                          {gtGrandReq > 0 && <span className="text-[9px] leading-none opacity-70 text-zinc-600 dark:text-zinc-300">{gtGrandAsgn}/{gtGrandReq}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })()}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── ドラッグハンドル ── */}
        {showSummaryRows && (
          <div
            className="flex-none h-2 bg-zinc-200 dark:bg-zinc-700 cursor-row-resize hover:bg-blue-300 dark:hover:bg-blue-600 active:bg-blue-400 transition-colors flex items-center justify-center select-none touch-none shrink-0"
            onMouseDown={handleDividerDragStart}
            onTouchStart={handleDividerDragStart}
          >
            <span className="w-8 h-0.5 rounded-full bg-zinc-400 dark:bg-zinc-500" />
          </div>
        )}

        {/* ── スタッフテーブルペイン ── */}
        <div
          ref={staffPaneRef}
          className="overflow-auto flex-1 min-h-0"
          style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
          onScroll={(e) => handleEditGridStaffScroll(e.currentTarget.scrollLeft)}
        >
          <table className="border-separate"
            style={{ tableLayout: "fixed", width: `${totalW}px`, minWidth: `${totalW}px`, borderSpacing: 0 }}>
            <colgroup>
              <col style={{ width: `${ACCT_W}px` }} />
              <col style={{ width: `${NAME_W}px` }} />
              {prevDates.map((d) => <col key={`prev-col-${d}`} style={{ width: `${PREV_COL_W}px` }} />)}
              {allDates.map((d) => <col key={d} style={{ width: `${COL_W}px` }} />)}
              <col style={{ width: `${TOT_W}px` }} />
            </colgroup>
            {/* 充足テーブル非表示時のみ日付ヘッダーを表示 */}
            {!showSummaryRows && (
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-30 h-11 bg-white dark:bg-zinc-950 border-b border-r border-zinc-200 dark:border-zinc-700">
                    <span className="text-[9px] font-semibold text-zinc-400 px-1">番号</span>
                  </th>
                  <th className="sticky top-0 z-30 h-11 bg-white dark:bg-zinc-950 border-b border-r-2 border-zinc-200 dark:border-zinc-700" style={{ left: ACCT_W }}>
                    <span className="text-[9px] font-semibold text-zinc-400 px-1">氏名</span>
                  </th>
                  {prevDates.map((date, pi) => {
                    const day = parseInt(date.slice(8)); const dw = dowLabel(date);
                    const dn = dowNum(date); const isSun = dn === 0, isSat = dn === 6;
                    const isLast = pi === prevDates.length - 1;
                    return (
                      <th key={`prev-h-${date}`} className={["sticky top-0 z-20 h-11 border-b bg-zinc-100 dark:bg-zinc-800/70",
                        isLast ? "border-r-2 border-r-zinc-400 dark:border-r-zinc-500" : "border-r border-zinc-300 dark:border-zinc-600"].join(" ")}>
                        <div className="flex flex-col items-center justify-center h-full gap-0">
                          <span className={`text-[10px] font-medium tabular-nums leading-none ${isSun ? "text-red-400" : isSat ? "text-blue-400" : "text-zinc-400 dark:text-zinc-500"}`}>{day}</span>
                          <span className={`text-[8px] leading-none ${isSun ? "text-red-300" : isSat ? "text-blue-300" : "text-zinc-300 dark:text-zinc-600"}`}>{dw}</span>
                        </div>
                      </th>
                    );
                  })}
                  {allDates.map((date) => {
                    const day = parseInt(date.slice(8)); const dw = dowLabel(date);
                    const dn = dowNum(date); const isSun = dn === 0, isSat = dn === 6, isToday = date === todayJST;
                    const isActive = activeDateFilter?.date === date;
                    const isOpen = dateFilterPopoverDate === date;
                    return (
                      <th key={date} className={["sticky top-0 z-20 h-11 border-b border-r border-zinc-200 dark:border-zinc-700 cursor-pointer select-none",
                        isOpen ? "bg-blue-100 dark:bg-blue-900/40" : isActive ? "bg-amber-100 dark:bg-amber-900/40" : isToday ? "bg-blue-600" : "bg-white dark:bg-zinc-950"].join(" ")}
                        title="ソート・フィルター設定"
                        onClick={(e) => openDateFilterPopover(date, e.currentTarget.getBoundingClientRect())}>
                        <div className="flex flex-col items-center justify-center h-full gap-0.5">
                          <span className={`text-[11px] font-bold tabular-nums leading-none ${isOpen ? "text-blue-700 dark:text-blue-300" : isActive ? "text-amber-700 dark:text-amber-300" : isToday ? "text-white" : isSun ? "text-red-500" : isSat ? "text-blue-500" : "text-zinc-700 dark:text-zinc-300"}`}>{day}</span>
                          <span className={`text-[9px] leading-none ${isOpen ? "text-blue-500" : isActive ? "text-amber-500" : isToday ? "text-blue-100" : isSun ? "text-red-400" : isSat ? "text-blue-400" : "text-zinc-400"}`}>{dw}</span>
                          {isActive && <span className="text-[8px] leading-none font-bold text-amber-500">▼</span>}
                        </div>
                      </th>
                    );
                  })}
                  <th className="sticky top-0 right-0 z-30 h-11 bg-white dark:bg-zinc-950 border-b border-l-2 border-zinc-300 dark:border-zinc-600">
                    <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">合計</span>
                  </th>
                </tr>
              </thead>
            )}
            <tbody>
              {/* ── スタッフ軸 ── */}
              {displayMembers.map((member, idx) => {
                const prevSection = idx > 0 ? displayMembers[idx - 1].section : undefined;
                // 番号順モード：SV のヘッダーのみ表示、SV以外は非表示
                const showSectionHeader = !filterSection && member.section !== prevSection
                  && (!sortByAccountLocal || member.section === "SV");
                // SV サブグループヘッダー
                const prevMember = idx > 0 ? displayMembers[idx - 1] : null;
                const showSvSubHeader = member.section === "SV"
                  && (!sortByAccountLocal)
                  && (!filterSection)
                  && svSubType(member) !== svSubType(prevMember ?? { preferred_shift: null } as Member);
                const svType = svSubType(member);
                const svStyle = SV_GROUP_STYLES[svType];
                // 離脱リスク（行レベル）オーバーライド込み
                const _rowChurnOv = churnRiskOverrides.get(member.id);
                const effChurnRisk = _rowChurnOv !== undefined ? _rowChurnOv.churn_risk : (member.churn_risk ?? false);
                // 月合計（公休・希望休・有休・特別休暇以外を稼働日としてカウント、研修等も含む）
                const DAYOFF_SET = new Set(["公休", "希望休", "有休", "特別休暇"]);
                const monthTotal = allDates.filter(d => {
                  const cell = resolveCell(member.id, d);
                  return cell !== null && cell.shiftName && !DAYOFF_SET.has(cell.shiftName);
                }).length;
                const isFocusedRow = focusedCandidateId === member.id;
                return (
                  <React.Fragment key={member.id}>
                    {showSectionHeader && (
                      <tr>
                        {/* 名前列だけ sticky にして横スクロール時も固定 */}
                        {(() => {
                          const secName = member.section;
                          const isSecLocked = !!(secName && staffLockedSections.has(secName));
                          const headerBg = isSecLocked
                            ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800"
                            : "bg-zinc-100 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700";
                          return (
                            <>
                              <td className={["sticky left-0 z-10 px-2 py-0.5 border-b", headerBg].join(" ")}>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 tracking-wide uppercase">
                                    {secName === "販売" ? "販売／インフォ" : (secName ?? "セクション未設定")}
                                  </span>
                                  {isSecLocked && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-[9px] font-bold">
                                      <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M1.5 5l2.5 2.5 4.5-4" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                      仮確定
                                    </span>
                                  )}
                                </div>
                              </td>
                              {/* 残り列は背景だけ埋める（sticky なし） */}
                              <td colSpan={prevDates.length + allDates.length + 2}
                                className={["border-b", headerBg].join(" ")} />
                            </>
                          );
                        })()}
                      </tr>
                    )}
                    {showSvSubHeader && member.section === "SV" && (
                      <tr>
                        <td className={`sticky left-0 z-10 px-3 py-0.5 border-b text-[9px] font-bold ${svStyle.header}`}>
                          {svType}
                        </td>
                        <td colSpan={prevDates.length + allDates.length + 2} className={`border-b ${svStyle.header}`} />
                      </tr>
                    )}
                    <tr
                      ref={(el) => {
                        if (el) staffRowRefs.current.set(member.id, el);
                        else staffRowRefs.current.delete(member.id);
                      }}
                    >
                      {/* アカウント番号セル + 並び替えボタン */}
                      {(() => {
                        const cellBg = isFocusedRow
                          ? "bg-blue-100 dark:bg-blue-900/40"
                          : effChurnRisk
                          ? "bg-red-50 dark:bg-red-950/30"
                          : member.section === "SV"
                          ? svStyle.row
                          : "bg-white dark:bg-zinc-950";
                        return (
                          <>
                            <td className={["sticky left-0 z-10 border-b border-r border-zinc-200 dark:border-zinc-700 align-middle h-8", cellBg].join(" ")}>
                              <div className="px-1.5 flex items-center gap-0.5 h-full">
                                <span className={["text-[10px] tabular-nums truncate flex-1", isFocusedRow ? "text-blue-700 dark:text-blue-300 font-semibold" : "text-zinc-500 dark:text-zinc-400"].join(" ")}>
                                  {member.accountNumber ?? "—"}
                                </span>
                                {/* 並び替えは SV のみ・番号順モード時のみ（DBに永続化） */}
                                {member.section === "SV" && sortByAccountLocal && (
                                  <div className="flex flex-col gap-0 shrink-0">
                                    <button type="button" onClick={(e) => { e.stopPropagation(); moveSv(member.id, -1); }} className="w-4 h-3.5 flex items-center justify-center text-zinc-300 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors text-[8px] leading-none">▲</button>
                                    <button type="button" onClick={(e) => { e.stopPropagation(); moveSv(member.id, 1); }} className="w-4 h-3.5 flex items-center justify-center text-zinc-300 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors text-[8px] leading-none">▼</button>
                                  </div>
                                )}
                              </div>
                            </td>
                            {/* 名前セル（クリックでスタッフ情報パネルを開く） */}
                            <td className={["z-10 border-b border-r-2 border-zinc-200 dark:border-zinc-700 align-middle h-8 transition-colors cursor-pointer", cellBg, effChurnRisk ? "hover:bg-red-100 dark:hover:bg-red-900/40" : member.section === "SV" ? "hover:brightness-95" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"].join(" ")}
                              style={{ position: "sticky", left: ACCT_W, zIndex: 10 }}
                              onClick={() => setStaffInfoTarget(member)}>
                              <div className="px-1.5 flex items-center gap-1 h-full">
                                {isFocusedRow && <span className="w-1 h-4 rounded-full bg-blue-500 shrink-0" />}
                                <div className="min-w-0 flex-1">
                                  <span className={["text-[11px] font-semibold block leading-tight truncate", isFocusedRow ? "text-blue-700 dark:text-blue-300" : "text-zinc-700 dark:text-zinc-200"].join(" ")}>
                                    {member.name}
                                  </span>
                                  {(effChurnRisk || member.endDate) && (
                                    <div className="flex items-center gap-0.5">
                                      {effChurnRisk && <span className="text-[8px] font-bold px-1 rounded bg-red-100 dark:bg-red-900/40 text-red-500 dark:text-red-400 leading-none">離脱</span>}
                                      {member.endDate && <span className="text-[9px] text-amber-500 dark:text-amber-400 tabular-nums leading-none">〜{member.endDate.slice(5).replace("-", "/")}</span>}
                                    </div>
                                  )}
                                </div>
                                {/* 個別シフト公開/非公開トグル */}
                                {(() => {
                                  const isPublished = publishedOverrides.get(member.id) ?? (member.shift_published !== false);
                                  return (
                                    <button
                                      type="button"
                                      title={isPublished ? "展開対象（クリックで除外）" : "展開対象外（クリックで対象に戻す）"}
                                      disabled={publishingId === member.id}
                                      onClick={(e) => { e.stopPropagation(); handleToggleShiftPublished(member.id); }}
                                      className={["shrink-0 text-[8px] px-1 py-0.5 rounded leading-none font-bold transition-colors", isPublished ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400" : "bg-zinc-200 dark:bg-zinc-700 text-zinc-400 dark:text-zinc-500"].join(" ")}
                                    >
                                      {isPublished ? "公開" : "非公"}
                                    </button>
                                  );
                                })()}
                              </div>
                            </td>
                          </>
                        );
                      })()}
                      {/* 前月末セル（読み取り専用・グレー表示） */}
                      {prevDates.map((date, pi) => {
                        const shiftName = prevShiftsByKey.get(`${member.id}__${date}`) ?? null;
                        const dn = dowNum(date);
                        const isSun = dn === 0, isSat = dn === 6;
                        const isLast = pi === prevDates.length - 1;
                        return (
                          <td key={`prev-${date}`} className={[
                            "h-8 align-middle p-0 overflow-hidden",
                            "bg-zinc-100 dark:bg-zinc-800/60",
                            isLast ? "border-b border-r-2 border-b-zinc-200 dark:border-b-zinc-700 border-r-zinc-400 dark:border-r-zinc-500"
                                   : "border-b border-r border-zinc-200 dark:border-zinc-700",
                          ].join(" ")}>
                            <div className="h-full flex items-center justify-center overflow-hidden px-0.5">
                              <span className={[
                                "text-[10px] leading-none truncate",
                                !shiftName || shiftName === "公休" || shiftName === "希望休" || shiftName === "有休" || shiftName === "特別休暇"
                                  ? "text-zinc-300 dark:text-zinc-600"
                                  : isSun ? "text-red-400 dark:text-red-500 font-medium"
                                  : isSat ? "text-blue-400 dark:text-blue-500 font-medium"
                                  : "text-zinc-500 dark:text-zinc-400 font-medium",
                              ].join(" ")}>
                                {shiftName ? shiftName.slice(0, 3) : ""}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                      {allDates.map((date) => {
                        const isDeparted = !!member.endDate && date > member.endDate;
                        const cell = resolveCell(member.id, date);
                        const shiftName = cell?.shiftName ?? null;
                        const isDraftCell = drafts.has(`${member.id}__${date}`);
                        const isToday = date === todayJST;
                        const hasLog = (changeLogMap.get(`${member.id}__${date}`)?.length ?? 0) > 0;
                        // 離脱リスクフラグ: オーバーライド込み
                        const _churnOv = churnRiskOverrides.get(member.id);
                        const _effChurnRisk  = _churnOv !== undefined ? _churnOv.churn_risk  : (member.churn_risk ?? false);
                        const _effChurnSince = _churnOv !== undefined ? _churnOv.churn_risk_since : (member.churn_risk_since ?? null);
                        const isChurnRiskCell = _effChurnRisk &&
                          (_effChurnSince ? date >= _effChurnSince : true);
                        // 候補ハイライト: 選択不足セルの日付 かつ 候補スタッフ
                        const isCandidate = selectedShortage?.date === date && candidateStaffIds.has(member.id);
                        // 希望休
                        const offPriority = offRequestMap.get(`${member.id}__${date}`);
                        // 連勤日数（6以上で警告）
                        const consecutiveDays = consecutiveMap.get(`${member.id}__${date}`) ?? 0;
                        const isConsecutiveWarning = consecutiveDays >= 6;
                        if (isDeparted) {
                          return (
                            <td key={date} className={[
                              "border-b border-r border-zinc-100 dark:border-zinc-800 h-8",
                              isToday ? "bg-blue-50/20 dark:bg-blue-950/5" : "bg-zinc-50/80 dark:bg-zinc-800/30",
                            ].join(" ")}>
                              <div className="h-full flex items-center justify-center">
                                <span className="text-[10px] text-zinc-300 dark:text-zinc-600">–</span>
                              </div>
                            </td>
                          );
                        }
                        // 追加不可（公休・希望休・有休のみ）
                        const isOffShift = shiftName === "公休" || shiftName === "希望休" || shiftName === "有休" || shiftName === "特別休暇";
                        const decKey = `${member.id}__${date}`;
                        const isDeclined = declinedIds.has(decKey);
                        const isDeclining = decliningKey === decKey;
                        return (
                          <td key={date}
                            onClick={(e) => {
                              setPopover({ staffId: member.id, date, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                            }}
                            className={[
                              "border-b border-r border-zinc-100 dark:border-zinc-800",
                              "h-8 align-middle p-0 overflow-hidden transition-colors relative cursor-pointer group",
                              // 離脱リスク → 赤枠
                              isChurnRiskCell ? "ring-inset ring-1 ring-red-400 dark:ring-red-500" : "",
                              // フォーカス行 + 候補 → 青強調
                              isFocusedRow && isCandidate
                                ? "bg-blue-300 dark:bg-blue-700/60 ring-inset ring-2 ring-blue-400"
                                : isFocusedRow
                                ? "bg-blue-50 dark:bg-blue-950/30"
                                : isCandidate
                                ? "bg-amber-200 dark:bg-amber-800/50 ring-inset ring-1 ring-amber-400"
                                // 希望休・有休・特別休暇・公休・希望休申請 → 黒ベース
                                : (shiftName === "希望休" || shiftName === "有休" || shiftName === "特別休暇")
                                ? "bg-zinc-700 dark:bg-zinc-700"
                                : shiftName === "公休"
                                ? "bg-zinc-500 dark:bg-zinc-600"
                                : (offPriority && !shiftName)
                                ? "bg-zinc-800 dark:bg-zinc-800"
                                // 6連勤以上 → 赤
                                : isConsecutiveWarning && shiftName && patternNameSet.has(shiftName)
                                ? "bg-red-500 dark:bg-red-600"
                                // シフトパターン → セクション色
                                : shiftName && patternNameSet.has(shiftName)
                                ? (getPatternBg(shiftName, patternByName.get(shiftName) ?? null) || (isToday ? "bg-blue-50/40 dark:bg-blue-950/10" : ""))
                                // 今日
                                : isToday
                                ? "bg-blue-50/40 dark:bg-blue-950/10"
                                : "",
                            ].filter(Boolean).join(" ")}
                          >
                            {/* 追加不可ボタン（公休/希望休/有休のみ） */}
                            {isOffShift && (
                              <button
                                type="button"
                                title={isDeclined ? "出勤不可を解除" : "出勤不可にする"}
                                disabled={isDeclining}
                                onClick={(e) => { e.stopPropagation(); handleToggleDeclineEdit(member.id, date); }}
                                className={[
                                  "absolute top-0.5 right-0.5 z-20 w-4 h-4 rounded-sm flex items-center justify-center text-[9px] font-bold transition-opacity",
                                  isDeclined
                                    ? "bg-red-500 text-white opacity-100"
                                    : "bg-zinc-300/70 text-zinc-500 opacity-0 group-hover:opacity-100 dark:bg-zinc-600/50 dark:text-zinc-400",
                                  isDeclining ? "opacity-50" : "",
                                ].join(" ")}
                              >✕</button>
                            )}
                            {/* 希望休ラベル（シフト未配置の場合）→ 黒背景に白文字 */}
                            {offPriority && !shiftName && (
                              <div className="h-full flex items-center justify-center px-0.5">
                                <span className="text-[10px] font-bold leading-none text-zinc-200">
                                  {OFF_PRIORITY_LABEL[offPriority] ?? "休"}
                                </span>
                              </div>
                            )}
                            {shiftName && (
                              <div className="h-full flex flex-col items-center justify-center overflow-hidden px-0.5">
                                <span className={[
                                  "text-[11px] leading-none font-medium text-center truncate w-full block",
                                  isFocusedRow && isCandidate
                                    ? "text-blue-800 dark:text-blue-100 font-bold"
                                    : isFocusedRow
                                    ? "text-blue-600 dark:text-blue-300"
                                    : isCandidate
                                    ? "text-amber-800 dark:text-amber-200 font-semibold"
                                    : (shiftName === "希望休" || shiftName === "有休" || shiftName === "特別休暇" || shiftName === "公休")
                                    ? "text-white font-semibold"
                                    : isConsecutiveWarning
                                    ? "text-white font-bold"
                                    : isDraftCell
                                    ? "text-blue-700 dark:text-blue-300 font-bold"
                                    : "text-zinc-700 dark:text-zinc-200",
                                ].join(" ")}>
                                  {shiftName === "希望休" && offPriority
                                    ? (OFF_PRIORITY_LABEL[offPriority] ?? shiftName.slice(0, 4))
                                    : shiftName.slice(0, 4)}
                                  {hasLog && !isDraftCell && (
                                    <span className="inline-block w-1 h-1 rounded-full bg-amber-400 align-top ml-0.5" />
                                  )}
                                </span>
                                {isChurnRiskCell && (
                                  <span className="text-[7px] leading-none font-bold text-red-500 dark:text-red-400 whitespace-nowrap mt-0.5">【離脱リスク】</span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      {/* 月合計セル（右固定） */}
                      <td className="sticky right-0 z-10 border-b border-l-2 border-zinc-200 dark:border-zinc-700 h-8 align-middle text-center tabular-nums bg-white dark:bg-zinc-950">
                        <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                          {monthTotal > 0 ? monthTotal : ""}
                        </span>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>{/* /splitContainerRef */}

      {/* 凡例 */}
      <div className="shrink-0 px-4 py-1.5 border-t border-zinc-100 dark:border-zinc-800 flex items-center text-[10px] text-zinc-400 gap-3 flex-wrap">
        <span><span className="text-blue-700 dark:text-blue-400 font-bold">名前</span>＝変更中</span>
        <span className="flex items-center gap-0.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />＝変更履歴あり
        </span>
        <span className="flex items-center gap-0.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />＝重複
        </span>
        <span className="flex items-center gap-0.5">
          <span className="inline-block w-4 h-3 rounded bg-red-500" />＝6連勤以上
        </span>
        <span className="flex items-center gap-0.5 text-red-500 dark:text-red-400">
          <span className="inline-block w-3 h-3 rounded border border-red-400 mr-0.5" />離脱リスク
        </span>
        {prevDates.length > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="inline-block w-4 h-3 rounded bg-zinc-200 dark:bg-zinc-700" />＝前月
          </span>
        )}
        {selectedShortage && (
          <span className="flex items-center gap-0.5">
            <span className="inline-block w-2.5 h-2.5 rounded bg-amber-200" />＝不足日候補
          </span>
        )}
        <span className="ml-auto text-[9px]">タップ：シフト編集　–＝離脱後</span>
      </div>

        </div>{/* /グリッド列 */}

        {/* ── 右パネル（PC用・md以上で表示） ── */}
        {selectedShortage && (
          <div className="hidden md:flex flex-col w-72 shrink-0 border-l border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 overflow-hidden">
            {/* ヘッダー */}
            <div className="px-3 pt-3 pb-2 border-b border-amber-200 dark:border-amber-800 flex items-start justify-between shrink-0">
              <div>
                <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide">休み候補</p>
                <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100 leading-snug mt-0.5">
                  {fmtDate(selectedShortage.date)}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{selectedShortage.patternName}</p>
              </div>
              <button onClick={() => { setSelectedShortage(null); setFocusedCandidateId(null); }}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none mt-0.5 shrink-0">✕</button>
            </div>
            {/* 候補リスト */}
            <div className="overflow-y-auto flex-1 px-2 py-2 space-y-1.5">
              {shortageCandidates.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-6">候補スタッフなし</p>
              ) : (
                shortageCandidates.map(c => {
                  const cfg = PRIORITY_CFG[c.priority];
                  const isFocused = focusedCandidateId === c.staffId;
                  return (
                    <button key={c.staffId}
                      onClick={() => setFocusedCandidateId(isFocused ? null : c.staffId)}
                      className={[
                        "w-full text-left px-2.5 py-2 rounded-xl border transition-all",
                        isFocused
                          ? "bg-blue-50 dark:bg-blue-950/40 border-blue-400 dark:border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800"
                          : `bg-white dark:bg-zinc-800 ${cfg.borderCls} hover:brightness-95`,
                      ].join(" ")}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold shrink-0 ${cfg.badgeCls}`}>
                          {cfg.badge}
                        </span>
                        <span className={[
                          "text-[13px] font-semibold truncate",
                          isFocused ? "text-blue-700 dark:text-blue-300" : "text-zinc-800 dark:text-zinc-100",
                        ].join(" ")}>{c.staffName}</span>
                        {isFocused && (
                          <span className="ml-auto text-[9px] text-blue-500 dark:text-blue-400 shrink-0">↓行を表示</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={[
                          "px-1.5 py-0.5 rounded text-[10px] font-bold",
                          c.reason === "希望休"
                            ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                            : "bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400",
                        ].join(" ")}>{c.reason}</span>
                        {c.otherRestDaysThisWeek > 0 && (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 tabular-nums">
                            週+{c.otherRestDaysThisWeek}休
                          </span>
                        )}
                        <span className={[
                          "text-[10px] tabular-nums ml-auto",
                          c.consecutiveDaysIfMoved >= 6 ? "text-red-500 dark:text-red-400 font-bold"
                          : c.consecutiveDaysIfMoved >= 5 ? "text-amber-600 dark:text-amber-400 font-semibold"
                          : "text-zinc-400",
                        ].join(" ")}>
                          →{c.consecutiveDaysIfMoved}連勤
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            {/* 凡例 */}
            <div className="shrink-0 px-3 py-2 border-t border-amber-100 dark:border-amber-900/50 space-y-1">
              {([1, 2, 3, 4] as const).map(p => (
                <span key={p} className="flex items-center gap-1.5 text-[9px] text-zinc-400">
                  <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${PRIORITY_CFG[p].badgeCls}`}>{PRIORITY_CFG[p].badge}</span>
                  {PRIORITY_CFG[p].desc}
                </span>
              ))}
            </div>
          </div>
        )}

      </div>{/* /メインエリア */}

      {/* ── 下ドロワー（モバイル用・md未満で表示） ── */}
      {selectedShortage && (
        <div className="md:hidden fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-zinc-900 rounded-t-2xl shadow-2xl border-t border-amber-200 dark:border-amber-800 max-h-[58dvh] flex flex-col"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          {/* ドラッグハンドル */}
          <div className="flex justify-center pt-2 pb-1 shrink-0">
            <div className="w-9 h-1 rounded-full bg-zinc-200 dark:bg-zinc-700" />
          </div>
          {/* ヘッダー */}
          <div className="px-4 pb-2 flex items-center justify-between shrink-0">
            <div>
              <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                {fmtDate(selectedShortage.date)}　{selectedShortage.patternName}
              </p>
              <p className="text-[10px] text-zinc-400">
                休み候補　{shortageCandidates.length > 0 ? `${shortageCandidates.length}名` : "なし"}
              </p>
            </div>
            <button onClick={() => { setSelectedShortage(null); setFocusedCandidateId(null); }}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-sm shrink-0">✕</button>
          </div>
          {/* 候補リスト */}
          <div className="overflow-y-auto flex-1 px-3 pb-3 space-y-2">
            {shortageCandidates.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-4">候補スタッフなし</p>
            ) : (
              shortageCandidates.map(c => {
                const cfg = PRIORITY_CFG[c.priority];
                const isFocused = focusedCandidateId === c.staffId;
                return (
                  <button key={c.staffId}
                    onClick={() => setFocusedCandidateId(isFocused ? null : c.staffId)}
                    className={[
                      "w-full flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all text-left",
                      isFocused
                        ? "bg-blue-50 dark:bg-blue-950/40 border-blue-400 dark:border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800"
                        : `bg-zinc-50 dark:bg-zinc-800 ${cfg.borderCls}`,
                    ].join(" ")}>
                    <span className={`px-1.5 py-0.5 rounded-lg text-[10px] font-bold shrink-0 ${cfg.badgeCls}`}>
                      {cfg.badge}
                    </span>
                    <span className={[
                      "font-semibold text-sm flex-1 truncate",
                      isFocused ? "text-blue-700 dark:text-blue-300" : "text-zinc-800 dark:text-zinc-100",
                    ].join(" ")}>{c.staffName}</span>
                    <span className={[
                      "px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0",
                      c.reason === "希望休"
                        ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                        : "bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400",
                    ].join(" ")}>{c.reason}</span>
                    {c.otherRestDaysThisWeek > 0 && (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
                        週+{c.otherRestDaysThisWeek}休
                      </span>
                    )}
                    <span className={[
                      "text-[10px] tabular-nums shrink-0",
                      c.consecutiveDaysIfMoved >= 6 ? "text-red-500 dark:text-red-400 font-bold"
                      : c.consecutiveDaysIfMoved >= 5 ? "text-amber-600 dark:text-amber-400 font-semibold"
                      : "text-zinc-400",
                    ].join(" ")}>→{c.consecutiveDaysIfMoved}連勤</span>
                    {isFocused && (
                      <span className="text-[9px] text-blue-500 shrink-0">↓</span>
                    )}
                  </button>
                );
              })
            )}
            {/* 凡例 */}
            {shortageCandidates.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                {([1, 2, 3, 4] as const).map(p => (
                  <span key={p} className="flex items-center gap-1 text-[9px] text-zinc-400">
                    <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${PRIORITY_CFG[p].badgeCls}`}>{PRIORITY_CFG[p].badge}</span>
                    {PRIORITY_CFG[p].desc}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* スタッフ情報パネル */}
      {staffInfoTarget && (
        <StaffInfoPanel
          key={staffInfoTarget.id}
          member={{
            id:                   staffInfoTarget.id,
            name:                 staffInfoTarget.name,
            section:              staffInfoTarget.section,
            sections:             staffInfoTarget.sections,
            work_days_type:       staffInfoTarget.work_days_type ?? null,
            work_days_count:      staffInfoTarget.work_days_count ?? null,
            preferred_shift:      staffInfoTarget.preferred_shift ?? null,
            preferred_section:    staffInfoTarget.preferred_section ?? null,
            max_consecutive_days: staffInfoTarget.max_consecutive_days ?? null,
            shift_note:           staffInfoTarget.shift_note ?? null,
            endDate:              staffInfoTarget.endDate,
            churn_risk:           staffInfoTarget.churn_risk ?? false,
            company_name:         staffInfoTarget.company_name ?? null,
            role:                 staffInfoTarget.role ?? null,
            start_date:           staffInfoTarget.start_date ?? null,
            account_number:       staffInfoTarget.accountNumber ?? null,
          }}
          projectId={projectId}
          availableSections={availableSections}
          shiftPatternNames={shiftPatterns.map(p => p.name).filter(Boolean)}
          targetYM={targetMonth}
          staffOffRequests={(offRequests ?? []).filter(r => r.staff_id === staffInfoTarget.id)}
          onDraftCellsChanged={(cells) => {
            const next = new Map(drafts);
            for (const c of cells) {
              next.set(`${c.staffId}__${c.date}`, { shiftName: c.shiftName, shiftStart: null, shiftEnd: null });
            }
            applyEdit(next);
          }}
          onDraftCellsRemoved={(cells) => {
            const next = new Map(drafts);
            for (const c of cells) next.delete(`${c.staffId}__${c.date}`);
            applyEdit(next);
          }}
          onSyncHolidays={(staffId, months, newDates) => {
            const next = new Map(drafts);
            // 対象月のこのスタッフの「希望休」セルを全削除
            for (const [key, val] of next) {
              if (val?.shiftName === "希望休") {
                const [kStaff, kDate] = key.split("__");
                if (kStaff === staffId && months.includes(kDate?.slice(0, 7) ?? "")) {
                  next.delete(key);
                }
              }
            }
            // 新しい希望休を追加
            for (const date of newDates) {
              next.set(`${staffId}__${date}`, { shiftName: "希望休", shiftStart: null, shiftEnd: null });
            }
            applyEdit(next);
          }}
          onChurnRiskChanged={(staffId, value, since) => {
            setChurnRiskOverrides(prev => {
              const next = new Map(prev);
              next.set(staffId, { churn_risk: value, churn_risk_since: since });
              return next;
            });
          }}
          onClose={() => setStaffInfoTarget(null)}
        />
      )}

      {/* Summary Modal */}
      {showSummary && (
        <SummaryModal
          draftChanges={draftChanges}
          onClose={() => setShowSummary(false)}
        />
      )}

      {/* 日付ソート・フィルターポップオーバー */}
      {dateFilterPopoverDate && dateFilterPopoverRect && activeDateFilter && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          <div className="absolute inset-0 pointer-events-auto" onClick={() => setDateFilterPopoverDate(null)} />
          <div
            className="absolute bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-700 w-64 pointer-events-auto overflow-hidden"
            style={{ top: Math.min(dateFilterPopoverRect.bottom + 4, window.innerHeight - 400), left: Math.min(dateFilterPopoverRect.left - 16, window.innerWidth - 272) }}
            onClick={e => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-700">
              <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
                {parseInt(dateFilterPopoverDate.slice(8))}日 ソート・フィルター
              </span>
              <button onClick={() => setDateFilterPopoverDate(null)} className="text-zinc-400 hover:text-zinc-600 text-sm leading-none">✕</button>
            </div>
            {/* ソート */}
            <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-1.5">ソート</p>
              {(["section", "shift"] as const).map(opt => (
                <label key={opt} className="flex items-center gap-2 py-0.5 cursor-pointer">
                  <input type="radio" checked={activeDateFilter.sortBy === opt}
                    onChange={() => setActiveDateFilter(f => f ? { ...f, sortBy: opt } : f)}
                    className="accent-blue-600" />
                  <span className="text-xs text-zinc-700 dark:text-zinc-200">
                    {opt === "section" ? "セクション順" : "シフト順（開始時刻）"}
                  </span>
                </label>
              ))}
            </div>
            {/* セクションフィルター */}
            <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-1.5">フィルター：セクション（複数可）</p>
              <div className="max-h-28 overflow-y-auto space-y-0.5">
                {availableSections.map(sec => (
                  <label key={sec} className="flex items-center gap-2 py-0.5 cursor-pointer">
                    <input type="checkbox" checked={activeDateFilter.filterSections.includes(sec)}
                      onChange={(e) => setActiveDateFilter(f => {
                        if (!f) return f;
                        return { ...f, filterSections: e.target.checked ? [...f.filterSections, sec] : f.filterSections.filter(s => s !== sec) };
                      })}
                      className="accent-blue-600" />
                    <span className="text-xs text-zinc-700 dark:text-zinc-200">{sec}</span>
                  </label>
                ))}
              </div>
            </div>
            {/* シフトフィルター */}
            <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-1.5">フィルター：シフト（複数可）</p>
              {shiftsOnDate.length === 0
                ? <p className="text-[10px] text-zinc-400">この日のシフトデータなし</p>
                : (
                  <div className="max-h-28 overflow-y-auto space-y-0.5">
                    {shiftsOnDate.map(shiftName => (
                      <label key={shiftName} className="flex items-center gap-2 py-0.5 cursor-pointer">
                        <input type="checkbox" checked={activeDateFilter.filterShifts.includes(shiftName)}
                          onChange={(e) => setActiveDateFilter(f => {
                            if (!f) return f;
                            return { ...f, filterShifts: e.target.checked ? [...f.filterShifts, shiftName] : f.filterShifts.filter(s => s !== shiftName) };
                          })}
                          className="accent-blue-600" />
                        <span className="text-xs text-zinc-700 dark:text-zinc-200">{shiftName}</span>
                      </label>
                    ))}
                  </div>
                )
              }
            </div>
            {/* フッター */}
            <div className="px-3 py-2 flex justify-between items-center">
              <button
                onClick={() => { setActiveDateFilter(null); setDateFilterPopoverDate(null); }}
                className="text-xs text-red-500 hover:text-red-700 transition-colors"
              >クリア</button>
              <button
                onClick={() => setDateFilterPopoverDate(null)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
              >閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Pattern Picker */}
      {popover && (
        <InlinePatternPicker
          staffId={popover.staffId}
          date={popover.date}
          currentShift={resolveCell(popover.staffId, popover.date)?.shiftName ?? null}
          staffMember={memberById.get(popover.staffId) ?? null}
          patterns={shiftPatterns}
          logs={changeLogMap.get(`${popover.staffId}__${popover.date}`) ?? []}
          consecutiveDays={getConsecutiveDays(popover.staffId, popover.date)}
          isDuplicate={duplicateStaffDates.set.has(`${popover.staffId}__${popover.date}`)}
          projectId={projectId}
          onAssign={handlePopoverAssign}
          onRemove={handlePopoverRemove}
          onClose={() => setPopover(null)}
          anchorRect={popover.rect}
        />
      )}

      {/* 必要枠数編集モーダル */}
      {reqEditPattern && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => { setReqEditPattern(null); setReqSaveMsg(null); }}>
          <div className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[85dvh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            {/* ヘッダー */}
            <div className="px-4 pt-4 pb-2 border-b border-zinc-100 dark:border-zinc-800 shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">必要枠数を変更</h2>
                <p className="text-xs text-zinc-400 mt-0.5">{reqEditPattern.name}</p>
              </div>
              <button onClick={() => { setReqEditPattern(null); setReqSaveMsg(null); }}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-sm shrink-0">✕</button>
            </div>
            {/* 日付リスト */}
            <div className="overflow-y-auto flex-1 px-4 py-3 space-y-1.5">
              <p className="text-[10px] text-zinc-400 mb-2">日付をタップして必要人数を変更。変更した日付のみ保存されます。</p>
              {allDates.map(date => {
                const dw = dowNum(date); const isSun = dw === 0, isSat = dw === 6;
                const currentReq = getRequired(reqEditPattern!.name, date);
                const inputVal = reqEditValues.get(date) ?? String(currentReq);
                const isChanged = inputVal !== String(currentReq);
                return (
                  <div key={date} className={["flex items-center gap-3 px-2 py-1 rounded-lg", isChanged ? "bg-amber-50 dark:bg-amber-950/30" : ""].join(" ")}>
                    <span className={["text-xs tabular-nums font-medium w-24 shrink-0",
                      isSun ? "text-red-500 dark:text-red-400" : isSat ? "text-blue-500 dark:text-blue-400" : "text-zinc-600 dark:text-zinc-300"
                    ].join(" ")}>
                      {fmtDate(date)}
                    </span>
                    <input
                      type="number" min={0} max={99}
                      value={inputVal}
                      onChange={e => setReqEditValues(prev => {
                        const n = new Map(prev);
                        n.set(date, e.target.value);
                        return n;
                      })}
                      className="w-14 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 text-center tabular-nums"
                    />
                    <span className="text-[10px] text-zinc-400 shrink-0">人</span>
                    {isChanged && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold shrink-0">変更中</span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* フィードバック */}
            {reqSaveMsg && (
              <p className={["text-xs px-4 py-2 border-t shrink-0",
                reqSaveMsg.startsWith("✓")
                  ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-800"
                  : "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-100 dark:border-red-800"
              ].join(" ")}>{reqSaveMsg}</p>
            )}
            {/* ボタン */}
            <div className="px-4 pb-4 pt-2 flex gap-2 shrink-0">
              <button onClick={() => { setReqEditPattern(null); setReqSaveMsg(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                キャンセル
              </button>
              <button
                disabled={isSavingReqs}
                onClick={() => {
                  const pat = reqEditPattern!;
                  const changes: { patternName: string; date: string; section: string | null; requiredCount: number }[] = [];
                  const updates = new Map(localSlotReqOverrides);
                  for (const date of allDates) {
                    const currentReq = getRequired(pat.name, date);
                    const inputVal = reqEditValues.get(date) ?? String(currentReq);
                    if (inputVal !== String(currentReq)) {
                      const num = parseInt(inputVal, 10);
                      if (!isNaN(num) && num >= 0) {
                        changes.push({ patternName: pat.name, date, section: pat.section, requiredCount: num });
                        updates.set(`${pat.name}__${date}`, num);
                      }
                    }
                  }
                  if (changes.length === 0) { setReqEditPattern(null); return; }
                  startReqSaveTransition(async () => {
                    const r = await upsertSlotRequirementsAction(projectId, changes);
                    if (r.success) {
                      setLocalSlotReqOverrides(updates);
                      setReqEditValues(new Map());
                      setReqSaveMsg("✓ 保存しました");
                      setTimeout(() => { setReqSaveMsg(null); setReqEditPattern(null); }, 1200);
                    } else {
                      setReqSaveMsg("✗ " + (r.message ?? "保存に失敗しました"));
                    }
                  });
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors">
                {isSavingReqs ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notify Modal */}
      {pendingNotify && (
        <NotifyModal
          projectId={projectId}
          changes={pendingNotify.changes}
          upserts={pendingNotify.upserts}
          dels={pendingNotify.dels}
          slotChanges={pendingNotify.slotChanges}
          targetMonth={pendingNotify.targetMonth}
          onCancel={() => setPendingNotify(null)}
          onSaved={() => { setPendingNotify(null); setDrafts(new Map()); setSaveError(null); onSaved(); }}
        />
      )}
    </div>
  );
}
