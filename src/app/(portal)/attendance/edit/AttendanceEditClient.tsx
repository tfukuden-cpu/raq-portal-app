"use client";

import { useState, useMemo, useTransition } from "react";
import { savePunchCorrectionAction } from "./actions";

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
  startDate: initStart,
  endDate: initEnd,
}: {
  projectId: string;
  rows: AttendanceRow[];
  startDate: string;
  endDate: string;
}) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  const [startDate, setStartDate] = useState(initStart);
  const [endDate,   setEndDate]   = useState(initEnd);
  const [filterStatus, setFilterStatus] = useState<"issues" | "all">("issues");
  const [search, setSearch] = useState("");
  const [localRows, setLocalRows] = useState<AttendanceRow[]>(rows);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = localRows.filter(r => r.date >= startDate && r.date <= endDate);
    if (filterStatus === "issues") {
      list = list.filter(r => r.status !== "ok");
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.staffId.toLowerCase().includes(q) ||
        (r.accountNumber ?? "").includes(q)
      );
    }
    return list;
  }, [localRows, startDate, endDate, filterStatus, search]);

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

  const issueCount = localRows.filter(r =>
    r.date >= startDate && r.date <= endDate && r.status !== "ok"
  ).length;

  return (
    <div className="space-y-4">
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
        <div className="flex gap-2">
          <button onClick={() => setFilterStatus("issues")}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filterStatus === "issues"
                ? "bg-red-600 text-white border-red-600"
                : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            }`}>
            問題あり {issueCount > 0 && `(${issueCount})`}
          </button>
          <button onClick={() => setFilterStatus("all")}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filterStatus === "all"
                ? "bg-blue-600 text-white border-blue-600"
                : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            }`}>
            全件
          </button>
        </div>
      </div>

      {/* 一覧テーブル */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
        {/* ヘッダー */}
        <div className="grid grid-cols-[5rem_2.5rem_1fr_4rem_4rem_5rem_2rem] gap-x-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 text-xs font-semibold text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
          <span>日付</span>
          <span>No.</span>
          <span>名前</span>
          <span className="tabular-nums text-center">出勤</span>
          <span className="tabular-nums text-center">退勤</span>
          <span className="text-center">状態</span>
          <span></span>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-400">
            {filterStatus === "issues" ? "問題のある打刻はありません" : "データがありません"}
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filtered.map(row => {
              const st = STATUS_LABEL[row.status];
              return (
                <div key={`${row.date}_${row.staffId}`}
                  className="grid grid-cols-[5rem_2.5rem_1fr_4rem_4rem_5rem_2rem] gap-x-2 px-3 py-2.5 items-center hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                  <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{row.date.slice(5)}</span>
                  <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500 truncate">{row.accountNumber ?? ""}</span>
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate block">{row.name}</span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate block">{row.shiftName}</span>
                  </div>
                  <span className="text-xs tabular-nums text-center text-zinc-700 dark:text-zinc-300">
                    {row.clockIn ? toHHMM(row.clockIn) : <span className="text-red-400">─</span>}
                  </span>
                  <span className="text-xs tabular-nums text-center text-zinc-700 dark:text-zinc-300">
                    {row.clockOut ? toHHMM(row.clockOut) : <span className="text-orange-400">─</span>}
                  </span>
                  <span className={`text-xs text-center ${st.color}`}>{st.label}</span>
                  <button onClick={() => openEdit(row)}
                    className="text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-sm">
                    ✏️
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
    </div>
  );
}
