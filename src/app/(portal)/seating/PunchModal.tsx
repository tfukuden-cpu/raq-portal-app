"use client";

import { useState, useEffect, useTransition } from "react";
import {
  getStaffPunchSummaryAction,
  clockInAction,
  clockOutAction,
  earlyLeaveAction,
  seatLeaveAction,
  seatReturnAction,
  breakStartAction,
  breakEndAction,
  breakResetAction,
  updatePunchLogTimeAction,
  deletePunchLogAction,
  type StaffPunchSummary,
  type BreakRecord,
  type ClockOutJudgment,
} from "./punch-actions";

function judgeClockOut(nowISO: string, shiftEndHHMM: string, today: string): ClockOutJudgment {
  const [hh, mm] = shiftEndHHMM.split(":").map(Number);
  const shiftEnd = new Date(`${today}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00+09:00`);
  const diffMin = (shiftEnd.getTime() - new Date(nowISO).getTime()) / 60000;
  if (diffMin > 10) return "early_leave";
  if (diffMin >= 0) return "on_time";
  return "overtime_choice";
}

// ── Props ──────────────────────────────────────────────────
interface PunchModalProps {
  projectId: string;
  staffId: string;
  staffName: string;
  shiftStart: string | null; // "HH:MM"
  shiftEnd:   string | null; // "HH:MM"
  today: string;             // "YYYY-MM-DD"
  isAdmin: boolean;
  showBreakEdit?: boolean;   // 管理者の当日状況座席表のみtrue
  onClose: () => void;
  onStatusChange: (staffId: string, status: string) => void;
}

