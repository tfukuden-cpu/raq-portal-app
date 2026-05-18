"use client";

import { useState, useEffect, useTransition } from "react";
import { terminalPunchAction } from "./actions";

// ── 型 ───────────────────────────────────────────────────────
export type TerminalMember = {
  staffId: string;
  name: string;
  shiftName: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  clockedIn: boolean;
  clockedOut: boolean;
};

interface Props {
  projectId: string;
  projectName: string;
  members: TerminalMember[];
}

// ── ライブ時計 ────────────────────────────────────────────────
function LiveClock() {
  const [time, setTime] = useState("--:--:--");
  const [date, setDate] = useState("");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
      setDate(new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" }).format(now));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-center select-none">
      <p className="text-zinc-400 text-sm">{date}</p>
      <p className="text-6xl font-bold tabular-nums text-white mt-1 tracking-tight">{time}</p>
    </div>
  );
}

// ── メイン ────────────────────────────────────────────────────
type Step =
  | { kind: "list" }
  | { kind: "punch"; member: TerminalMember }
  | { kind: "kind"; member: TerminalMember; punchType: "clock_in" | "clock_out" }
  | { kind: "done"; message: string };

export default function TerminalPunchClient({ projectId, projectName, members }: Props) {
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [localMembers, setLocalMembers] = useState(members);
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");

  const filtered = localMembers.filter(m =>
    search === "" || m.name.includes(search)
  );

  function handleMemberSelect(member: TerminalMember) {
    setSearch("");
    setStep({ kind: "punch", member });
  }

  function handlePunchTypeSelect(member: TerminalMember, punchType: "clock_in" | "clock_out") {
    setStep({ kind: "kind", member, punchType });
  }

  function handleConfirm(
    member: TerminalMember,
    punchType: "clock_in" | "clock_out",
    punchKind: "normal" | "late" | "early"
  ) {
    startTransition(async () => {
      const res = await terminalPunchAction(projectId, member.staffId, punchType, punchKind);
      if (res.ok) {
        // ローカル状態を更新
        setLocalMembers(prev => prev.map(m => {
          if (m.staffId !== member.staffId) return m;
          return {
            ...m,
            clockedIn:  punchType === "clock_in"  ? true : m.clockedIn,
            clockedOut: punchType === "clock_out" ? true : m.clockedOut,
          };
        }));
        setStep({ kind: "done", message: res.message });
        setTimeout(() => setStep({ kind: "list" }), 3000);
      } else {
        setStep({ kind: "done", message: `⚠️ ${res.message}` });
        setTimeout(() => setStep({ kind: "list" }), 3000);
      }
    });
  }

  // ── スタッフ一覧 ────────────────────────────────────────────
  if (step.kind === "list") {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col">
        {/* ヘッダー */}
        <div className="px-6 pt-8 pb-4 text-center">
          <p className="text-zinc-500 text-sm font-semibold tracking-widest uppercase mb-1">{projectName}</p>
          <LiveClock />
        </div>

        {/* 検索 */}
        <div className="px-6 pb-4">
          <input
            type="search"
            placeholder="名前で絞り込み…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white placeholder-zinc-500 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* スタッフグリッド */}
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map(m => {
              const status = m.clockedOut
                ? { label: "退勤済", color: "text-zinc-500", bg: "bg-zinc-800/40", border: "border-zinc-700/50" }
                : m.clockedIn
                ? { label: "勤務中", color: "text-emerald-400", bg: "bg-emerald-900/20", border: "border-emerald-700/50" }
                : { label: "未打刻", color: "text-zinc-400", bg: "bg-zinc-900", border: "border-zinc-700" };

              return (
                <button
                  key={m.staffId}
                  onClick={() => handleMemberSelect(m)}
                  className={`${status.bg} ${status.border} border rounded-2xl px-4 py-5 flex flex-col items-center gap-2 transition-all active:scale-95 hover:brightness-110`}
                >
                  <div className="w-12 h-12 rounded-full bg-zinc-700 flex items-center justify-center text-white text-xl font-bold">
                    {m.name.charAt(0)}
                  </div>
                  <span className="text-white font-bold text-sm text-center leading-tight">{m.name}</span>
                  {m.shiftName && (
                    <span className="text-zinc-400 text-xs">{m.shiftName}</span>
                  )}
                  <span className={`text-xs font-semibold ${status.color}`}>{status.label}</span>
                </button>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <p className="text-zinc-500 text-center mt-10">該当するスタッフがいません</p>
          )}
        </div>
      </div>
    );
  }

  // ── 打刻種別選択（出勤 or 退勤） ──────────────────────────────
  if (step.kind === "punch") {
    const { member } = step;
    const canClockIn  = !member.clockedIn;
    const canClockOut = member.clockedIn && !member.clockedOut;

    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6">
          {/* スタッフ情報 */}
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-zinc-700 flex items-center justify-center text-white text-3xl font-bold mx-auto mb-3">
              {member.name.charAt(0)}
            </div>
            <p className="text-white text-2xl font-bold">{member.name}</p>
            {member.shiftName && (
              <p className="text-zinc-400 text-sm mt-1">
                {member.shiftName}
                {member.shiftStart && member.shiftEnd && `　${member.shiftStart}〜${member.shiftEnd}`}
              </p>
            )}
          </div>

          {/* 打刻ボタン */}
          <div className="space-y-3">
            <button
              onClick={() => canClockIn && handlePunchTypeSelect(member, "clock_in")}
              disabled={!canClockIn}
              className={`w-full py-5 rounded-2xl text-lg font-bold transition-all active:scale-95 ${
                canClockIn
                  ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/50"
                  : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
              }`}
            >
              出勤打刻
              {member.clockedIn && <span className="text-sm font-normal ml-2">（打刻済）</span>}
            </button>
            <button
              onClick={() => canClockOut && handlePunchTypeSelect(member, "clock_out")}
              disabled={!canClockOut}
              className={`w-full py-5 rounded-2xl text-lg font-bold transition-all active:scale-95 ${
                canClockOut
                  ? "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/50"
                  : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
              }`}
            >
              退勤打刻
              {member.clockedOut && <span className="text-sm font-normal ml-2">（打刻済）</span>}
            </button>
          </div>

          <button
            onClick={() => setStep({ kind: "list" })}
            className="w-full py-3 rounded-2xl border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            ← 戻る
          </button>
        </div>
      </div>
    );
  }

  // ── 定時/遅刻/早退 選択 ───────────────────────────────────────
  if (step.kind === "kind") {
    const { member, punchType } = step;
    const isClockIn = punchType === "clock_in";

    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <p className="text-zinc-400 text-sm mb-1">{member.name}</p>
            <p className="text-white text-2xl font-bold">{isClockIn ? "出勤" : "退勤"}の種別を選択</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => handleConfirm(member, punchType, "normal")}
              disabled={isPending}
              className="w-full py-5 rounded-2xl bg-zinc-700 hover:bg-zinc-600 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-50"
            >
              {isClockIn ? "定時出勤" : "定時退勤"}
            </button>
            {isClockIn ? (
              <button
                onClick={() => handleConfirm(member, punchType, "late")}
                disabled={isPending}
                className="w-full py-5 rounded-2xl bg-amber-700 hover:bg-amber-600 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                遅刻出勤
              </button>
            ) : (
              <button
                onClick={() => handleConfirm(member, punchType, "early")}
                disabled={isPending}
                className="w-full py-5 rounded-2xl bg-amber-700 hover:bg-amber-600 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                早退退勤
              </button>
            )}
          </div>

          <button
            onClick={() => setStep({ kind: "punch", member })}
            className="w-full py-3 rounded-2xl border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            ← 戻る
          </button>
        </div>
      </div>
    );
  }

  // ── 完了画面 ──────────────────────────────────────────────────
  if (step.kind === "done") {
    const isError = step.message.startsWith("⚠️");
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="text-center space-y-4">
          <div className={`w-24 h-24 rounded-full flex items-center justify-center text-5xl mx-auto ${isError ? "bg-red-900/30" : "bg-emerald-900/30"}`}>
            {isError ? "⚠️" : "✓"}
          </div>
          <p className={`text-2xl font-bold ${isError ? "text-red-400" : "text-emerald-400"}`}>
            {step.message}
          </p>
          <p className="text-zinc-500 text-sm">3秒後に戻ります…</p>
        </div>
      </div>
    );
  }

  return null;
}
