"use client";

import { useState, useTransition } from "react";
import {
  fetchTrainingSessionsAction,
  createTrainingSessionAction,
  deleteTrainingSessionAction,
  type TrainingSession,
} from "./training-session-actions";
import { overrideDraftCellsAction } from "@/app/(portal)/shifts/actions";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

export type TrainingMember = {
  id: string;
  name: string;
  accountNumber: string | null;
  section: string | null;
};

interface Props {
  projectId: string;
  members: TrainingMember[];
  initialSessions: TrainingSession[];
  targetMonth: string; // "YYYY-MM"
}

const DOW_JP = ["日", "月", "火", "水", "木", "金", "土"];

const TRAINING_TYPES = [
  { value: "導入研修",  label: "導入研修" },
  { value: "案件研修",  label: "案件研修" },
  { value: "その他研修", label: "その他研修" },
];

function toYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function fmtDate(d: string): string {
  const [, m, day] = d.split("-");
  return `${parseInt(m)}/${parseInt(day)}`;
}
function fmtTime(t: string | null): string {
  if (!t) return "";
  return t.slice(0, 5);
}

export default function ShiftTrainingTab({
  projectId, members, initialSessions, targetMonth,
}: Props) {
  const [sessions, setSessions] = useState<TrainingSession[]>(initialSessions);
  const [showForm, setShowForm] = useState(false);

  // ── フォーム状態 ────────────────────────────────────────
  const [trainingType, setTrainingType] = useState("導入研修");
  const [customName,   setCustomName]   = useState("");
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [startTime, setStartTime] = useState("");
  const [endTime,   setEndTime]   = useState("");
  const [staffSearch,    setStaffSearch]    = useState("");
  const [selectedStaff,  setSelectedStaff]  = useState<Set<string>>(new Set());
  const [calYear,  setCalYear]  = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());

  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTrans]   = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const trainingName = trainingType === "その他研修" ? (customName.trim() || "その他研修") : trainingType;

  function resetForm() {
    setTrainingType("導入研修");
    setCustomName("");
    setSelectedDates(new Set());
    setStartTime("");
    setEndTime("");
    setStaffSearch("");
    setSelectedStaff(new Set());
    setFormError(null);
  }

  function openForm() { resetForm(); setShowForm(true); }
  function closeForm() { setShowForm(false); resetForm(); }

  // カレンダー
  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const lastDay  = new Date(calYear, calMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: lastDay }, (_, i) => i + 1),
  ];

  function toggleDate(day: number) {
    const d = toYMD(calYear, calMonth, day);
    setSelectedDates(prev => {
      const next = new Set(prev);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });
  }

  // スタッフフィルタ
  const filteredMembers = members.filter(m =>
    !staffSearch ||
    m.name.includes(staffSearch) ||
    (m.accountNumber ?? "").toLowerCase().includes(staffSearch.toLowerCase())
  );

  function toggleStaff(id: string) {
    setSelectedStaff(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAllStaff() {
    if (selectedStaff.size === members.length) {
      setSelectedStaff(new Set());
    } else {
      setSelectedStaff(new Set(members.map(m => m.id)));
    }
  }

  // ── 保存 ────────────────────────────────────────────────
  function handleSave() {
    setFormError(null);
    if (selectedDates.size === 0) { setFormError("研修日を選択してください"); return; }
    if (selectedStaff.size === 0) { setFormError("スタッフを選択してください"); return; }

    startTrans(async () => {
      const dates    = [...selectedDates].sort();
      const staffIds = [...selectedStaff];
      const res = await createTrainingSessionAction(
        projectId, trainingName, dates,
        startTime || null, endTime || null, staffIds,
      );
      if (!res.success) { setFormError(res.message ?? "保存に失敗しました"); return; }

      // 当月分をドラフトに反映
      const monthDates = dates.filter(d => d.startsWith(targetMonth));
      if (monthDates.length > 0) {
        const cells = monthDates.flatMap(date =>
          staffIds.map(staffId => ({ staffId, date, shiftName: trainingName }))
        );
        await overrideDraftCellsAction(projectId, cells);
      }

      // セッション一覧を再取得
      const updated = await fetchTrainingSessionsAction(projectId);
      setSessions(updated);
      closeForm();
    });
  }

  // ── 削除 ────────────────────────────────────────────────
  function handleDelete(batchId: string) {
    setDeletingId(batchId);
    startTrans(async () => {
      const res = await deleteTrainingSessionAction(batchId);
      if (res.success) {
        setSessions(prev => prev.filter(s => s.batchId !== batchId));
      }
      setDeletingId(null);
    });
  }

  return (
    <div className="space-y-4">
      {/* ── 追加ボタン ── */}
      {!showForm && (
        <button
          type="button"
          onClick={openForm}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          研修追加
        </button>
      )}

      {/* ── 追加フォーム ── */}
      {showForm && (
        <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/10 p-4 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">研修を追加</h3>
            <button type="button" onClick={closeForm} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-xs">キャンセル</button>
          </div>

          {/* 研修種類 */}
          <div>
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 block mb-1.5">研修種類</label>
            <div className="flex flex-wrap gap-1.5">
              {TRAINING_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTrainingType(t.value)}
                  className={[
                    "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                    trainingType === t.value
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-blue-300",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {trainingType === "その他研修" && (
              <input
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="研修名を入力"
                className="mt-2 w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            )}
          </div>

          {/* 研修日 */}
          <div>
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 block mb-1.5">
              研修日
              {selectedDates.size > 0 && (
                <span className="ml-2 text-blue-600 dark:text-blue-400">{selectedDates.size}日選択中</span>
              )}
            </label>

            {/* 月ナビ */}
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => {
                if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
                else setCalMonth(m => m - 1);
              }} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500">
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums">
                {calYear}年{calMonth + 1}月
              </span>
              <button type="button" onClick={() => {
                if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
                else setCalMonth(m => m + 1);
              }} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500">
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            </div>

            {/* 曜日ヘッダー */}
            <div className="grid grid-cols-7 mb-0.5">
              {DOW_JP.map((w, i) => (
                <div key={w} className={`text-center text-[10px] font-semibold pb-1 select-none ${
                  i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-400"
                }`}>{w}</div>
              ))}
            </div>

            {/* 日付グリッド */}
            <div className="grid grid-cols-7 gap-y-0.5">
              {cells.map((day, idx) => {
                if (!day) return <div key={`e-${idx}`} />;
                const dateStr = toYMD(calYear, calMonth, day);
                const isPicked = selectedDates.has(dateStr);
                const dowIdx = (firstDow + day - 1) % 7;
                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => toggleDate(day)}
                    className={[
                      "mx-auto flex items-center justify-center w-9 h-9 rounded-full text-xs font-medium transition-all tabular-nums",
                      isPicked
                        ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-400/30"
                        : dowIdx === 0
                        ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                        : dowIdx === 6
                        ? "text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                        : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                    ].join(" ")}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            {/* 選択日チップ */}
            {selectedDates.size > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {[...selectedDates].sort().map(d => (
                  <span
                    key={d}
                    className="inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[11px] font-medium border border-blue-200 dark:border-blue-800"
                  >
                    {fmtDate(d)}
                    <button
                      type="button"
                      onClick={() => setSelectedDates(prev => { const n = new Set(prev); n.delete(d); return n; })}
                      className="w-3.5 h-3.5 flex items-center justify-center rounded-full text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 text-[10px]"
                    >×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 研修時間 */}
          <div>
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 block mb-1.5">研修時間（任意）</label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <span className="text-zinc-400 text-sm">〜</span>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          {/* 対象スタッフ */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                対象スタッフ
                {selectedStaff.size > 0 && (
                  <span className="ml-2 text-blue-600 dark:text-blue-400">{selectedStaff.size}名選択中</span>
                )}
              </label>
              <button
                type="button"
                onClick={toggleAllStaff}
                className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                {selectedStaff.size === members.length ? "全解除" : "全選択"}
              </button>
            </div>
            <input
              type="text"
              placeholder="名前・番号で検索"
              value={staffSearch}
              onChange={e => setStaffSearch(e.target.value)}
              className="w-full mb-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <div className="max-h-48 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800">
              {filteredMembers.map(m => {
                const isSelected = selectedStaff.has(m.id);
                return (
                  <label
                    key={m.id}
                    className={[
                      "flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors select-none",
                      isSelected
                        ? "bg-blue-50 dark:bg-blue-950/30"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleStaff(m.id)}
                      className="accent-blue-600 w-4 h-4 flex-shrink-0"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate block">{m.name}</span>
                      {m.accountNumber && (
                        <span className="text-[10px] font-mono text-zinc-400">{m.accountNumber}</span>
                      )}
                    </span>
                    {m.section && (
                      <span className="text-[10px] text-zinc-400 flex-shrink-0">{m.section}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {formError && (
            <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">{formError}</p>
          )}

          {/* 保存ボタン */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeForm}
              disabled={isPending}
              className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {isPending ? "保存中…" : "保存する"}
            </button>
          </div>
        </div>
      )}

      {/* ── 研修リスト ── */}
      {sessions.length === 0 ? (
        <div className="py-10 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-700">
          <p className="text-sm text-zinc-400">研修が登録されていません</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800">
          {sessions.map(s => (
            <div key={s.batchId} className="bg-white dark:bg-zinc-900 px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  {/* 研修名 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{s.trainingName}</span>
                    {(s.startTime || s.endTime) && (
                      <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                        {fmtTime(s.startTime)}{s.startTime && s.endTime ? "〜" : ""}{fmtTime(s.endTime)}
                      </span>
                    )}
                  </div>
                  {/* 日付チップ */}
                  <div className="flex flex-wrap gap-1">
                    {s.dates.map(d => (
                      <span key={d} className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        {fmtDate(d)}
                      </span>
                    ))}
                  </div>
                  {/* スタッフ */}
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {s.staffNames.length}名：{s.staffNames.slice(0, 5).join("・")}
                    {s.staffNames.length > 5 && ` 他${s.staffNames.length - 5}名`}
                  </p>
                </div>
                {/* 削除ボタン */}
                <button
                  type="button"
                  onClick={() => handleDelete(s.batchId)}
                  disabled={isPending && deletingId === s.batchId}
                  className="flex-shrink-0 text-xs text-zinc-400 hover:text-red-500 dark:hover:text-red-400 border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 rounded-lg hover:border-red-300 dark:hover:border-red-700 transition-colors disabled:opacity-40"
                >
                  {isPending && deletingId === s.batchId ? "削除中…" : "削除"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
