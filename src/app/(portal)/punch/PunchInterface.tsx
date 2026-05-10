"use client";

import { useState, useTransition, useEffect } from "react";
import { recordPunchAction } from "./actions";
import {
  LoginIcon,
  LogOutIcon,
  CoffeeIcon,
  CheckCircleIcon,
} from "@/components/icons";

type PunchType = "clock_in" | "clock_out" | "break_start" | "break_end";

const PUNCH_LABEL: Record<PunchType, string> = {
  clock_in: "出勤",
  clock_out: "退勤",
  break_start: "休憩開始",
  break_end: "休憩終了",
};

type PunchLog = { id: string; punch_type: string; recorded_at: string };

interface Props {
  staffName: string;
  projectName: string;
  lastType: PunchType | undefined;
  statusLabel: string;
  todayPunches: PunchLog[];
  scheduledStart: string | null;
  scheduledEnd: string | null;
  shiftName: string | null;
}

// ── ライブ時計（秒付き）──
function LiveClock() {
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    }).format(d);

  const [time, setTime] = useState("--:--:--");
  const [date, setDate] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(fmtTime(now));
      setDate(fmtDate(now));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="text-center select-none">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{date}</p>
      <p className="text-5xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50 mt-1 tracking-tight">
        {time}
      </p>
    </div>
  );
}

// ── ボタン定義 ──
type BtnCfg = {
  type: PunchType;
  label: string;
  Icon: (p: { className?: string }) => React.JSX.Element;
  activeClass: string;
  disabledClass: string;
  size: "large" | "small";
};

const BUTTONS: BtnCfg[] = [
  {
    type: "clock_in",
    label: "出勤",
    Icon: LoginIcon,
    activeClass:
      "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-md shadow-blue-200 dark:shadow-blue-900/50",
    disabledClass:
      "bg-zinc-100 dark:bg-zinc-800 text-zinc-300 dark:text-zinc-600 cursor-not-allowed",
    size: "large",
  },
  {
    type: "clock_out",
    label: "退勤",
    Icon: LogOutIcon,
    activeClass:
      "bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white shadow-md shadow-rose-200 dark:shadow-rose-900/50",
    disabledClass:
      "bg-zinc-100 dark:bg-zinc-800 text-zinc-300 dark:text-zinc-600 cursor-not-allowed",
    size: "large",
  },
  {
    type: "break_start",
    label: "休憩開始",
    Icon: CoffeeIcon,
    activeClass:
      "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 active:bg-zinc-100",
    disabledClass:
      "bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 text-zinc-300 dark:text-zinc-700 cursor-not-allowed",
    size: "small",
  },
  {
    type: "break_end",
    label: "休憩終了",
    Icon: CoffeeIcon,
    activeClass:
      "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 active:bg-zinc-100",
    disabledClass:
      "bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 text-zinc-300 dark:text-zinc-700 cursor-not-allowed",
    size: "small",
  },
];

// ── 打刻可否判定 ──
function getAvailable(lastType: PunchType | undefined): Set<PunchType> {
  if (!lastType || lastType === "clock_out") return new Set(["clock_in"]);
  if (lastType === "clock_in" || lastType === "break_end")
    return new Set(["clock_out", "break_start"]);
  if (lastType === "break_start") return new Set(["break_end"]);
  return new Set(["clock_in"]);
}

