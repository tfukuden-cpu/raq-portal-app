"use client";

import { useState, useEffect, useTransition } from "react";
import {
  getStaffPunchSummaryAction,
  getBreakDurationAction,
  getBreakSlotAssignmentAction,
  setBreakDurationAction,
  setBreakSlotAction,
  clockInAction,
  clockOutAction,
  seatLeaveAction,
  seatReturnAction,
  breakStartAction,
  breakEndAction,
  breakResetAction,
  type StaffPunchSummary,
} from "./punch-actions";
import type { BreakSlotSetting } from "./break-actions";


function fmtElapsed(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}分${String(s).padStart(2,"0")}秒`;
}
function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

const STATUS_BADGE: Record<string, string> = {
  not_arrived: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500",
  working:     "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  on_break:    "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  seat_leave:  "bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300",
  clocked_out: "bg-zinc-200 dark:bg-zinc-600 text-zinc-500",
  absent:      "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300",
};
const STATUS_LABEL_MAP: Record<string, string> = {
  not_arrived: "未出勤", working: "勤務中", on_break: "休憩中",
  seat_leave: "離席中", clocked_out: "退勤済", absent: "欠勤",
};
const SLOT_LABEL: Record<number, string> = { 1: "①", 2: "②", 3: "③" };

// ── Props ──────────────────────────────────────────────────
interface PunchModalProps {
  projectId: string;
  staffId: string;
  staffName: string;
  accountNumber: string | null;
  section: string | null;
  shiftName: string | null;
  shiftStart: string | null;
  shiftEnd:   string | null;
  today: string;
  isAdmin: boolean;
  showBreakEdit?: boolean;
  breakSlotNumber?: number | null;
  breakSlots?: BreakSlotSetting[];
  motaSlot?: string | null;
  onClose: () => void;
  onStatusChange: (staffId: string, status: string) => void;
}

type Step = "loading" | "main" | "clock_out_confirm" | "early_leave_sv" | "overtime_sv" | "done";

export default function PunchModal({
  projectId, staffId, staffName, accountNumber, section, shiftName,
  shiftStart, shiftEnd, today, isAdmin, showBreakEdit = false,
  breakSlotNumber: initSlotNumber = null,
  breakSlots = [], motaSlot = null,
  onClose, onStatusChange,
}: PunchModalProps) {
  const [step, setStep]         = useState<Step>("loading");
  const [summary, setSummary]   = useState<StaffPunchSummary | null>(null);
  const [svName, setSvName]     = useState("");
  const [reason, setReason]     = useState("");
  const [elapsedSec, setElapsed] = useState(0);
  const [toast, setToast]       = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 休憩時間設定
  const [breakDuration, setBreakDuration] = useState({ regular: 60, short: 15 });
  const [draftRegular, setDraftRegular]   = useState(60);
  const [draftShort, setDraftShort]       = useState(15);
  const [regularIsOther, setRegularIsOther] = useState(false);
  const [shortIsOther, setShortIsOther]   = useState(false);

  // 休憩スロット
  const [slotNumber, setSlotNumber] = useState<number | null>(initSlotNumber);
  const [slotIsOther, setSlotIsOther] = useState(false);

  // ── 初回ロード（スロット番号もDBから直接取得） ───────────
  useEffect(() => {
    Promise.all([
      getStaffPunchSummaryAction(projectId, staffId),
      getBreakDurationAction(projectId, staffId, today),
      getBreakSlotAssignmentAction(projectId, staffId, today),
    ]).then(([s, d, slot]) => {
      setSummary(s);
      setBreakDuration({ regular: d.regularMinutes, short: d.shortMinutes });
      setDraftRegular(d.regularMinutes);
      setDraftShort(d.shortMinutes);
      setRegularIsOther(![30,45,60].includes(d.regularMinutes));
      setShortIsOther(![15,30].includes(d.shortMinutes));
      setSlotNumber(slot ?? initSlotNumber); // DB値優先、nullならprop値を維持
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

  const limitMin = summary
    ? (summary.breakCount <= 1 ? breakDuration.regular : breakDuration.short) : 60;
  const isOverLimit = summary?.isOnBreak && elapsedSec > limitMin * 60;

  async function refresh() {
    const [s, d] = await Promise.all([
      getStaffPunchSummaryAction(projectId, staffId),
      getBreakDurationAction(projectId, staffId, today),
    ]);
    setSummary(s);
    setBreakDuration({ regular: d.regularMinutes, short: d.shortMinutes });
    setDraftRegular(d.regularMinutes);
    setDraftShort(d.shortMinutes);
    setStep("main");
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }

  // ── アクション ────────────────────────────────────────
  function handleClockIn() {
    startTransition(async () => {
      const res = await clockInAction(projectId, staffId, shiftStart);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "working"); showToast("出勤打刻しました");
      await refresh();
    });
  }
  function handleClockOutInit() {
    // 常に早退/定時/残業の選択画面へ
    setStep("clock_out_confirm");
  }
  function handleClockOutOnTime() {
    startTransition(async () => {
      const res = await clockOutAction(projectId, staffId, shiftEnd, "on_time");
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "clocked_out"); showToast("退勤しました（定時）"); setStep("done");
    });
  }
  function handleEarlyLeaveSubmit() {
    if (!svName.trim()) { showToast("SV名を入力してください"); return; }
    startTransition(async () => {
      const res = await clockOutAction(projectId, staffId, shiftEnd, "early_leave", svName.trim(), reason || undefined);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "clocked_out"); showToast("早退で退勤しました"); setStep("done");
    });
  }
  function handleOvertimeSubmit() {
    if (!svName.trim()) { showToast("SV名を入力してください"); return; }
    startTransition(async () => {
      const res = await clockOutAction(projectId, staffId, shiftEnd, "overtime", svName.trim(), reason || undefined);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "clocked_out"); showToast("残業で退勤しました"); setStep("done");
    });
  }
  function handleSeatLeave() {
    startTransition(async () => {
      const res = await seatLeaveAction(projectId, staffId);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "seat_leave"); showToast("離席しました"); await refresh();
    });
  }
  function handleSeatReturn() {
    startTransition(async () => {
      const res = await seatReturnAction(projectId, staffId);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "working"); showToast("着席しました"); await refresh();
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
      onStatusChange(staffId, "working"); showToast("休憩終了"); await refresh();
    });
  }
  function handleBreakReset() {
    if (!confirm("進行中の休憩をキャンセルしますか？")) return;
    startTransition(async () => {
      const res = await breakResetAction(projectId, staffId);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      onStatusChange(staffId, "working"); showToast("休憩をリセットしました"); await refresh();
    });
  }

  // ── 休憩時間・スロット変更 ────────────────────────────
  function handleDurationChange(regular: number, short: number) {
    startTransition(async () => {
      const res = await setBreakDurationAction(projectId, staffId, regular, short, today);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      setBreakDuration({ regular, short });
      showToast("休憩時間を更新しました");
    });
  }
  function handleSlotChange(newSlot: number | null) {
    setSlotNumber(newSlot);
    startTransition(async () => {
      const res = await setBreakSlotAction(projectId, staffId, today, newSlot);
      if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
      showToast(newSlot ? `休憩パターン${SLOT_LABEL[newSlot] ?? ""}に変更しました` : "休憩パターンを解除しました");
    });
  }

  // ── セクション・シフト表示 ────────────────────────────
  const shiftLabel = shiftName?.includes("早") ? "早番" : shiftName?.includes("遅") ? "遅番" : shiftName ?? "";
  const sectionDisplay = [section, shiftLabel].filter(Boolean).join(" ");

  // ── レンダリング ──────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* ── ヘッダー行：番号 ｜ 名前 ｜ ステータス ── */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          {accountNumber && (
            <span className="text-xs font-mono text-zinc-400 tabular-nums shrink-0">{accountNumber}</span>
          )}
          <span className="flex-1 text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">{staffName}</span>
          {summary && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[summary.derivedStatus] ?? "bg-zinc-100 text-zinc-500"}`}>
              {STATUS_LABEL_MAP[summary.derivedStatus] ?? summary.derivedStatus}
            </span>
          )}
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400 text-xs shrink-0">✕</button>
        </div>

        {/* ── コンテンツ ── */}
        <div className="px-4 py-3 space-y-3">

          {step === "loading" && (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-zinc-200 border-t-blue-500 rounded-full animate-spin" />
            </div>
          )}

          {step === "done" && (
            <div className="text-center py-4">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">完了しました</p>
              <button onClick={onClose} className="mt-2 text-xs text-blue-600 dark:text-blue-400 underline">閉じる</button>
            </div>
          )}

          {/* ── メイン ── */}
          {step === "main" && summary && (
            <>
              {/* タイマー */}
              {(summary.isOnBreak || summary.isOnSeatLeave) && (
                <div className={`rounded-xl px-3 py-2.5 text-center tabular-nums ${isOverLimit ? "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400" : "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300"}`}>
                  <p className="text-[11px] font-semibold mb-0.5">
                    {summary.isOnBreak ? (summary.breakCount === 1 ? `休憩中（${limitMin}分）` : `小休憩中（${limitMin}分）`) : "離席中"}
                    {isOverLimit && " ⚠️ 超過"}
                  </p>
                  <p className="text-2xl font-bold leading-none">{fmtElapsed(elapsedSec)}</p>
                  {summary.isOnBreak && (
                    <p className="text-[10px] mt-0.5 opacity-70">
                      残り {elapsedSec < limitMin * 60 ? fmtElapsed(limitMin * 60 - elapsedSec) : "超過中"}
                    </p>
                  )}
                </div>
              )}

              {/* 打刻ボタン */}
              <div className="space-y-2">
                {summary.derivedStatus === "not_arrived" && (
                  <Btn label="出勤" color="green" onClick={handleClockIn} disabled={isPending} />
                )}
                {summary.derivedStatus === "working" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Btn label="離席" color="zinc" onClick={handleSeatLeave} disabled={isPending} />
                    <Btn
                      label={summary.breakCount === 0 ? `休憩（${breakDuration.regular}分）` : `小休憩（${breakDuration.short}分）`}
                      color="amber" onClick={handleBreakStart} disabled={isPending}
                    />
                    <div className="col-span-2">
                      <Btn label="退勤" color="red" onClick={handleClockOutInit} disabled={isPending} />
                    </div>
                  </div>
                )}
                {summary.derivedStatus === "seat_leave" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Btn label="着席戻り" color="blue" onClick={handleSeatReturn} disabled={isPending} />
                    <Btn label="退勤" color="red" onClick={handleClockOutInit} disabled={isPending} />
                  </div>
                )}
                {summary.derivedStatus === "on_break" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Btn label="休憩戻り" color="blue" onClick={handleBreakEnd} disabled={isPending} />
                    <Btn label="休憩リセット" color="zinc" onClick={handleBreakReset} disabled={isPending} />
                  </div>
                )}
                {summary.derivedStatus === "clocked_out" && (
                  <p className="text-center text-sm text-zinc-400 py-1">退勤済（{fmtTime(summary.clockOut)}）</p>
                )}
              </div>
            </>
          )}

          {/* ── 退勤区分選択（常に3択） ── */}
          {step === "clock_out_confirm" && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-zinc-500 text-center">退勤区分を選択</p>
              <Btn label={`早退（打刻時刻を15分切り下げ）`} color="red" onClick={() => { setSvName(""); setReason(""); setStep("early_leave_sv"); }} />
              <Btn label={`定時退勤${shiftEnd ? `（${shiftEnd.slice(0,5)} で記録）` : ""}`} color="green" onClick={handleClockOutOnTime} disabled={isPending} />
              <Btn label="残業（実打刻時刻で記録）" color="amber" onClick={() => { setSvName(""); setReason(""); setStep("overtime_sv"); }} />
              <button onClick={() => setStep("main")} className="w-full text-xs text-zinc-400 hover:text-zinc-600 py-1">戻る</button>
            </div>
          )}

          {/* ── 早退／残業 SV署名 ── */}
          {(step === "early_leave_sv" || step === "overtime_sv") && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                {step === "early_leave_sv" ? "早退" : "残業"}：承認SV名を入力
              </p>
              <p className="text-xs text-zinc-400">
                {step === "early_leave_sv"
                  ? "打刻時刻を15分切り下げて終了時刻に記録します"
                  : "実打刻時刻をそのまま終了時刻に記録します"}
              </p>
              <input type="text" placeholder="承認SV名（必須）" value={svName} onChange={e => setSvName(e.target.value)}
                className="w-full text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400 dark:text-zinc-100" />
              <input type="text" placeholder="理由（任意）" value={reason} onChange={e => setReason(e.target.value)}
                className="w-full text-sm bg-zinc-100 dark:bg-zinc-800 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:text-zinc-100" />
              <Btn
                label={step === "early_leave_sv" ? "早退で退勤する" : "残業で退勤する"}
                color={step === "early_leave_sv" ? "red" : "amber"}
                onClick={step === "early_leave_sv" ? handleEarlyLeaveSubmit : handleOvertimeSubmit}
                disabled={isPending || !svName.trim()}
              />
              <button onClick={() => setStep("clock_out_confirm")} className="w-full text-xs text-zinc-400 hover:text-zinc-600 py-1">戻る</button>
            </div>
          )}

          {/* トースト */}
          {toast && (
            <p className={`text-center text-xs font-semibold py-1.5 rounded-lg ${toast.startsWith("⚠️") ? "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400" : "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300"}`}>
              {toast}
            </p>
          )}
        </div>

        {/* ── 情報セクション（区切り線以下） ── */}
        {step !== "loading" && step !== "done" && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 space-y-2.5">

            {/* セクション・シフト */}
            {sectionDisplay && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-400 w-20 shrink-0">セクション</span>
                <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">{sectionDisplay}</span>
              </div>
            )}

            {/* 休憩パターン */}
            {(breakSlots.length > 0 || slotNumber !== null) && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-400 w-20 shrink-0">休憩パターン</span>
                {showBreakEdit ? (
                  <div className="flex items-center gap-1.5 flex-1">
                    <select
                      value={slotIsOther ? "other" : (slotNumber ?? "none")}
                      onChange={e => {
                        const v = e.target.value;
                        if (v === "none") { setSlotIsOther(false); handleSlotChange(null); }
                        else if (v === "other") { setSlotIsOther(true); }
                        else { setSlotIsOther(false); handleSlotChange(Number(v)); }
                      }}
                      disabled={isPending}
                      className="flex-1 text-xs bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:text-zinc-100"
                    >
                      <option value="none">未割当</option>
                      {breakSlots.map(s => (
                        <option key={s.slot_number} value={s.slot_number}>
                          {SLOT_LABEL[s.slot_number]}{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}
                        </option>
                      ))}
                      <option value="other">その他</option>
                    </select>
                  </div>
                ) : (
                  <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                    {slotNumber && breakSlots.find(s => s.slot_number === slotNumber)
                      ? `${SLOT_LABEL[slotNumber]}${breakSlots.find(s => s.slot_number === slotNumber)!.start_time.slice(0,5)}–${breakSlots.find(s => s.slot_number === slotNumber)!.end_time.slice(0,5)}`
                      : slotNumber ? `${SLOT_LABEL[slotNumber] ?? ""}` : "未割当"}
                  </span>
                )}
              </div>
            )}

            {/* 休憩持ち時間 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-400 w-20 shrink-0">休憩時間</span>
              {showBreakEdit ? (
                <div className="flex items-center gap-3 flex-1">
                  {/* 1回目 */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-400">1回目</span>
                    <DurationSelect
                      value={draftRegular} presets={[30,45,60]} isOther={regularIsOther}
                      onChange={v => { setDraftRegular(v); setRegularIsOther(![30,45,60].includes(v)); }}
                      onSelectOther={() => setRegularIsOther(true)}
                      onApply={v => handleDurationChange(v, draftShort)}
                      disabled={isPending}
                    />
                  </div>
                  {/* 2回目以降 */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-400">2回目〜</span>
                    <DurationSelect
                      value={draftShort} presets={[15,30]} isOther={shortIsOther}
                      onChange={v => { setDraftShort(v); setShortIsOther(![15,30].includes(v)); }}
                      onSelectOther={() => setShortIsOther(true)}
                      onApply={v => handleDurationChange(draftRegular, v)}
                      disabled={isPending}
                    />
                  </div>
                </div>
              ) : (
                <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">
                  {breakDuration.regular}分 / 小休憩 {breakDuration.short}分
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── H MOTA セクション ── */}
        {motaSlot && step !== "loading" && step !== "done" && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 w-20 shrink-0">H MOTA</span>
              <span className="text-[11px] text-zinc-600 dark:text-zinc-300">{motaSlot}</span>
              {accountNumber && (
                <span className="text-[11px] font-mono text-zinc-400 ml-auto">{accountNumber}</span>
              )}
            </div>
          </div>
        )}
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
  zinc:  "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200",
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

