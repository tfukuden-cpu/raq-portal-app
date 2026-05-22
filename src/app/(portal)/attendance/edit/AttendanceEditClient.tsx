"use client";

import { useState, useMemo, useTransition } from "react";
import { savePunchCorrectionAction } from "./actions";
import { reviewCorrectionAction } from "../../corrections/actions";
import WorkRecordsClient from "@/app/(portal)/admin/work-records/WorkRecordsClient";
import type { StaffEntry } from "@/app/(portal)/admin/work-records/WorkRecordsClient";

export type AttendanceRow = {
  date: string;
  staffId: string;
  name: string;
  accountNumber: string | null;
  section: string | null;
  shiftName: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  clockIn: string | null;
  clockOut: string | null;
  isLate: boolean;
  lateReason: string | null;
  isEarlyLeave: boolean;
  isAbsent: boolean;
  absenceReason: string | null;
  // ステータス
  status: "ok" | "no_clockin" | "no_clockout" | "absent" | "late" | "early";
};

export type CorrectionRow = {
  id: string;
  target_date: string;
  corrected_in: string | null;
  corrected_out: string | null;
  reason: string;
  status: string;
  review_note: string | null;
  created_at: string;
  staff_id: string;
  staff_name: string;
};

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
const CORR_STATUS_STYLE: Record<string, string> = {
  pending:  "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300",
  approved: "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300",
  rejected: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300",
};
const CORR_STATUS_LABEL: Record<string, string> = {
  pending: "審査中", approved: "承認", rejected: "却下",
};

const STATUS_LABEL: Record<AttendanceRow["status"], { label: string; color: string }> = {
  ok:          { label: "正常",       color: "text-zinc-400 dark:text-zinc-500" },
  no_clockin:  { label: "出勤未打刻", color: "text-red-600 dark:text-red-400 font-semibold" },
  no_clockout: { label: "退勤未打刻", color: "text-orange-600 dark:text-orange-400 font-semibold" },
  absent:      { label: "欠勤",       color: "text-red-500 dark:text-red-400" },
  late:        { label: "遅刻",       color: "text-yellow-600 dark:text-yellow-400" },
  early:       { label: "早退",       color: "text-blue-500 dark:text-blue-400" },
};

