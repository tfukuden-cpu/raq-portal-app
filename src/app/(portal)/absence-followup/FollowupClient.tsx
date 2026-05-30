"use client";

import { useState, useTransition } from "react";
import { submitFollowupAction } from "./actions";

type Symptoms = {
  fever: boolean; fever_temp: string;
  headache: boolean; cough: boolean; fatigue: boolean;
  nausea: boolean; other: boolean; other_detail: string;
};

const initSymptoms: Symptoms = {
  fever: false, fever_temp: "",
  headache: false, cough: false, fatigue: false,
  nausea: false, other: false, other_detail: "",
};

function SymptomRow({
  label,
  checked,
  onToggle,
  children,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-700 dark:text-zinc-300">{label}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => !checked && onToggle()}
            className={[
              "px-3 py-1 rounded-lg text-xs font-semibold border transition-colors",
              checked
                ? "bg-red-50 dark:bg-red-900/30 border-red-400 text-red-700 dark:text-red-300"
                : "border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:border-zinc-300",
            ].join(" ")}
          >
            有
          </button>
          <button
            type="button"
            onClick={() => checked && onToggle()}
            className={[
              "px-3 py-1 rounded-lg text-xs font-semibold border transition-colors",
              !checked
                ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-400 text-zinc-700 dark:text-zinc-200"
                : "border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:border-zinc-300",
            ].join(" ")}
          >
            無
          </button>
        </div>
      </div>
      {checked && children}
    </div>
  );
}

