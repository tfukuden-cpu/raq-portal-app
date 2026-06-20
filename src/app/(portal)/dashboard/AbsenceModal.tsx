"use client";

import { useState } from "react";
import { SymptomRow, initSymptoms, type Symptoms } from "@/components/SymptomRow";

export function AbsenceModal({
  onClose,
  onSubmit,
  isPending,
  hasPrevAbsence,
  nextDayHasShift,
  todayLabel,
  displayName,
}: {
  onClose: () => void;
  onSubmit: (data: {
    reason: string;
    symptoms: Symptoms;
    recoveryStatus: string | null;
    hasConsultation: boolean;
    substituteWorkDate: string | null;
  }) => void;
  isPending: boolean;
  hasPrevAbsence: boolean;
  nextDayHasShift: boolean;
  todayLabel: string;
  displayName: string;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reason, setReason] = useState("");
  const [recoveryStatus, setRecoveryStatus] = useState<"改善" | "横ばい" | "悪化" | null>(null);
  const [symptoms, setSymptoms] = useState<Symptoms>(initSymptoms);
  const [hasConsultation, setHasConsultation] = useState<boolean | null>(null);
  const [substituteWorkDate, setSubstituteWorkDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setSym = <K extends keyof Symptoms>(k: K, v: Symptoms[K]) =>
    setSymptoms(prev => ({ ...prev, [k]: v }));

  const handleStep1Next = () => {
    if (!reason.trim()) { setError("理由を入力してください"); return; }
    setError(null);
    setStep(2);
  };

  const handleSubmit = () => {
    if (hasConsultation === null) { setError("当日受診予定を選択してください"); return; }
    setError(null);
    onSubmit({ reason, symptoms, recoveryStatus, hasConsultation, substituteWorkDate: substituteWorkDate || null });
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl w-full max-w-sm mx-0 sm:mx-4 shadow-2xl max-h-[92dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 固定ヘッダー */}
        <div className="px-5 pt-5 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-50">欠員報告フォーマット</h2>
            <span className="text-[12px] text-zinc-400 tabular-nums">{step} / 3</span>
          </div>
          <p className="text-[11px] text-red-500">※当日9:00までに必ずご報告ください※</p>
        </div>

        {/* スクロール本体 */}
        <div className="overflow-y-auto flex-1 px-5 py-4">

          {/* ── Step 1: 理由 ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3 space-y-1.5 text-[13px]">
                {[["報告日", todayLabel], ["報告者", displayName], ["報告区分", "欠勤"]].map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <span className="text-zinc-400 w-16 flex-shrink-0">{k}</span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-200">{v}</span>
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  理由 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="例：発熱のため"
                  rows={3}
                  autoFocus
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[15px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
              {hasPrevAbsence && (
                <div>
                  <p className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 mb-2">軽快状況</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["改善", "横ばい", "悪化"] as const).map(v => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setRecoveryStatus(prev => prev === v ? null : v)}
                        className={`py-2 rounded-xl text-[14px] font-semibold border-2 transition-colors ${
                          recoveryStatus === v
                            ? v === "改善" ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-500 text-emerald-700 dark:text-emerald-300"
                            : v === "悪化" ? "bg-red-50 dark:bg-red-900/30 border-red-500 text-red-700 dark:text-red-300"
                            : "bg-amber-50 dark:bg-amber-900/30 border-amber-500 text-amber-700 dark:text-amber-300"
                            : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
                        }`}
                      >{v}</button>
                    ))}
                  </div>
                </div>
              )}
              {error && <p className="text-[13px] text-red-500">{error}</p>}
            </div>
          )}

          {/* ── Step 2: 症状 ── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-[13px] text-zinc-400">可能な範囲でお答えください（任意）</p>
              <SymptomRow
                label="発熱"
                checked={symptoms.fever}
                onToggle={() => {
                  const next = !symptoms.fever;
                  setSym("fever", next);
                  if (!next) setSym("fever_temp", "");
                }}
              >
                <input
                  type="number"
                  value={symptoms.fever_temp}
                  onChange={e => setSym("fever_temp", e.target.value)}
                  placeholder="36.5"
                  step="0.1" min="35" max="42"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[14px] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                />
              </SymptomRow>
              <SymptomRow label="頭痛"         checked={symptoms.headache} onToggle={() => setSym("headache", !symptoms.headache)} />
              <SymptomRow label="咳や喉の痛み"  checked={symptoms.cough}    onToggle={() => setSym("cough",    !symptoms.cough)} />
              <SymptomRow label="だるさ倦怠感"  checked={symptoms.fatigue}  onToggle={() => setSym("fatigue",  !symptoms.fatigue)} />
              <SymptomRow label="吐き気や嘔吐"  checked={symptoms.nausea}   onToggle={() => setSym("nausea",   !symptoms.nausea)} />
              <SymptomRow
                label="その他"
                checked={symptoms.other}
                onToggle={() => {
                  const next = !symptoms.other;
                  setSym("other", next);
                  if (!next) setSym("other_detail", "");
                }}
              >
                <input
                  type="text"
                  value={symptoms.other_detail}
                  onChange={e => setSym("other_detail", e.target.value)}
                  placeholder="内容を入力"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[14px] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                />
              </SymptomRow>
            </div>
          )}

          {/* ── Step 3: 受診予定 + 確認 ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <p className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                  当日受診予定 <span className="text-red-500">*</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {([true, false] as const).map(v => (
                    <button
                      key={String(v)}
                      type="button"
                      onClick={() => setHasConsultation(v)}
                      className={`py-2.5 rounded-xl text-[14px] font-semibold border-2 transition-colors ${
                        hasConsultation === v
                          ? v
                            ? "bg-blue-50 dark:bg-blue-900/30 border-blue-500 text-blue-700 dark:text-blue-300"
                            : "bg-zinc-100 dark:bg-zinc-800 border-zinc-400 text-zinc-700 dark:text-zinc-200"
                          : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
                      }`}
                    >{v ? "有" : "無"}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                  振替出勤可能日 <span className="text-zinc-400 font-normal">（任意）</span>
                </p>
                <input
                  type="date"
                  value={substituteWorkDate}
                  onChange={e => setSubstituteWorkDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-[15px] tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
                <p className="mt-1 text-[11px] text-zinc-400">欠勤分を振替出勤できる日があれば選択してください</p>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3 space-y-1.5 text-[13px]">
                <div className="flex gap-3">
                  <span className="text-zinc-400 flex-1">翌日出勤予定</span>
                  <span className={`font-semibold ${nextDayHasShift ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>
                    {nextDayHasShift ? "有" : "無"}
                  </span>
                  <span className="text-zinc-300 dark:text-zinc-600 text-[11px]">自動</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-zinc-400 flex-1">翌日出勤可否報告予定</span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-200">17:00</span>
                </div>
              </div>
              {error && <p className="text-[13px] text-red-500">{error}</p>}
            </div>
          )}
        </div>

        {/* 固定フッター */}
        <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex gap-3 flex-shrink-0">
          {step === 1 && (<>
            <button type="button" onClick={onClose}
              className="flex-1 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-[16px] font-semibold text-zinc-600 dark:text-zinc-300">
              キャンセル
            </button>
            <button type="button" onClick={handleStep1Next}
              className="flex-1 py-3 rounded-2xl bg-blue-600 text-white text-[16px] font-semibold">
              次へ
            </button>
          </>)}
          {step === 2 && (<>
            <button type="button" onClick={() => setStep(1)}
              className="flex-1 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-[16px] font-semibold text-zinc-600 dark:text-zinc-300">
              戻る
            </button>
            <button type="button" onClick={() => setStep(3)}
              className="flex-1 py-3 rounded-2xl bg-blue-600 text-white text-[16px] font-semibold">
              次へ
            </button>
          </>)}
          {step === 3 && (<>
            <button type="button" onClick={() => setStep(2)}
              className="flex-1 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-[16px] font-semibold text-zinc-600 dark:text-zinc-300">
              戻る
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="flex-1 py-3 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-[16px] font-semibold disabled:opacity-50 transition-colors"
            >{isPending ? "送信中..." : "報告する"}</button>
          </>)}
        </div>
      </div>
    </div>
  );
}