function toHHMM(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

type EditState = {
  row: AttendanceRow;
  clockIn: string;
  clockOut: string;
  isAbsent: boolean;
  absenceReason: string;
  isLate: boolean;
  lateReason: string;
};

export default function AttendanceEditClient({
  projectId,
  rows,
  corrections,
  startDate: initStart,
  endDate: initEnd,
  staffs,
  initialTab = "anomaly",
}: {
  projectId: string;
  rows: AttendanceRow[];
  corrections: CorrectionRow[];
  startDate: string;
  endDate: string;
  staffs: StaffEntry[];
  initialTab?: "anomaly" | "corrections" | "records";
}) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  const [activeTab, setActiveTab] = useState<"anomaly" | "corrections" | "records">(initialTab);
  const [startDate, setStartDate] = useState(initStart);
  const [endDate,   setEndDate]   = useState(initEnd);
  const [search, setSearch] = useState("");
  const [localRows, setLocalRows] = useState<AttendanceRow[]>(rows);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  // 補正申請
  const [localCorrections, setLocalCorrections] = useState<CorrectionRow[]>(corrections);
  const [corrFilter, setCorrFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [corrModal, setCorrModal] = useState<{ correction: CorrectionRow; action: "approve" | "reject" } | null>(null);
  const [corrNote, setCorrNote] = useState("");
  const [corrPending, startCorrTransition] = useTransition();
  const [corrError, setCorrError] = useState<string | null>(null);

  const pendingCorrCount = localCorrections.filter(c => c.status === "pending").length;

  const filtered = useMemo(() => {
    let list = localRows.filter(r => r.date >= startDate && r.date <= endDate && r.status !== "ok");
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.staffId.toLowerCase().includes(q) ||
        (r.accountNumber ?? "").includes(q)
      );
    }
    return list;
  }, [localRows, startDate, endDate, search]);

  function openEdit(row: AttendanceRow) {
    setEditState({
      row,
      clockIn:       toHHMM(row.clockIn),
      clockOut:      toHHMM(row.clockOut),
      isAbsent:      row.isAbsent,
      absenceReason: row.absenceReason ?? "",
      isLate:        row.isLate,
      lateReason:    row.lateReason ?? "",
    });
  }

  function handleSave() {
    if (!editState) return;
    const { row, clockIn, clockOut, isAbsent, absenceReason, isLate, lateReason } = editState;
    startTransition(async () => {
      const res = await savePunchCorrectionAction(
        projectId, row.staffId, row.date,
        clockIn  || null,
        clockOut || null,
        isAbsent, absenceReason,
        isLate,   lateReason,
      );
      if (!res.ok) {
        setToast(`エラー: ${res.error}`);
        setTimeout(() => setToast(null), 4000);
        return;
      }
      // ローカル状態を更新
      setLocalRows(prev => prev.map(r => {
        if (r.staffId !== row.staffId || r.date !== row.date) return r;
        const newClockIn  = clockIn  ? `${row.date}T${clockIn}:00+09:00`  : null;
        const newClockOut = clockOut ? `${row.date}T${clockOut}:00+09:00` : null;
        let status: AttendanceRow["status"] = "ok";
        if (isAbsent)         status = "absent";
        else if (!newClockIn)  status = "no_clockin";
        else if (!newClockOut) status = "no_clockout";
        else if (isLate)       status = "late";
        return { ...r, clockIn: newClockIn, clockOut: newClockOut, isAbsent, absenceReason, isLate, lateReason, status };
      }));
      setEditState(null);
      setToast("修正しました");
      setTimeout(() => setToast(null), 2500);
    });
  }

  function handleCorrReview() {
    if (!corrModal) return;
    setCorrError(null);
    const fd = new FormData();
    fd.set("id", corrModal.correction.id);
    fd.set("status", corrModal.action === "approve" ? "approved" : "rejected");
    fd.set("reviewNote", corrNote);
    startCorrTransition(async () => {
      const r = await reviewCorrectionAction(fd);
      if (!r.success) { setCorrError(r.message ?? "失敗しました"); return; }
      setLocalCorrections(prev => prev.map(c =>
        c.id === corrModal.correction.id
          ? { ...c, status: corrModal.action === "approve" ? "approved" : "rejected", review_note: corrNote }
          : c
      ));
      setCorrModal(null);
    });
  }

  const issueCount = filtered.length;

  return (
    <div className="space-y-4">
      {/* タブ */}
      <div className="flex border-b border-zinc-100 dark:border-zinc-800">
        {([
          { id: "anomaly",     label: "勤怠修正",  badge: issueCount > 0 ? issueCount : null },
          { id: "corrections", label: "補正申請",  badge: pendingCorrCount > 0 ? pendingCorrCount : null },
          { id: "records",     label: "実績確認",  badge: null },
        ] as { id: "anomaly" | "corrections" | "records"; label: string; badge: number | null }[]).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={[
              "flex-shrink-0 px-5 py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5",
              activeTab === t.id
                ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
            ].join(" ")}
          >
            {t.label}
            {t.badge !== null && (
              <span className="bg-red-500 text-white rounded-full px-1.5 text-[10px] tabular-nums">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* 補正申請タブ */}
      {activeTab === "corrections" && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {(["pending", "all", "approved", "rejected"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setCorrFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  corrFilter === f
                    ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-transparent"
                    : "border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}>
                {f === "all" ? "すべて" : CORR_STATUS_LABEL[f]}
                {f === "pending" && pendingCorrCount > 0 && (
                  <span className="ml-1.5 bg-red-500 text-white rounded-full px-1.5 text-[10px]">{pendingCorrCount}</span>
                )}
              </button>
            ))}
          </div>
          {(corrFilter === "all" ? localCorrections : localCorrections.filter(c => c.status === corrFilter)).length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-12 text-center text-sm text-zinc-400">
              {corrFilter === "pending" ? "審査待ちの申請はありません" : "申請がありません"}
            </div>
          ) : (
            <ul className="space-y-2">
              {(corrFilter === "all" ? localCorrections : localCorrections.filter(c => c.status === corrFilter)).map((c) => {
                const d = new Date(c.target_date + "T00:00:00+09:00");
                return (
                  <li key={c.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${CORR_STATUS_STYLE[c.status]}`}>
                            {CORR_STATUS_LABEL[c.status]}
                          </span>
                          <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                            {d.getMonth() + 1}/{d.getDate()}（{WEEKDAY_JP[d.getDay()]}）
                          </span>
                          <span className="text-xs text-zinc-500">{c.staff_name}</span>
                        </div>
                        {(c.corrected_in || c.corrected_out) && (
                          <p className="text-xs font-mono text-zinc-500">
                            出勤: {c.corrected_in?.slice(0, 5) ?? "変更なし"} / 退勤: {c.corrected_out?.slice(0, 5) ?? "変更なし"}
                          </p>
                        )}
                        <p className="text-xs text-zinc-500 mt-0.5 truncate">理由：{c.reason}</p>
                        {c.review_note && <p className="text-xs text-zinc-400 mt-0.5">コメント：{c.review_note}</p>}
                      </div>
                      {c.status === "pending" && (
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button type="button"
                            onClick={() => { setCorrNote(""); setCorrError(null); setCorrModal({ correction: c, action: "approve" }); }}
                            className="text-xs px-2.5 py-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white">承認</button>
                          <button type="button"
                            onClick={() => { setCorrNote(""); setCorrError(null); setCorrModal({ correction: c, action: "reject" }); }}
                            className="text-xs px-2.5 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white">却下</button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* 補正申請モーダル */}
      {corrModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setCorrModal(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-sm w-full p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className={`text-base font-bold mb-3 ${corrModal.action === "approve" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
              {corrModal.action === "approve" ? "承認しますか？" : "却下しますか？"}
            </h2>
            {(() => {
              const d = new Date(corrModal.correction.target_date + "T00:00:00+09:00");
              return (
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-3">
                  {corrModal.correction.staff_name} / {d.getMonth() + 1}/{d.getDate()}（{WEEKDAY_JP[d.getDay()]}）<br />
                  <span className="text-xs font-mono text-zinc-500">
                    {corrModal.correction.corrected_in?.slice(0, 5) ?? "--:--"} → {corrModal.correction.corrected_out?.slice(0, 5) ?? "--:--"}
                  </span>
                </p>
              );
            })()}
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">コメント（任意）</label>
            <textarea value={corrNote} onChange={e => setCorrNote(e.target.value)}
              rows={2} className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none mb-3" />
            {corrError && <p className="text-sm text-red-600 mb-2">{corrError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setCorrModal(null)}
                className="flex-1 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm">キャンセル</button>
              <button type="button" onClick={handleCorrReview} disabled={corrPending}
                className={`flex-1 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50 ${
                  corrModal.action === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}>
                {corrPending ? "処理中..." : corrModal.action === "approve" ? "承認する" : "却下する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "anomaly" && <>
      {/* フィルター */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex items-center gap-1">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-zinc-400 text-sm">〜</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <input type="search" placeholder="氏名・ID・アカウント番号" value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-40 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {issueCount > 0 && (
          <p className="text-xs text-red-500 font-medium">問題あり {issueCount}件</p>
        )}
      </div>

      {/* 一覧 */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-12 text-center text-sm text-zinc-400">
          問題のある打刻はありません
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(row => {
            const st = STATUS_LABEL[row.status];
            return (
              <div key={`${row.date}_${row.staffId}`}
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl px-4 py-3">
                {/* 上段：日付・名前・ステータス・編集ボタン */}
                <div className="flex items-start gap-2">
                  <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500 pt-0.5 flex-shrink-0 w-10">
                    {row.date.slice(5)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">{row.name}</p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
                      {row.accountNumber && <span className="mr-1">{row.accountNumber}</span>}
                      {row.shiftName}
                    </p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${st.color}`}>
                    {st.label}
                  </span>
                  <button
                    onClick={() => openEdit(row)}
                    className="flex-shrink-0 px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-xs font-bold hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
                  >
                    修正
                  </button>
                </div>
                {/* 下段：出退勤時刻 */}
                <div className="mt-2 flex items-center gap-3 pl-12">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-400 font-semibold">出勤</span>
                    <span className={`text-sm tabular-nums font-mono font-semibold ${row.clockIn ? "text-zinc-700 dark:text-zinc-300" : "text-red-400"}`}>
                      {row.clockIn ? toHHMM(row.clockIn) : "─"}
                    </span>
                  </div>
                  <span className="text-zinc-300 dark:text-zinc-600">→</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-400 font-semibold">退勤</span>
                    <span className={`text-sm tabular-nums font-mono font-semibold ${row.clockOut ? "text-zinc-700 dark:text-zinc-300" : "text-orange-400"}`}>
                      {row.clockOut ? toHHMM(row.clockOut) : "─"}
                    </span>
                  </div>
                  {(row.shiftStart || row.shiftEnd) && (
                    <span className="text-[10px] text-zinc-300 dark:text-zinc-600 ml-auto">
                      予定 {row.shiftStart ?? "─"}〜{row.shiftEnd ?? "─"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 修正モーダル */}
      {editState && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl shadow-xl overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-xs text-zinc-400">{editState.row.date}　{editState.row.shiftName}</p>
              <p className="font-bold text-lg text-zinc-900 dark:text-zinc-50 mt-0.5">
                {editState.row.accountNumber && <span className="text-zinc-400 font-normal text-sm mr-1">{editState.row.accountNumber}</span>}
                {editState.row.name}
              </p>
              {(editState.row.shiftStart || editState.row.shiftEnd) && (
                <p className="text-xs text-zinc-400 mt-0.5">
                  予定: {editState.row.shiftStart ?? "─"} 〜 {editState.row.shiftEnd ?? "─"}
                </p>
              )}
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* 打刻 */}
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">出勤打刻</span>
                  <input type="time" value={editState.clockIn}
                    onChange={e => setEditState(s => s ? { ...s, clockIn: e.target.value } : s)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {editState.clockIn && (
                    <button onClick={() => setEditState(s => s ? { ...s, clockIn: "" } : s)}
                      className="text-xs text-red-400 hover:text-red-600">削除</button>
                  )}
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">退勤打刻</span>
                  <input type="time" value={editState.clockOut}
                    onChange={e => setEditState(s => s ? { ...s, clockOut: e.target.value } : s)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {editState.clockOut && (
                    <button onClick={() => setEditState(s => s ? { ...s, clockOut: "" } : s)}
                      className="text-xs text-red-400 hover:text-red-600">削除</button>
                  )}
                </label>
              </div>

              {/* 欠勤 */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editState.isAbsent}
                    onChange={e => setEditState(s => s ? { ...s, isAbsent: e.target.checked } : s)}
                    className="w-4 h-4 rounded accent-red-500" />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">欠勤</span>
                </label>
                {editState.isAbsent && (
                  <input type="text" placeholder="欠勤理由（任意）"
                    value={editState.absenceReason}
                    onChange={e => setEditState(s => s ? { ...s, absenceReason: e.target.value } : s)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                )}
              </div>

              {/* 遅刻 */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editState.isLate}
                    onChange={e => setEditState(s => s ? { ...s, isLate: e.target.checked } : s)}
                    className="w-4 h-4 rounded accent-yellow-500" />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">遅刻</span>
                </label>
                {editState.isLate && (
                  <input type="text" placeholder="遅刻理由（任意）"
                    value={editState.lateReason}
                    onChange={e => setEditState(s => s ? { ...s, lateReason: e.target.value } : s)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                )}
              </div>
            </div>

            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setEditState(null)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                キャンセル
              </button>
              <button onClick={handleSave} disabled={isPending}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white text-sm font-semibold transition-colors">
                {isPending ? "保存中…" : "保存する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* トースト */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium shadow-lg">
          {toast}
        </div>
      )}
      </>}

      {/* 実績出力タブ */}
      {activeTab === "records" && (
        <WorkRecordsClient projectId={projectId} staffs={staffs} />
      )}
    </div>
  );
}