export default function FollowupClient({
  absenceDate,
  absenceReason,
  tomorrowHasShift,
  alreadySubmitted,
}: {
  absenceDate: string;
  absenceReason: string | null;
  tomorrowHasShift: boolean;
  alreadySubmitted: boolean;
}) {
  const [symptoms, setSymptoms]         = useState<Symptoms>(initSymptoms);
  const [recoveryStatus, setRecovery]   = useState<"改善" | "横ばい" | "悪化" | "">("");
  const [consultStatus, setConsult]     = useState<"受診済み" | "未受診" | "">("");
  const [nextDayAvail, setNextDayAvail] = useState<"出勤可能" | "出勤困難" | "">("");
  const [nextReportDate, setNextReportDate] = useState("");
  const [nextReportTime, setNextReportTime] = useState("");
  const [error, setError]               = useState<string | null>(null);
  const [done, setDone]                 = useState(alreadySubmitted);
  const [isPending, startTransition]    = useTransition();

  const setSym = <K extends keyof Symptoms>(k: K, v: Symptoms[K]) =>
    setSymptoms(prev => ({ ...prev, [k]: v }));

  // MM/DD 表示
  const [, mm, dd] = absenceDate.split("-");
  const dateLabel = `${parseInt(mm)}/${parseInt(dd)}`;

  const handleSubmit = () => {
    if (!recoveryStatus || !consultStatus || !nextDayAvail) {
      setError("必須項目を入力してください");
      return;
    }
    if (nextDayAvail === "出勤困難" && (!nextReportDate || !nextReportTime)) {
      setError("出勤困難の場合は次回報告予定日時を入力してください");
      return;
    }
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("absence_date", absenceDate);
      fd.set("symptomsJson", JSON.stringify(symptoms));
      fd.set("recoveryStatus", recoveryStatus);
      fd.set("consultationStatus", consultStatus);
      fd.set("nextDayAvailable", String(nextDayAvail === "出勤可能"));
      fd.set("nextDayAvailLabel", nextDayAvail);
      fd.set("nextReportDate", nextReportDate);
      fd.set("nextReportTime", nextReportTime);
      fd.set("tomorrowHasShift", String(tomorrowHasShift));
      const res = await submitFollowupAction(fd);
      if (res.success) {
        setDone(true);
      } else {
        setError(res.message ?? "エラーが発生しました");
      }
    });
  };

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">経過報告を送信しました</h2>
          <p className="text-sm text-zinc-500">管理者に通知されました。</p>
          <a href="/dashboard" className="inline-block mt-2 text-sm text-blue-600 hover:underline">
            ホームに戻る
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-10">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-5">
        {/* ヘッダー */}
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">経過報告</h1>
          <p className="text-sm text-zinc-500 mt-1">
            ※当日「17:00」までに必ずご報告お願いいたします
          </p>
        </div>

        {/* 固定情報 */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-2.5">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">報告内容（自動入力）</h2>
          <InfoRow label="報告日" value={dateLabel} />
          <InfoRow label="報告区分" value="体調経過" />
          {absenceReason && <InfoRow label="当日欠勤理由" value={absenceReason} />}
        </div>

        {/* 症状等 */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">症状等</h2>
          <p className="text-xs text-zinc-400 -mt-2">可能な範囲でお答えください</p>

          <SymptomRow
            label="発熱"
            checked={symptoms.fever}
            onToggle={() => setSym("fever", !symptoms.fever)}
          >
            <input
              type="text"
              value={symptoms.fever_temp}
              onChange={e => setSym("fever_temp", e.target.value)}
              placeholder="体温（例：38.5）"
              className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </SymptomRow>

          <SymptomRow label="頭痛"          checked={symptoms.headache} onToggle={() => setSym("headache", !symptoms.headache)} />
          <SymptomRow label="咳や喉の痛み"   checked={symptoms.cough}    onToggle={() => setSym("cough",    !symptoms.cough)} />
          <SymptomRow label="だるさ倦怠感"   checked={symptoms.fatigue}  onToggle={() => setSym("fatigue",  !symptoms.fatigue)} />
          <SymptomRow label="吐き気や嘔吐"   checked={symptoms.nausea}   onToggle={() => setSym("nausea",   !symptoms.nausea)} />

          <SymptomRow
            label="その他"
            checked={symptoms.other}
            onToggle={() => setSym("other", !symptoms.other)}
          >
            <input
              type="text"
              value={symptoms.other_detail}
              onChange={e => setSym("other_detail", e.target.value)}
              placeholder="症状の詳細"
              className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </SymptomRow>
        </div>

        {/* 軽快状況 */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-3">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">軽快状況 <span className="text-red-500">*</span></h2>
          <div className="grid grid-cols-3 gap-2">
            {(["改善", "横ばい", "悪化"] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setRecovery(v)}
                className={[
                  "py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors",
                  recoveryStatus === v
                    ? v === "改善"
                      ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-500 text-emerald-700 dark:text-emerald-300"
                      : v === "横ばい"
                      ? "bg-amber-50 dark:bg-amber-900/30 border-amber-500 text-amber-700 dark:text-amber-300"
                      : "bg-red-50 dark:bg-red-900/30 border-red-500 text-red-700 dark:text-red-300"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300",
                ].join(" ")}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* 当日受診状況 */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-3">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">当日受診状況 <span className="text-red-500">*</span></h2>
          <div className="grid grid-cols-2 gap-2">
            {(["受診済み", "未受診"] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setConsult(v)}
                className={[
                  "py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors",
                  consultStatus === v
                    ? "bg-blue-50 dark:bg-blue-900/30 border-blue-500 text-blue-700 dark:text-blue-300"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300",
                ].join(" ")}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* 翌日出勤可否 */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-3">
          <div>
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              翌日出勤可否 <span className="text-red-500">*</span>
            </h2>
            {tomorrowHasShift ? (
              <p className="text-xs text-zinc-400 mt-0.5">翌日シフトがあります</p>
            ) : (
              <p className="text-xs text-zinc-400 mt-0.5">翌日のシフトはありません</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["出勤可能", "出勤困難"] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setNextDayAvail(v)}
                className={[
                  "py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors",
                  nextDayAvail === v
                    ? v === "出勤可能"
                      ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-500 text-emerald-700 dark:text-emerald-300"
                      : "bg-red-50 dark:bg-red-900/30 border-red-500 text-red-700 dark:text-red-300"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300",
                ].join(" ")}
              >
                {v}
              </button>
            ))}
          </div>

          {/* 出勤困難の場合：次回報告予定 */}
          {nextDayAvail === "出勤困難" && (
            <div className="pt-2 space-y-3 border-t border-zinc-100 dark:border-zinc-800">
              <p className="text-xs font-semibold text-zinc-500">
                次回出勤可否報告予定（出勤前日）<span className="text-red-500"> *</span>
              </p>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={nextReportDate}
                  onChange={e => setNextReportDate(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="time"
                  value={nextReportTime}
                  onChange={e => setNextReportTime(e.target.value)}
                  className="w-28 px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 px-1">{error}</p>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-semibold transition-colors"
        >
          {isPending ? "送信中..." : "経過報告を送信する"}
        </button>
      </div>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-zinc-400 w-28 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-zinc-700 dark:text-zinc-300">{value}</span>
    </div>
  );
}
