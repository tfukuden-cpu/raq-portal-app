"use client";

import { useState, useEffect, useTransition } from "react";
import {
  getStaffPunchSummaryAction,
  getBreakDurationAction,
  setBreakDurationAction,
  clockInAction,
  clockOutAction,
  earlyLeaveAction,
  seatLeaveAction,
  seatReturnAction,
  breakStartAction,
  breakEndAction,
  breakResetAction,
  type StaffPunchSummary,
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
  shiftStart: string | null;
  shiftEnd:   string | null;
  today: string;
  isAdmin: boolean;
  showBreakEdit?: boolean;   // 管理者当日状況座席表のみ true
  onClose: () => void;
  onStatusChange: (staffId: string, status: string) => void;
}

// ── ユーティリティ ────────────────────────────────────────
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
  | "clock_out_confirm"
  | "early_leave_sv"
  | "overtime_choice"
  | "overtime_sv"
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
  const [toast, setToast]         = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 休憩持ち時間
  const [breakDuration, setBreakDuration] = useState<{ regular: number; short: number }>({ regular: 60, short: 15 });
  const [isDurationEdit, setIsDurationEdit] = useState(false);
  const [draftRegular, setDraftRegular] = useState(60);
  const [draftShort,   setDraftShort]   = useState(15);

  // ── 初回ロード ─────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      getStaffPunchSummaryAction(projectId, staffId),
      getBreakDurationAction(projectId, staffId, today),
    ]).then(([s, d]) => {
      setSummary(s);
      setBreakDuration({ regular: d.regularMinutes, short: d.shortMinutes });
      setDraftRegular(d.regularMinutes);
      setDraftShort(d.shortMinutes);
      setStep("main");
    });
  }, [projectId, staffId, today]);

  // ── タイマー ───────────────────────────────────────────
  useEffect(() => {
    if (!summary) return;
    const startISO = summary.breakStartTime ?? summary.seatLeaveTime;
    if (!startISO) { setElapsed(0); return; }
    const base = new Date(startISO).getTime();
    setElapsed(Math.floor((Date.now() - base) / 1000));
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - base) / 1000)), 1000);
    return () => clearInterval(id);
  }, [summary]);

  // ── 現在の休憩限度（1回目=regular、2回目以降=short） ──
  const limitMin = summary
    ? (summary.breakCount <= 1 ? breakDuration.regular : breakDuration.short)
    : 60;
  const isOverLimit = summary?.isOnBreak && elapsedSec > limitMin * 60;

  // ── リフレッシュ ──────────────────────────────────────
  async function refresh() {
    const [s, d] = await Promise.all([
      getStaffPunchSummaryAction(projectId, staffId),
      getBreakDurationAction(projectId, staffId, today),
    ]);
    setSummary(s);
    setBreakDuration({ regular: d.regularMinutes, short: d.shortMinutes });
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
      const isFirst = (summary?.breakCount ?? 0) === 0;
      onStatusChange(staffId, "on_break");
      showToast(isFirst ? `休憩開始（${breakDuration.regular}分）` : `小休憩開始（${breakDuration.short}分）`);
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

  function handleDurationSave() {
    if (draftRegular < 1 || draftShort < 1) { showToast("1分以上で入力してください"); return; }
    startTransition(async () => {
      const res = await setBreakDurationAction(projectId, staffId, draftRegular, draftShort, today);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      setBreakDuration({ regular: draftRegular, short: draftShort });
      setIsDurationEdit(false);
      showToast("休憩時間を設定しました");
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
        <div className="px-5 py-4 space-y-3">

          {step === "loading" && (
            <div className="flex items-center justify-center py-6">
              <div className="w-6 h-6 border-2 border-zinc-200 border-t-blue-500 rounded-full animate-spin" />
            </div>
          )}

          {step === "done" && (
            <div className="text-center py-4">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">完了しました</p>
              <button onClick={onClose} className="mt-3 text-xs text-blue-600 dark:text-blue-400 underline">閉じる</button>
            </div>
          )}

          {/* ── メイン ── */}
          {step === "main" && summary && (
            <>
              {/* 休憩持ち時間（管理者のみ表示・編集） */}
              {showBreakEdit && (
                <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl px-3 py-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-zinc-500">休憩時間の設定</span>
                    {!isDurationEdit ? (
                      <button
                        type="button"
                        onClick={() => { setDraftRegular(breakDuration.regular); setDraftShort(breakDuration.short); setIsDurationEdit(true); }}
                        className="text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        title="編集"
                      >
                        <PencilIcon />
                      </button>
                    ) : (
                      <div className="flex gap-1">
                        <button type="button" onClick={handleDurationSave} disabled={isPending}
                          className="text-[11px] font-bold px-2 py-0.5 bg-blue-600 text-white rounded-lg disabled:opacity-50">
                          保存
                        </button>
                        <button type="button" onClick={() => setIsDurationEdit(false)}
                          className="text-[11px] text-zinc-400 hover:text-zinc-600 px-1">
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                  {!isDurationEdit ? (
                    <div className="flex gap-4 text-xs tabular-nums">
                      <span className="text-zinc-600 dark:text-zinc-300">
                        休憩（1回目）<span className="font-bold text-zinc-900 dark:text-zinc-100 ml-1">{breakDuration.regular}分</span>
                      </span>
                      <span className="text-zinc-600 dark:text-zinc-300">
                        小休憩（2回目〜）<span className="font-bold text-zinc-900 dark:text-zinc-100 ml-1">{breakDuration.short}分</span>
                      </span>
                    </div>
                  ) : (
                    <div className="flex gap-3 items-center text-xs">
                      <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
                        休憩
                        <input
                          type="number" min={1} max={180} value={draftRegular}
                          onChange={e => setDraftRegular(Number(e.target.value))}
                          className="w-14 text-center font-bold bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400 tabular-nums"
                        />
                        分
                      </label>
                      <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
                        小休憩
                        <input
                          type="number" min={1} max={60} value={draftShort}
                          onChange={e => setDraftShort(Number(e.target.value))}
                          className="w-14 text-center font-bold bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400 tabular-nums"
                        />
                        分
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* タイマー（休憩中 / 離席中） */}
              {(summary.isOnBreak || summary.isOnSeatLeave) && (
                <div className={[
                  "rounded-xl px-4 py-2.5 text-center tabular-nums",
                  isOverLimit
                    ? "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"
                    : "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300",
                ].join(" ")}>
                  <p className="text-xs font-semibold mb-0.5">
                    {summary.isOnBreak
                      ? (summary.breakCount === 1 ? `休憩中（${limitMin}分）` : `小休憩中（${limitMin}分）`)
                      : "離席中"}
                    {isOverLimit && " ⚠️ 超過"}
                  </p>
                  <p className="text-2xl font-bold leading-none">{fmtElapsed(elapsedSec)}</p>
                  {summary.isOnBreak && (
                    <p className="text-[11px] mt-1 opacity-70">
                      残り {Math.max(0, limitMin * 60 - elapsedSec) > 0
                        ? fmtElapsed(Math.max(0, limitMin * 60 - elapsedSec))
                        : "超過中"}
                    </p>
                  )}
                </div>
              )}

              {/* 操作ボタン */}
              {summary.derivedStatus === "not_arrived" && (
                <Btn label="出勤" color="green" onClick={handleClockIn} disabled={isPending} />
              )}
              {summary.derivedStatus === "working" && (
                <>
                  <Btn label="離席" color="zinc" onClick={handleSeatLeave} disabled={isPending} />
                  <Btn
                    label={summary.breakCount === 0
                      ? `休憩（${breakDuration.regular}分）`
                      : `小休憩（${breakDuration.short}分）`}
                    color="amber" onClick={handleBreakStart} disabled={isPending}
                  />
                  <Btn label="退勤" color="red" onClick={handleClockOutInit} disabled={isPending} />
                </>
              )}
              {summary.derivedStatus === "seat_leave" && (
                <>
                  <Btn label="着席戻り" color="blue" onClick={handleSeatReturn} disabled={isPending} />
                  <Btn label="退勤" color="red" onClick={handleClockOutInit} disabled={isPending} />
                </>
              )}
              {summary.derivedStatus === "on_break" && (
                <>
                  <Btn label="休憩戻り" color="blue" onClick={handleBreakEnd} disabled={isPending} />
                  <Btn label="休憩リセット" color="zinc" onClick={handleBreakReset} disabled={isPending} />
                </>
              )}
              {summary.derivedStatus === "clocked_out" && (
                <p className="text-center text-sm text-zinc-400 py-2">
                  退勤済（{fmtTime(summary.clockOut)}）
                </p>
              )}
            </>
          )}

          {/* ── 退勤確認 ── */}
          {step === "clock_out_confirm" && (
            <>
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
            </>
          )}

          {/* ── 早退：SV署名 ── */}
          {step === "early_leave_sv" && (
            <>
              <p className="text-xs text-zinc-500">SV名を記入してください</p>
              <input type="text" placeholder="SV名" value={svName} onChange={e => setSvName(e.target.value)}
                className="w-full text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400 dark:text-zinc-100" />
              <input type="text" placeholder="理由（任意）" value={reason} onChange={e => setReason(e.target.value)}
                className="w-full text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:text-zinc-100" />
              <Btn label="早退申請を送信" color="red" onClick={handleEarlyLeaveSubmit} disabled={isPending || !svName.trim()} />
              <button onClick={() => setStep("clock_out_confirm")} className="w-full text-xs text-zinc-400 hover:text-zinc-600 py-1">戻る</button>
            </>
          )}

          {/* ── 残業：SV署名 ── */}
          {step === "overtime_sv" && (
            <>
              <p className="text-xs text-zinc-500">SV名を記入してください</p>
              <input type="text" placeholder="SV名" value={svName} onChange={e => setSvName(e.target.value)}
                className="w-full text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:text-zinc-100" />
              <input type="text" placeholder="残業理由（任意）" value={reason} onChange={e => setReason(e.target.value)}
                className="w-full text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:text-zinc-100" />
              <Btn label="残業申請を送信" color="amber" onClick={handleOvertimeSubmit} disabled={isPending || !svName.trim()} />
              <button onClick={() => setStep("clock_out_confirm")} className="w-full text-xs text-zinc-400 hover:text-zinc-600 py-1">戻る</button>
            </>
          )}

          {/* トースト */}
          {toast && (
            <p className={`text-center text-xs font-semibold py-2 rounded-lg ${
              toast.startsWith("⚠️")
                ? "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"
                : "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300"
            }`}>{toast}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ボタン ────────────────────────────────────────────────
const COLOR_MAP = {
  green: "bg-green-600 hover:bg-green-500 text-white",
  blue:  "bg-blue-600 hover:bg-blue-500 text-white",
  amber: "bg-amber-500 hover:bg-amber-400 text-white",
  red:   "bg-red-500 hover:bg-red-400 text-white",
  zinc:  "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200",
};
function Btn({ label, color, onClick, disabled }: {
  label: string; color: keyof typeof COLOR_MAP; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 ${COLOR_MAP[color]}`}>
      {label}
    </button>
  );
}

// ── 鉛筆アイコン ──────────────────────────────────────────
function PencilIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}
