"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  savePunchCorrectionAction,
  confirmAttendanceAction,
  unconfirmAttendanceAction,
  reviewCorrectionAction,
  reapplyCorrectionAction,
} from "./actions";
import AbsenteeReportClient from "./AbsenteeReportClient";
import type { StaffEntry } from "@/app/(portal)/admin/work-records/WorkRecordsClient";
import ExportModal from "./ExportModal";

// ── 型定義 ──────────────────────────────────────────────────────────────────

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
  breakMinutes: number;
  workingMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  isLate: boolean;
  lateReason: string | null;
  isEarlyLeave: boolean;
  isAbsent: boolean;
  absenceReason: string | null;
  overtimeApprover: string | null;
  earlyLeaveApprover: string | null;
  isConfirmed: boolean;
  confirmedBy: string | null;
  modifiedBy: string | null;
  clockInNote: string | null;
  clockOutNote: string | null;
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
  accountNumber: string | null;
  shiftName: string | null;
  svSigner: string | null;
};

export type ExceptionRow = {
  id: string | null;
  staff_id: string;
  shift_date: string;
  request_type: "early_leave" | "overtime";
  signer_name: string | null;
  status: string;
  created_at: string;
  staff_name: string;
  accountNumber: string | null;
};

type TabKey = "corrections" | "requests" | "records" | "absentees";

type CalEntry = { date: string; row: AttendanceRow | null; shiftName: string | null };

type EditState = {
  row: AttendanceRow;
  clockIn: string;
  clockOut: string;
  isAbsent: boolean;
  absenceReason: string;
  isLate: boolean;
  lateReason: string;
};

type CorrFilterKey = "pending" | "approved" | "rejected" | "all";
type ExcFilterKey  = "all" | "early_leave" | "overtime";

// ── ヘルパー ─────────────────────────────────────────────────────────────────

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