// ── メイン ──
export default function PunchInterface({
  staffName,
  projectName,
  lastType,
  statusLabel,
  todayPunches,
  scheduledStart,
  shiftName,
}: Props) {
  const [modal, setModal] = useState<PunchType | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [optimisticLast, setOptimisticLast] = useState<PunchType | undefined>(lastType);
  const [isPending, startTransition] = useTransition();

  const available = getAvailable(optimisticLast);

  const handleClick = (pt: PunchType) => {
    if (!available.has(pt) || isPending) return;
    setModal(pt);
  };

  const handleConfirm = () => {
    if (!modal) return;
    const pt = modal;
    setModal(null);
    setFeedback(null);
    const fd = new FormData();
    fd.set("punchType", pt);
    setOptimisticLast(pt);
    startTransition(async () => {
      const r = await recordPunchAction(fd);
      if (!r.success) setOptimisticLast(lastType);
      setFeedback({ ok: r.success, msg: r.message ?? "" });
    });
  };

  // ステータスバッジ色
  const statusColor =
    optimisticLast === "clock_in" || optimisticLast === "break_end"
      ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400"
      : optimisticLast === "break_start"
      ? "text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400"
      : optimisticLast === "clock_out"
      ? "text-zinc-400 bg-zinc-100 dark:bg-zinc-800"
      : "text-zinc-400 bg-zinc-100 dark:bg-zinc-800";

  const dotColor =
    optimisticLast === "clock_in" || optimisticLast === "break_end"
      ? "bg-emerald-500"
      : optimisticLast === "break_start"
      ? "bg-amber-400"
      : "bg-zinc-300 dark:bg-zinc-600";

  return (
    <>
      <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="max-w-lg mx-auto px-4 pt-6 pb-10 space-y-4">

          {/* スタッフ情報 */}
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">{staffName}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{projectName}</p>
            </div>
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full ${statusColor}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
              {statusLabel}
            </span>
          </div>

          {/* 打刻カード */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm p-6 space-y-5">

            {/* 日付 + 時計 */}
            <LiveClock />

            {/* シフト予定 */}
            {scheduledStart && (
              <div className="flex items-center justify-center gap-2">
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {shiftName ? `${shiftName}　` : ""}出勤予定　{scheduledStart}
                </span>
                <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
              </div>
            )}

            {/* 4ボタングリッド */}
            <div className="grid grid-cols-2 gap-3">
              {BUTTONS.map(({ type, label, Icon, activeClass, disabledClass, size }) => {
                const isAvailable = available.has(type);
                const cls = isAvailable ? activeClass : disabledClass;
                const height = size === "large" ? "h-16" : "h-13";
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleClick(type)}
                    disabled={!isAvailable || isPending}
                    className={`${height} rounded-xl flex items-center justify-center gap-2 font-semibold text-sm transition-all active:scale-95 ${cls} ${size === "large" ? "text-base" : ""}`}
                  >
                    <Icon className={size === "large" ? "w-5 h-5" : "w-4 h-4"} />
                    {label}
                  </button>
                );
              })}
            </div>

            {/* フィードバック */}
            {feedback && (
              <div
                className={`rounded-xl px-4 py-3 text-sm text-center font-medium ${
                  feedback.ok
                    ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                    : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
                }`}
              >
                {feedback.msg}
              </div>
            )}
          </div>

          {/* 本日の打刻ログ */}
          {todayPunches.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm px-5 py-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                本日の記録
              </p>
              <div className="flex items-center gap-6 overflow-x-auto">
                {[...todayPunches].reverse().map((p, i, arr) => (
                  <div key={p.id} className="flex items-center gap-6 flex-shrink-0">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[10px] text-zinc-400">
                        {PUNCH_LABEL[p.punch_type as PunchType]}
                      </span>
                      <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                        {new Date(p.recorded_at).toLocaleTimeString("ja-JP", {
                          timeZone: "Asia/Tokyo",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </span>
                    </div>
                    {i < arr.length - 1 && (
                      <div className="w-4 h-px bg-zinc-200 dark:bg-zinc-700 flex-shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 確認モーダル */}
      {modal && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-3xl max-w-xs w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-center text-zinc-900 dark:text-zinc-50 mb-1">
              {PUNCH_LABEL[modal]}しますか？
            </h2>
            <p className="text-xs text-center text-zinc-400 mb-6">
              現在時刻で記録されます
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="flex-1 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending}
                className={`flex-1 py-3 rounded-2xl text-white text-sm font-bold disabled:opacity-50 transition-opacity ${
                  modal === "clock_in"
                    ? "bg-blue-600"
                    : modal === "clock_out"
                    ? "bg-rose-500"
                    : "bg-zinc-700 dark:bg-zinc-600"
                }`}
              >
                記録する
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