// ── 経過時間フォーマット ───────────────────────────────────
function fmtElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}分${String(s).padStart(2, "0")}秒`;
}

function fmtTime(isoStr: string | null): string {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

type Step =
  | "loading"
  | "main"
  | "clock_out_confirm"   // 退勤確認（早退/定時/残業の分岐）
  | "early_leave_sv"      // 早退：SV署名
  | "overtime_choice"     // 残業：定時 or 残業選択
  | "overtime_sv"         // 残業：SV署名
  | "done";

export default function PunchModal({
  projectId, staffId, staffName, shiftStart, shiftEnd, today,
  isAdmin, showBreakEdit = false, onClose, onStatusChange,
}: PunchModalProps) {
  const [step, setStep]           = useState<Step>("loading");
  const [summary, setSummary]     = useState<StaffPunchSummary | null>(null);
  const [judgment, setJudgment]   = useState<ClockOutJudgment | null>(null);
  const [svName, setSvName]       = useState("");
  const [reason, setReason]       = useState("");
  const [elapsedSec, setElapsed]  = useState(0);
  const [limitMin, setLimitMin]   = useState(60);
  const [toast, setToast]         = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 休憩時間編集
  const [editingBreak, setEditingBreak] = useState<{
    record: BreakRecord;
    field: "start" | "end";
    value: string;
  } | null>(null);

  // ── 初回ロード ─────────────────────────────────────────
  useEffect(() => {
    getStaffPunchSummaryAction(projectId, staffId).then(s => {
      setSummary(s);
      setStep("main");
    });
  }, [projectId, staffId]);

  // ── タイマー（休憩中 / 離席中） ───────────────────────
  useEffect(() => {
    if (!summary) return;
    const startISO = summary.breakStartTime ?? summary.seatLeaveTime;
    if (!startISO) { setElapsed(0); return; }
    const base = new Date(startISO).getTime();
    setElapsed(Math.floor((Date.now() - base) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - base) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [summary]);

  // ── 超過アラート判定 ─────────────────────────────────
  const isOverLimit = summary?.isOnBreak && elapsedSec > limitMin * 60;

  // ── 操作後リフレッシュ ────────────────────────────────
  async function refresh() {
    const s = await getStaffPunchSummaryAction(projectId, staffId);
    setSummary(s);
    setStep("main");
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // ── アクション ────────────────────────────────────────
  function handleClockIn() {
    startTransition(async () => {
      const res = await clockInAction(projectId, staffId, shiftStart);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "working");
      showToast("出勤打刻しました");
      await refresh();
    });
  }

  function handleClockOutInit() {
    const nowISO = new Date().toISOString();
    const j = shiftEnd ? judgeClockOut(nowISO, shiftEnd, today) : "overtime_choice";
    setJudgment(j);
    if (j === "on_time") {
      // 10分前〜定時：自動で定時退勤
      startTransition(async () => {
        const res = await clockOutAction(projectId, staffId, shiftEnd, "on_time");
        if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
        onStatusChange(staffId, "clocked_out");
        showToast("退勤しました（定時）");
        setStep("done");
      });
    } else {
      setStep("clock_out_confirm");
    }
  }

  function handleEarlyLeaveSubmit() {
    if (!svName.trim()) { showToast("SV名を入力してください"); return; }
    startTransition(async () => {
      const res = await earlyLeaveAction(projectId, staffId, shiftEnd ?? "00:00", svName.trim(), reason || undefined);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "clocked_out");
      showToast("早退申請を送信しました");
      setStep("done");
    });
  }

  function handleOvertimeOnTime() {
    startTransition(async () => {
      const res = await clockOutAction(projectId, staffId, shiftEnd, "on_time");
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "clocked_out");
      showToast("退勤しました（定時）");
      setStep("done");
    });
  }

  function handleOvertimeSubmit() {
    if (!svName.trim()) { showToast("SV名を入力してください"); return; }
    startTransition(async () => {
      const res = await clockOutAction(projectId, staffId, shiftEnd, "overtime", svName.trim(), reason || undefined);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "clocked_out");
      showToast("残業申請を送信しました");
      setStep("done");
    });
  }

  function handleSeatLeave() {
    startTransition(async () => {
      const res = await seatLeaveAction(projectId, staffId);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "working");
      showToast("離席しました");
      await refresh();
    });
  }

  function handleSeatReturn() {
    startTransition(async () => {
      const res = await seatReturnAction(projectId, staffId);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "working");
      showToast("着席しました");
      await refresh();
    });
  }

  function handleBreakStart() {
    startTransition(async () => {
      const res = await breakStartAction(projectId, staffId);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      if (res.limitMinutes) setLimitMin(res.limitMinutes);
      onStatusChange(staffId, "on_break");
      showToast(res.breakType === "regular" ? "休憩開始（60分）" : "小休憩開始（15分）");
      await refresh();
    });
  }

  function handleBreakEnd() {
    startTransition(async () => {
      const res = await breakEndAction(projectId, staffId);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "working");
      showToast("休憩終了");
      await refresh();
    });
  }

  function handleBreakReset() {
    if (!confirm("進行中の休憩をキャンセルしますか？")) return;
    startTransition(async () => {
      const res = await breakResetAction(projectId, staffId);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "working");
      showToast("休憩をリセットしました");
      await refresh();
    });
  }

  // ── 休憩時間編集 ──────────────────────────────────────
  function handleBreakEditSave() {
    if (!editingBreak) return;
    const { record, field, value } = editingBreak;
    if (!value) return;
    const id = field === "start" ? record.startId : record.endId;
    if (!id) return;
    startTransition(async () => {
      const res = await updatePunchLogTimeAction(id, value);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      showToast("時刻を更新しました");
      setEditingBreak(null);
      await refresh();
    });
  }

  function handleBreakDelete(record: BreakRecord) {
    if (!confirm("この休憩記録を削除しますか？")) return;
    startTransition(async () => {
      // 終了レコードがあれば先に削除
      if (record.endId) await deletePunchLogAction(record.endId);
      const res = await deletePunchLogAction(record.startId);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      showToast("休憩記録を削除しました");
      await refresh();
    });
  }

  // ── レンダリング ──────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="px-5 pt-5 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">{staffName}</p>
            {summary && (
              <p className="text-xs text-zinc-400 mt-0.5 tabular-nums">
                {shiftStart && `${shiftStart}〜${shiftEnd ?? "?"}`}
                {summary.clockIn && ` ／ 出勤 ${fmtTime(summary.clockIn)}`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-zinc-600 text-sm"
          >✕</button>
        </div>

        {/* コンテンツ */}
        <div className="px-5 py-4">

          {/* ローディング */}
          {step === "loading" && (
            <div className="flex items-center justify-center py-6">
              <div className="w-6 h-6 border-2 border-zinc-200 border-t-blue-500 rounded-full animate-spin" />
            </div>
          )}

          {/* 完了 */}
          {step === "done" && (
            <div className="text-center py-4">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">完了しました</p>
              <button onClick={onClose} className="mt-3 text-xs text-blue-600 dark:text-blue-400 underline">閉じる</button>
            </div>
          )}

          {/* ── メイン操作画面 ── */}
          {step === "main" && summary && (
            <div className="space-y-3">

              {/* タイマー表示（休憩中 / 離席中） */}
              {(summary.isOnBreak || summary.isOnSeatLeave) && (
                <div className={[
                  "rounded-xl px-4 py-2.5 text-center tabular-nums",
                  isOverLimit
                    ? "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"
                    : "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300",
                ].join(" ")}>
                  <p className="text-xs font-semibold mb-0.5">
                    {summary.isOnBreak ? (summary.breakCount === 1 ? "休憩中" : "小休憩中") : "離席中"}
                    {isOverLimit && " ⚠️ 超過"}
                  </p>
                  <p className="text-lg font-bold leading-none">{fmtElapsed(elapsedSec)}</p>
                  {summary.isOnBreak && (
                    <p className="text-[10px] mt-0.5 opacity-70">規定 {limitMin}分</p>
                  )}
                </div>
              )}

              {/* 未出勤 */}
              {summary.derivedStatus === "not_arrived" && (
                <Btn label="出勤" color="green" onClick={handleClockIn} disabled={isPending} />
              )}

              {/* 在席 */}
              {summary.derivedStatus === "working" && (
                <>
                  <Btn label="離席" color="zinc" onClick={handleSeatLeave} disabled={isPending} />
                  <Btn
                    label={summary.breakCount === 0 ? "休憩（60分）" : "小休憩（15分）"}
                    color="amber" onClick={handleBreakStart} disabled={isPending}
                  />
                  <Btn label="退勤" color="red" onClick={handleClockOutInit} disabled={isPending} />
                </>
              )}

              {/* 離席中 */}
              {summary.derivedStatus === "seat_leave" && (
                <>
                  <Btn label="着席戻り" color="blue" onClick={handleSeatReturn} disabled={isPending} />
                  <Btn label="退勤" color="red" onClick={handleClockOutInit} disabled={isPending} />
                </>
              )}

              {/* 休憩中 */}
              {summary.derivedStatus === "on_break" && (
                <>
                  <Btn label="休憩戻り" color="blue" onClick={handleBreakEnd} disabled={isPending} />
                  <Btn label="休憩リセット" color="zinc" onClick={handleBreakReset} disabled={isPending} />
                </>
              )}

              {/* 退勤済 */}
              {summary.derivedStatus === "clocked_out" && (
                <p className="text-center text-sm text-zinc-400 py-2">
                  退勤済（{fmtTime(summary.clockOut)}）
                </p>
              )}

              {/* 休憩記録（管理者・showBreakEdit時のみ） */}
              {showBreakEdit && summary.breakRecords.length > 0 && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 mt-1">
                  <p className="text-xs font-semibold text-zinc-400 mb-2">休憩記録</p>
                  <div className="space-y-2">
                    {summary.breakRecords.map((rec, i) => (
                      <div key={rec.startId} className="flex items-center gap-1.5 text-xs">
                        <span className="text-zinc-400 w-4 shrink-0">{i + 1}</span>
                        {/* 開始時刻 */}
                        <button
                          type="button"
                          onClick={() => setEditingBreak({ record: rec, field: "start", value: fmtTime(rec.startTime) })}
                          className="tabular-nums font-mono bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        >
                          {fmtTime(rec.startTime)}
                        </button>
                        <span className="text-zinc-400">〜</span>
                        {/* 終了時刻 */}
                        {rec.endId ? (
                          <button
                            type="button"
                            onClick={() => setEditingBreak({ record: rec, field: "end", value: fmtTime(rec.endTime!) })}
                            className="tabular-nums font-mono bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                          >
                            {fmtTime(rec.endTime)}
                          </button>
                        ) : (
                          <span className="text-amber-500 font-semibold tabular-nums">進行中</span>
                        )}
                        {/* 経過時間 */}
                        {rec.endTime && (
                          <span className="text-zinc-400 ml-1">
                            {Math.round((new Date(rec.endTime).getTime() - new Date(rec.startTime).getTime()) / 60000)}分
                          </span>
                        )}
                        {/* 削除 */}
                        <button
                          type="button"
                          onClick={() => handleBreakDelete(rec)}
                          className="ml-auto text-zinc-300 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-1.5">時刻をタップして編集</p>
                </div>
              )}
            </div>
          )}

          {/* ── 退勤確認（早退 / 残業） ── */}
          {step === "clock_out_confirm" && (
            <div className="space-y-3">
              {judgment === "early_leave" && (
                <>
                  <p className="text-sm text-red-600 dark:text-red-400 font-semibold">早退扱いになります</p>
                  <p className="text-xs text-zinc-500">終了時刻より10分以上前のため、SV承認が必要です。</p>
                  <Btn label="早退申請へ" color="red" onClick={() => setStep("early_leave_sv")} />
                </>
              )}
              {judgment === "overtime_choice" && (
                <>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 font-semibold">退勤区分を選択</p>
                  <Btn label="定時（終了時刻に補正）" color="green" onClick={handleOvertimeOnTime} disabled={isPending} />
                  <Btn label="残業申請" color="amber" onClick={() => setStep("overtime_sv")} />
                </>
              )}
              <button onClick={() => setStep("main")} className="w-full text-xs text-zinc-400 hover:text-zinc-600 py-1">戻る</button>
            </div>
          )}

          {/* ── 早退：SV署名 ── */}
          {step === "early_leave_sv" && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">SV名を記入してください</p>
              <input
                type="text" placeholder="SV名（フルネーム）"
                value={svName} onChange={e => setSvName(e.target.value)}
                className="w-full text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400 dark:text-zinc-100"
              />
              <input
                type="text" placeholder="理由（任意）"
                value={reason} onChange={e => setReason(e.target.value)}
                className="w-full text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:text-zinc-100"
              />
              <Btn label="早退申請を送信" color="red" onClick={handleEarlyLeaveSubmit} disabled={isPending || !svName.trim()} />
              <button onClick={() => setStep("clock_out_confirm")} className="w-full text-xs text-zinc-400 hover:text-zinc-600 py-1">戻る</button>
            </div>
          )}

          {/* ── 残業：SV署名 ── */}
          {step === "overtime_sv" && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">SV名を記入してください</p>
              <input
                type="text" placeholder="SV名（フルネーム）"
                value={svName} onChange={e => setSvName(e.target.value)}
                className="w-full text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:text-zinc-100"
              />
              <input
                type="text" placeholder="残業理由（任意）"
                value={reason} onChange={e => setReason(e.target.value)}
                className="w-full text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:text-zinc-100"
              />
              <Btn label="残業申請を送信" color="amber" onClick={handleOvertimeSubmit} disabled={isPending || !svName.trim()} />
              <button onClick={() => setStep("clock_out_confirm")} className="w-full text-xs text-zinc-400 hover:text-zinc-600 py-1">戻る</button>
            </div>
          )}

        </div>

        {/* 休憩時刻編集インラインフォーム */}
        {editingBreak && (
          <div className="px-5 pb-4 border-t border-zinc-100 dark:border-zinc-800">
            <p className="text-xs font-semibold text-zinc-500 mt-3 mb-2">
              {editingBreak.field === "start" ? "開始時刻" : "終了時刻"}を編集
            </p>
            <div className="flex gap-2 items-center">
              <input
                type="time"
                value={editingBreak.value}
                onChange={e => setEditingBreak(prev => prev ? { ...prev, value: e.target.value } : null)}
                className="flex-1 text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:text-zinc-100 tabular-nums"
              />
              <button
                type="button"
                onClick={handleBreakEditSave}
                disabled={isPending}
                className="px-3 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-500 disabled:opacity-50"
              >保存</button>
              <button
                type="button"
                onClick={() => setEditingBreak(null)}
                className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs rounded-xl hover:bg-zinc-200"
              >キャンセル</button>
            </div>
          </div>
        )}

        {/* トースト */}
        {toast && (
          <div className="px-5 pb-4">
            <p className={`text-center text-xs font-semibold py-2 rounded-lg ${
              toast.startsWith("⚠️")
                ? "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"
                : "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300"
            }`}>{toast}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ボタンコンポーネント ──────────────────────────────────
const COLOR_MAP = {
  green: "bg-green-600 hover:bg-green-500 text-white",
  blue:  "bg-blue-600 hover:bg-blue-500 text-white",
  amber: "bg-amber-500 hover:bg-amber-400 text-white",
  red:   "bg-red-500 hover:bg-red-400 text-white",
  zinc:  "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200",
};

function Btn({ label, color, onClick, disabled }: {
  label: string;
  color: keyof typeof COLOR_MAP;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "w-full py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50",
        COLOR_MAP[color],
      ].join(" ")}
    >
      {label}
    </button>
  );
}