function toHHMM(iso: string | null): string {
  if (!iso) return "─";
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtHours(mins: number): string {
  if (mins === 0) return "─";
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
}

function fmtDate(d: string): string {
  // 曜日・日付はTZ非依存に算出（SSR=UTC とブラウザ=JST のズレ／hydration不一致を防ぐ）
  const dt = new Date(d + "T00:00:00Z");
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}（${WEEKDAY_JP[dt.getUTCDay()]}）`;
}

function fmtTime(t: string | null): string {
  if (!t) return "─";
  return t.slice(0, 5); // "09:00:00" → "09:00"
}

function fmtApplied(iso: string): string {
  const dt = new Date(iso);
  return dt.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit" })
    + " " + dt.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
}

function prevMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}
function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}


const STATUS_STYLE: Record<AttendanceRow["status"], string> = {
  ok:          "",
  no_clockin:  "bg-red-50 dark:bg-red-950/30",
  no_clockout: "bg-orange-50 dark:bg-orange-950/30",
  absent:      "bg-red-50 dark:bg-red-950/30",
  late:        "bg-yellow-50 dark:bg-yellow-950/20",
  early:       "bg-blue-50 dark:bg-blue-950/20",
};
const STATUS_LABEL: Record<AttendanceRow["status"], string> = {
  ok: "", no_clockin: "出勤未", no_clockout: "退勤未",
  absent: "欠勤", late: "遅刻", early: "早退",
};
const STATUS_TEXT: Record<AttendanceRow["status"], string> = {
  ok:          "text-zinc-400",
  no_clockin:  "text-red-600 dark:text-red-400 font-semibold",
  no_clockout: "text-orange-600 dark:text-orange-400 font-semibold",
  absent:      "text-red-500 dark:text-red-400",
  late:        "text-yellow-600 dark:text-yellow-400",
  early:       "text-blue-500 dark:text-blue-400",
};

const CORR_STATUS_STYLE: Record<string, string> = {
  pending:  "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300",
  approved: "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300",
  rejected: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300",
};
const CORR_STATUS_LABEL: Record<string, string> = {
  pending: "審査中", approved: "承認済", rejected: "却下",
};

// ── メインコンポーネント ─────────────────────────────────────────────────────

export default function AttendanceEditClient({
  projectId,
  rows,
  corrections: initialCorrections,
  exceptions,
  currentMonth,
  todayMonth,
  staffs,
  initialTab = "corrections",
  allShiftMap = {},
  initialStaffId = null,
}: {
  projectId: string;
  rows: AttendanceRow[];
  corrections: CorrectionRow[];
  exceptions: ExceptionRow[];
  currentMonth: string;
  todayMonth: string;
  staffs: StaffEntry[];
  initialTab?: TabKey;
  allShiftMap?: Record<string, string>;
  initialStaffId?: string | null;
}) {
  const router = useRouter();

  // ── タブ & 共通状態 ───────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  // ── 勤怠修正タブ ─────────────────────────────────────────────────────────
  const [corrections, setCorrections] = useState<CorrectionRow[]>(initialCorrections);
  const [corrFilter, setCorrFilter]   = useState<CorrFilterKey>("pending");
  const [corrModal,  setCorrModal]    = useState<{ row: CorrectionRow; action: "approve" | "reject" } | null>(null);
  const [corrNote,   setCorrNote]     = useState("");
  const [corrErrMsg, setCorrErrMsg]   = useState<string | null>(null);

  const corrPendingCount = useMemo(() => corrections.filter(c => c.status === "pending").length, [corrections]);
  const filteredCorr = useMemo(() => {
    if (corrFilter === "all") return corrections;
    return corrections.filter(c => c.status === corrFilter);
  }, [corrections, corrFilter]);

  function handleCorrReview() {
    if (!corrModal) return;
    setCorrErrMsg(null);
    const fd = new FormData();
    fd.set("id", corrModal.row.id);
    fd.set("status", corrModal.action === "approve" ? "approved" : "rejected");
    fd.set("reviewNote", corrNote);
    startTransition(async () => {
      const r = await reviewCorrectionAction(fd);
      if (!r.success) { setCorrErrMsg(r.message ?? "失敗しました"); return; }
      setCorrections(prev => prev.map(c =>
        c.id === corrModal.row.id
          ? { ...c, status: corrModal.action === "approve" ? "approved" : "rejected", review_note: corrNote || null }
          : c
      ));
      setCorrModal(null);
      showToast(corrModal.action === "approve" ? "承認しました" : "却下しました");
    });
  }

  // ── 申請一覧タブ ─────────────────────────────────────────────────────────
  const [excFilter, setExcFilter] = useState<ExcFilterKey>("all");

  const filteredExc = useMemo(() => {
    if (excFilter === "all") return exceptions;
    return exceptions.filter(e => e.request_type === excFilter);
  }, [exceptions, excFilter]);

  // ── 勤怠実績タブ ─────────────────────────────────────────────────────────
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(initialStaffId);
  const [search,          setSearch]          = useState("");
  const [showExport,      setShowExport]      = useState(false);
  const [editState,       setEditState]       = useState<EditState | null>(null);

  const [confirmMap, setConfirmMap] = useState<Map<string, string | null>>(() => {
    const m = new Map<string, string | null>();
    for (const r of rows) m.set(`${r.staffId}_${r.date}`, r.isConfirmed ? (r.confirmedBy ?? "") : null);
    return m;
  });
  const [localRows, setLocalRows] = useState<AttendanceRow[]>(rows);

  // 月・スタッフ切替時（router.push）はこのクライアントコンポーネントは再マウントされず
  // useState初期値のみでは新しい rows props に追従しない＝月をまたぐと表示が全滅する。
  // rows/初期confirm状態が変わったら state を追従させる。
  useEffect(() => {
    setLocalRows(rows);
    const m = new Map<string, string | null>();
    for (const r of rows) m.set(`${r.staffId}_${r.date}`, r.isConfirmed ? (r.confirmedBy ?? "") : null);
    setConfirmMap(m);
  }, [rows]);

  // スタッフ別月次サマリー（一覧ビュー用）
  const staffSummaries = useMemo(() => {
    const map = new Map<string, {
      staffId: string; name: string; accountNumber: string | null; section: string | null;
      workingDays: number; totalWorkingMinutes: number; totalOvertimeMinutes: number; errorCount: number;
    }>();
    for (const r of localRows) {
      if (!map.has(r.staffId)) {
        map.set(r.staffId, {
          staffId: r.staffId, name: r.name, accountNumber: r.accountNumber, section: r.section,
          workingDays: 0, totalWorkingMinutes: 0, totalOvertimeMinutes: 0, errorCount: 0,
        });
      }
      const s = map.get(r.staffId)!;
      if (!r.isAbsent && r.clockIn) s.workingDays++;
      s.totalWorkingMinutes  += r.workingMinutes;
      s.totalOvertimeMinutes += r.overtimeMinutes;
      // 問題件数＝打刻漏れ（出勤未・退勤未）のみ。
      // 欠勤・遅刻・早退は理由/承認付きで正しく記録された状態なので問題に含めない
      if (r.status === "no_clockin" || r.status === "no_clockout") s.errorCount++;
    }
    return [...map.values()].sort((a, b) => (a.accountNumber ?? a.staffId).localeCompare(b.accountNumber ?? b.staffId));
  }, [localRows]);

  const filteredSummaries = useMemo(() => {
    if (!search) return staffSummaries;
    const q = search.toLowerCase();
    return staffSummaries.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.staffId.toLowerCase().includes(q) ||
      (s.accountNumber ?? "").includes(q)
    );
  }, [staffSummaries, search]);

  const selectedStaffInfo = useMemo(
    () => staffSummaries.find(s => s.staffId === selectedStaffId) ?? null,
    [staffSummaries, selectedStaffId]
  );

  // 選択スタッフの当月全日カレンダー（公休・希望休・シフト無し日含む）
  const detailCalendar = useMemo((): CalEntry[] => {
    if (!selectedStaffId) return [];
    const [y, mo] = currentMonth.split("-").map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate();
    const rowMap = new Map(
      localRows.filter(r => r.staffId === selectedStaffId).map(r => [r.date, r])
    );
    return Array.from({ length: daysInMonth }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      const date = `${currentMonth}-${d}`;
      const row = rowMap.get(date) ?? null;
      const shiftName = row?.shiftName ?? allShiftMap[`${selectedStaffId}_${date}`] ?? null;
      return { date, row, shiftName };
    });
  }, [localRows, selectedStaffId, currentMonth, allShiftMap]);

  function gotoMonth(m: string, keepStaff = false) {
    const staffParam = keepStaff && selectedStaffId ? `&staffId=${selectedStaffId}` : "";
    if (!keepStaff) setSelectedStaffId(null);
    router.push(`?tab=records&month=${m}${staffParam}`);
  }

  function openEdit(row: AttendanceRow) {
    setEditState({
      row,
      clockIn:       toHHMM(row.clockIn)  === "─" ? "" : toHHMM(row.clockIn),
      clockOut:      toHHMM(row.clockOut) === "─" ? "" : toHHMM(row.clockOut),
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
        clockIn || null, clockOut || null,
        isAbsent, absenceReason, isLate, lateReason,
      );
      if (!res.ok) { showToast(`エラー: ${res.error}`); return; }
      const newClockIn  = clockIn  ? `${row.date}T${clockIn}:00+09:00`  : null;
      const newClockOut = clockOut ? `${row.date}T${clockOut}:00+09:00` : null;
      const breakMins   = row.breakMinutes;
      let workingMinutes = 0, regularMinutes = 0, overtimeMinutes = 0;
      if (newClockIn && newClockOut) {
        const shiftStartISO = row.shiftStart ? `${row.date}T${row.shiftStart.slice(0, 5)}:00+09:00` : null;
        const shiftEndISO   = row.shiftEnd   ? `${row.date}T${row.shiftEnd.slice(0, 5)}:00+09:00`   : null;

        const rawOutMs = new Date(newClockOut).getTime();
        const isOvertimeApproved = !!row.overtimeApprover;

        const effectiveInMs = (!isLate && shiftStartISO)
          ? new Date(shiftStartISO).getTime()
          : new Date(newClockIn).getTime();

        // 残業or早退の申請あり → 実打刻、どちらも申請なし → シフト終了時刻
        const isEarlyLeaveApproved = !!row.earlyLeaveApprover;
        const shiftEndMs = shiftEndISO ? new Date(shiftEndISO).getTime() : rawOutMs;
        const effectiveOutMs = (isOvertimeApproved || isEarlyLeaveApproved || !shiftEndISO)
          ? rawOutMs
          : shiftEndMs;

        workingMinutes  = Math.max(0, Math.round((effectiveOutMs - effectiveInMs) / 60000) - breakMins);
        regularMinutes  = Math.min(workingMinutes, 480);
        overtimeMinutes = Math.max(0, workingMinutes - 480);
      }
      let newStatus: AttendanceRow["status"] = "ok";
      if (isAbsent)         newStatus = "absent";
      else if (!newClockIn)  newStatus = "no_clockin";
      else if (!newClockOut) newStatus = "no_clockout";
      else if (isLate)       newStatus = "late";
      setLocalRows(prev => prev.map(r => {
        if (r.staffId !== row.staffId || r.date !== row.date) return r;
        return { ...r, clockIn: newClockIn, clockOut: newClockOut, isAbsent, absenceReason, isLate, lateReason, workingMinutes, regularMinutes, overtimeMinutes, status: newStatus };
      }));
      setEditState(null);
      showToast("修正しました");
    });
  }

  function handleConfirm(row: AttendanceRow) {
    const key     = `${row.staffId}_${row.date}`;
    const already = confirmMap.get(key) !== null && confirmMap.get(key) !== undefined;
    startTransition(async () => {
      const res = already
        ? await unconfirmAttendanceAction(projectId, row.staffId, row.date)
        : await confirmAttendanceAction(projectId, row.staffId, row.date);
      if (!res.ok) { showToast(`エラー: ${res.error}`); return; }
      setConfirmMap(prev => {
        const next = new Map(prev);
        next.set(key, already ? null : "済");
        return next;
      });
      showToast(already ? "確定を取り消しました" : "確定しました");
    });
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // ── タブ定義 ─────────────────────────────────────────────────────────────
  const TABS: { key: TabKey; label: string; badge?: number }[] = [
    { key: "corrections", label: "勤怠修正",  badge: corrPendingCount > 0 ? corrPendingCount : undefined },
    { key: "requests",    label: "申請一覧" },
    { key: "records",     label: "勤怠実績" },
    { key: "absentees",   label: "欠勤者レポート" },
  ];

  // ── レンダリング ─────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Sticky ヘッダー ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 -mx-4 px-4 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="pt-5 pb-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">勤怠管理</h1>
          <p className="text-sm font-semibold text-zinc-400 mt-0.5">勤怠異常の確認・修正、補正申請の審査、実績出力</p>
        </div>

        {/* タブ */}
        <div className="flex overflow-x-auto mt-2" style={{ scrollbarWidth: "none" }}>
          {TABS.map(t => (
            <button key={t.key} type="button"
              onClick={() => { setActiveTab(t.key); if (t.key !== "records") setSelectedStaffId(null); }}
              className={[
                "flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap",
                activeTab === t.key
                  ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
              ].join(" ")}>
              {t.label}
              {t.badge != null && (
                <span className="bg-red-500 text-white rounded-full px-1.5 text-[10px] tabular-nums">{t.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* 勤怠修正タブ フィルタ */}
        {activeTab === "corrections" && (
          <div className="flex gap-2 flex-wrap py-3 border-t border-zinc-100 dark:border-zinc-800">
            {(["pending", "all", "approved", "rejected"] as CorrFilterKey[]).map(f => (
              <button key={f} type="button" onClick={() => setCorrFilter(f)}
                className={[
                  "text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1",
                  corrFilter === f
                    ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-transparent"
                    : "border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                ].join(" ")}>
                {f === "all" ? "すべて" : CORR_STATUS_LABEL[f]}
                {f === "pending" && corrPendingCount > 0 && (
                  <span className="bg-red-500 text-white rounded-full px-1.5 text-[10px] tabular-nums">{corrPendingCount}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* 申請一覧タブ フィルタ */}
        {activeTab === "requests" && (
          <div className="flex gap-2 flex-wrap py-3 border-t border-zinc-100 dark:border-zinc-800">
            {(["all", "early_leave", "overtime"] as ExcFilterKey[]).map(f => (
              <button key={f} type="button" onClick={() => setExcFilter(f)}
                className={[
                  "text-xs px-3 py-1.5 rounded-full border transition-colors",
                  excFilter === f
                    ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-transparent"
                    : "border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                ].join(" ")}>
                {f === "all" ? "すべて" : f === "early_leave" ? "早退" : "残業"}
              </button>
            ))}
          </div>
        )}

        {/* 勤怠実績タブ コントロール（スタッフ一覧ビュー） */}
        {activeTab === "records" && !selectedStaffId && (
          <div className="py-3 border-t border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => gotoMonth(prevMonth(currentMonth))}
                className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm">◀</button>
              <span className="text-sm font-bold tabular-nums text-zinc-800 dark:text-zinc-100 min-w-[80px] text-center">
                {currentMonth.replace("-", "年")}月
              </span>
              <button type="button" onClick={() => gotoMonth(nextMonth(currentMonth))}
                disabled={nextMonth(currentMonth) > todayMonth}
                className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm disabled:opacity-30">▶</button>
              <input type="search" placeholder="氏名・ID・ACT番号" value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 min-w-32 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="button" onClick={() => setShowExport(true)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                出力
              </button>
            </div>
          </div>
        )}

        {/* 勤怠実績タブ コントロール（スタッフ詳細ビュー） */}
        {activeTab === "records" && selectedStaffId && (
          <div className="py-3 border-t border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setSelectedStaffId(null)}
                className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                一覧へ
              </button>
              <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
                {selectedStaffInfo?.accountNumber && (
                  <span className="text-zinc-400 font-normal mr-1.5">{selectedStaffInfo.accountNumber}</span>
                )}
                {selectedStaffInfo?.name}
              </span>
              <button type="button" onClick={() => gotoMonth(prevMonth(currentMonth), true)}
                className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm">◀</button>
              <span className="text-sm font-bold tabular-nums text-zinc-800 dark:text-zinc-100">{currentMonth.replace("-", "年")}月</span>
              <button type="button" onClick={() => gotoMonth(nextMonth(currentMonth), true)}
                disabled={nextMonth(currentMonth) > todayMonth}
                className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm disabled:opacity-30">▶</button>
              <button type="button" onClick={() => setShowExport(true)}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                出力
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 勤怠修正タブ ─────────────────────────────────────────── */}
      {activeTab === "corrections" && (
        <div className="pt-4">
          {filteredCorr.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-12 text-center text-sm text-zinc-400">
              {corrFilter === "pending" ? "審査待ちの申請はありません" : "申請がありません"}
            </div>
          ) : (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap w-[80px]">操作</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">ステータス</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">申請日時</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">日付</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">ACT#</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap min-w-[90px]">名前</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">シフト</th>
                      <th className="px-2 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">修正出勤</th>
                      <th className="px-2 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">修正退勤</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">SV承認</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 min-w-[160px]">申請理由</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
                    {filteredCorr.map(row => (
                      <tr key={row.id} className={row.status === "pending" ? "bg-yellow-50/40 dark:bg-yellow-950/10" : ""}>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {row.status === "pending" ? (
                            <div className="flex gap-1">
                              <button type="button"
                                onClick={() => { setCorrNote(""); setCorrErrMsg(null); setCorrModal({ row, action: "approve" }); }}
                                className="px-2 py-0.5 rounded-md bg-green-600 hover:bg-green-700 text-white text-[11px] font-semibold">承認</button>
                              <button type="button"
                                onClick={() => { setCorrNote(""); setCorrErrMsg(null); setCorrModal({ row, action: "reject" }); }}
                                className="px-2 py-0.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold">却下</button>
                            </div>
                          ) : row.status === "approved" ? (
                            <button type="button"
                              onClick={() => {
                                startTransition(async () => {
                                  const r = await reapplyCorrectionAction(row.id);
                                  showToast(r.success ? "打刻を再適用しました" : `エラー: ${r.message}`);
                                });
                              }}
                              className="px-2 py-0.5 rounded-md bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-[11px] font-semibold hover:bg-zinc-300 dark:hover:bg-zinc-600">
                              再適用
                            </button>
                          ) : (
                            <span className="text-zinc-300 dark:text-zinc-600">─</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${CORR_STATUS_STYLE[row.status]}`}>
                            {CORR_STATUS_LABEL[row.status]}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-400">{fmtApplied(row.created_at)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-300">{fmtDate(row.target_date)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-400 font-mono">{row.accountNumber ?? "─"}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap font-semibold text-zinc-800 dark:text-zinc-100">{row.staff_name}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-zinc-500">{row.shiftName ?? "─"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-mono whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                          {fmtTime(row.corrected_in)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-mono whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                          {fmtTime(row.corrected_out)}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                          {row.svSigner ?? "─"}
                        </td>
                        <td className="px-2 py-1.5 text-zinc-500 dark:text-zinc-400 max-w-[240px]"
                          title={row.reason + (row.review_note ? `\n（${row.review_note}）` : "")}>
                          <div className="whitespace-pre-wrap break-words text-[11px] leading-relaxed">
                            {row.reason}
                            {row.review_note && (
                              <span className="block text-zinc-400 mt-0.5">（{row.review_note}）</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 申請一覧タブ ─────────────────────────────────────────── */}
      {activeTab === "requests" && (
        <div className="pt-4">
          {filteredExc.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-12 text-center text-sm text-zinc-400">
              申請がありません
            </div>
          ) : (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">日付</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">ACT#</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap min-w-[90px]">名前</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">種別</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap min-w-[80px]">SV署名</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">ステータス</th>
                      <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">申請日時</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
                    {filteredExc.map((row, i) => (
                      <tr key={row.id ?? `${row.staff_id}_${row.shift_date}_${row.request_type}_${i}`}>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-300">{fmtDate(row.shift_date)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-400 font-mono">{row.accountNumber ?? "─"}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap font-semibold text-zinc-800 dark:text-zinc-100">{row.staff_name}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                            row.request_type === "early_leave"
                              ? "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300"
                              : "bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300"
                          }`}>
                            {row.request_type === "early_leave" ? "早退" : "残業"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{row.signer_name ?? "─"}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${CORR_STATUS_STYLE[row.status] ?? ""}`}>
                            {CORR_STATUS_LABEL[row.status] ?? row.status}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-400">{fmtApplied(row.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 勤怠実績タブ（スタッフ一覧） ─────────────────────────── */}
      {activeTab === "records" && !selectedStaffId && (
        <div className="pt-4">
          {filteredSummaries.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-12 text-center text-sm text-zinc-400">
              {search ? "該当なし" : "シフトデータがありません"}
            </div>
          ) : (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                      <th className="px-3 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">ACT#</th>
                      <th className="px-3 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap min-w-[90px]">名前</th>
                      <th className="px-3 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">セクション</th>
                      <th className="px-3 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">出勤日数</th>
                      <th className="px-3 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">稼働時間</th>
                      <th className="px-3 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">残業時間</th>
                      <th className="px-3 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">問題件数</th>
                      <th className="px-3 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
                    {filteredSummaries.map(s => (
                      <tr key={s.staffId}
                        className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                        onClick={() => setSelectedStaffId(s.staffId)}>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-zinc-400 font-mono">{s.accountNumber ?? "─"}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-semibold text-zinc-800 dark:text-zinc-100">{s.name}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{s.section ?? "─"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{s.workingDays}日</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">{fmtHours(s.totalWorkingMinutes)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${s.totalOvertimeMinutes > 0 ? "text-orange-600 dark:text-orange-400" : "text-zinc-400"}`}>
                          {fmtHours(s.totalOvertimeMinutes)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {s.errorCount > 0
                            ? <span className="text-red-600 dark:text-red-400 font-semibold">{s.errorCount}件</span>
                            : <span className="text-zinc-300 dark:text-zinc-600">─</span>
                          }
                        </td>
                        <td className="px-3 py-2 text-zinc-300 dark:text-zinc-600">›</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 勤怠実績タブ（スタッフ詳細） ─────────────────────────── */}
      {activeTab === "records" && selectedStaffId && (
        <div className="pt-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                    <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap w-[80px]">操作</th>
                    <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">日付</th>
                    <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">シフト</th>
                    <th className="px-2 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">出勤</th>
                    <th className="px-2 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">退勤</th>
                    <th className="px-2 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">休憩</th>
                    <th className="px-2 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">稼働</th>
                    <th className="px-2 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">超過</th>
                    <th className="px-2 py-2 text-center font-semibold text-zinc-500 whitespace-nowrap w-[64px]">確定</th>
                    <th className="px-2 py-2 text-left font-semibold text-zinc-500 min-w-[120px]">備考</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
                  {detailCalendar.map(({ date, row, shiftName }) => {
                    const dt  = new Date(date + "T00:00:00Z");
                    const dow = dt.getUTCDay();

                    // シフト無し日 or 公休・希望休など
                    if (!row) {
                      const isOff = shiftName != null; // シフト名はあるが稼働外
                      return (
                        <tr key={date} className={isOff ? "bg-zinc-50/60 dark:bg-zinc-800/20" : "opacity-35"}>
                          <td className="px-2 py-1.5 whitespace-nowrap text-zinc-300 dark:text-zinc-700">─</td>
                          <td className={`px-2 py-1.5 whitespace-nowrap tabular-nums ${dow === 0 ? "text-red-400" : dow === 6 ? "text-blue-400" : "text-zinc-500"}`}>
                            {fmtDate(date)}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-zinc-400 dark:text-zinc-500">
                            {shiftName ?? "─"}
                          </td>
                          <td colSpan={7} className="px-2 py-1.5 text-zinc-300 dark:text-zinc-600">─</td>
                        </tr>
                      );
                    }

                    // シフトあり・稼働日（AttendanceRow）
                    const key = `${row.staffId}_${row.date}`;
                    const isConfirmed = confirmMap.get(key) !== null && confirmMap.get(key) !== undefined;
                    const extractTime = (note: string | null) =>
                      note?.match(/実打刻[:：]\s*(\d{1,2}:\d{2})/)?.[1] ?? null;
                    const extractApprover = (note: string | null) =>
                      note?.match(/承認[:：]\s*([^\]　]+)/)?.[1]?.trim() ?? null;
                    const notes: string[] = [];
                    const inTime  = extractTime(row.clockInNote);
                    const outTime = extractTime(row.clockOutNote);
                    const approver = row.overtimeApprover ?? row.earlyLeaveApprover
                      ?? extractApprover(row.clockOutNote) ?? null;
                    if (inTime)   notes.push(`出勤打刻：${inTime}`);
                    if (outTime)  notes.push(`退勤打刻：${outTime}`);
                    if (approver) notes.push(`残業もしくは早退承認者：${approver}`);
                    if (row.absenceReason) notes.push(row.absenceReason);
                    if (row.lateReason)    notes.push(row.lateReason);
                    if (row.modifiedBy)    notes.push(`修正者:${row.modifiedBy}`);
                    return (
                      <tr key={key} className={STATUS_STYLE[row.status]}>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <button type="button" onClick={() => openEdit(row)}
                            className="px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[11px] font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                            修正
                          </button>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-300">
                          {fmtDate(row.date)}
                          {row.status !== "ok" && (
                            <span className={`ml-1 text-[10px] ${STATUS_TEXT[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-zinc-500">{row.shiftName}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-mono whitespace-nowrap text-zinc-700 dark:text-zinc-300">{toHHMM(row.clockIn)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-mono whitespace-nowrap text-zinc-700 dark:text-zinc-300">{toHHMM(row.clockOut)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-zinc-500">{row.breakMinutes > 0 ? fmtHours(row.breakMinutes) : "─"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap text-zinc-700 dark:text-zinc-200">{fmtHours(row.workingMinutes)}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap ${row.overtimeMinutes > 0 ? "text-orange-600 dark:text-orange-400" : "text-zinc-400"}`}>
                          {fmtHours(row.overtimeMinutes)}
                        </td>
                        <td className="px-2 py-1.5 text-center whitespace-nowrap">
                          <button type="button" onClick={() => handleConfirm(row)}
                            className={[
                              "text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors",
                              isConfirmed
                                ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700",
                            ].join(" ")}>
                            {isConfirmed ? "確定済" : "確定"}
                          </button>
                        </td>
                        <td className="px-2 py-1.5 text-zinc-400 dark:text-zinc-500 max-w-[200px] truncate">
                          {notes.join("　")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                    <td colSpan={6} className="px-2 py-2 text-xs font-semibold text-zinc-500">月計</td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold text-zinc-800 dark:text-zinc-100">
                      {fmtHours(detailCalendar.filter(e => e.row).reduce((s, e) => s + e.row!.workingMinutes, 0))}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold text-orange-600 dark:text-orange-400">
                      {fmtHours(detailCalendar.filter(e => e.row).reduce((s, e) => s + e.row!.overtimeMinutes, 0))}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── 欠勤者レポートタブ ──────────────────────────────────── */}
      {activeTab === "absentees" && (
        <AbsenteeReportClient projectId={projectId} />
      )}

      {/* ── 勤怠修正 承認/却下モーダル ───────────────────────────── */}
      {corrModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setCorrModal(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-sm w-full p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className={`text-base font-bold mb-3 ${corrModal.action === "approve" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
              {corrModal.action === "approve" ? "承認しますか？" : "却下しますか？"}
            </h2>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-3">
              {corrModal.row.staff_name} / {fmtDate(corrModal.row.target_date)}<br />
              <span className="text-xs font-mono text-zinc-500">
                {corrModal.row.corrected_in ?? "--:--"} → {corrModal.row.corrected_out ?? "--:--"}
              </span>
            </p>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">コメント（任意）</label>
            <textarea value={corrNote} onChange={e => setCorrNote(e.target.value)}
              rows={2} className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm resize-none mb-3" />
            {corrErrMsg && <p className="text-sm text-red-600 mb-2">{corrErrMsg}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setCorrModal(null)}
                className="flex-1 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm">キャンセル</button>
              <button type="button" onClick={handleCorrReview} disabled={isPending}
                className={`flex-1 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50 ${corrModal.action === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}>
                {isPending ? "処理中..." : corrModal.action === "approve" ? "承認する" : "却下する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 打刻修正モーダル ─────────────────────────────────────── */}
      {editState && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl shadow-xl overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-xs text-zinc-400">{fmtDate(editState.row.date)}　{editState.row.shiftName}</p>
              <p className="font-bold text-lg text-zinc-900 dark:text-zinc-50 mt-0.5">
                {editState.row.accountNumber && (
                  <span className="text-zinc-400 font-normal text-sm mr-1">{editState.row.accountNumber}</span>
                )}
                {editState.row.name}
              </p>
              {(editState.row.shiftStart || editState.row.shiftEnd) && (
                <p className="text-xs text-zinc-400 mt-0.5">
                  予定: {editState.row.shiftStart ?? "─"} 〜 {editState.row.shiftEnd ?? "─"}
                </p>
              )}
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500">出勤打刻</span>
                  <input type="time" value={editState.clockIn}
                    onChange={e => setEditState(s => s ? { ...s, clockIn: e.target.value } : s)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {editState.clockIn && (
                    <button onClick={() => setEditState(s => s ? { ...s, clockIn: "" } : s)}
                      className="text-xs text-red-400 hover:text-red-600">削除</button>
                  )}
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500">退勤打刻</span>
                  <input type="time" value={editState.clockOut}
                    onChange={e => setEditState(s => s ? { ...s, clockOut: e.target.value } : s)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {editState.clockOut && (
                    <button onClick={() => setEditState(s => s ? { ...s, clockOut: "" } : s)}
                      className="text-xs text-red-400 hover:text-red-600">削除</button>
                  )}
                </label>
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editState.isAbsent}
                    onChange={e => setEditState(s => s ? { ...s, isAbsent: e.target.checked } : s)}
                    className="w-4 h-4 rounded accent-red-500" />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">欠勤</span>
                </label>
                {editState.isAbsent && (
                  <input type="text" placeholder="欠勤理由（任意）" value={editState.absenceReason}
                    onChange={e => setEditState(s => s ? { ...s, absenceReason: e.target.value } : s)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                )}
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editState.isLate}
                    onChange={e => setEditState(s => s ? { ...s, isLate: e.target.checked } : s)}
                    className="w-4 h-4 rounded accent-yellow-500" />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">遅刻</span>
                </label>
                {editState.isLate && (
                  <input type="text" placeholder="遅刻理由（任意）" value={editState.lateReason}
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

      {/* 実績出力モーダル */}
      {showExport && (
        <ExportModal projectId={projectId} staffs={staffs} onClose={() => setShowExport(false)} />
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