// ── 分数選択コンポーネント ────────────────────────────────
function DurationSelect({ value, presets, isOther, onChange, onSelectOther, onApply, disabled }: {
  value: number;
  presets: number[];
  isOther: boolean;
  onChange: (n: number) => void;
  onSelectOther: () => void;
  onApply: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <select
        value={isOther ? "other" : String(value)}
        onChange={e => {
          if (e.target.value === "other") { onSelectOther(); }
          else { const n = Number(e.target.value); onChange(n); onApply(n); }
        }}
        disabled={disabled}
        className="text-xs bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:text-zinc-100"
      >
        {presets.map(p => <option key={p} value={String(p)}>{p}分</option>)}
        <option value="other">その他</option>
      </select>
      {isOther && (
        <div className="flex items-center gap-0.5">
          <input
            type="number" min={1} max={180} value={value || ""}
            onChange={e => onChange(Number(e.target.value))}
            className="w-12 text-xs text-center bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg px-1 py-1 focus:outline-none dark:text-zinc-100"
            placeholder="分"
          />
          <button
            type="button"
            onClick={() => onApply(value)}
            disabled={!value || disabled}
            className="text-[10px] font-bold px-1.5 py-1 bg-blue-600 text-white rounded-lg disabled:opacity-50"
          >
            適用
          </button>
        </div>
      )}
    </div>
  );
}
