"use client";

import { useState, useEffect, useRef, useTransition } from "react";
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

// ── 打刻ステータスバッジ ─────────────────────────────────────
function StatusDot({ member }: { member: TerminalMember }) {
  if (member.clockedOut) {
    return <span className="text-xs text-zinc-500 font-semibold">退勤済</span>;
  }
  if (member.clockedIn) {
    return <span className="text-xs text-emerald-400 font-semibold">勤務中</span>;
  }
  return <span className="text-xs text-zinc-400">未打刻</span>;
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

  // ── プルダウン状態 ─────────────────────────────────────────
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 外クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ドロップダウンを開いたら検索欄にフォーカス
  useEffect(() => {
    if (dropdownOpen) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [dropdownOpen]);

  const filtered = localMembers.filter(m =>
    search === "" || m.name.includes(search)
  );

  function openDropdown() {
    setDropdownOpen(true);
    setSearch("");
  }

  function handleMemberSelect(member: TerminalMember) {
    setDropdownOpen(false);
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

  // ── スタッフ選択（プルダウン） ──────────────────────────────
  if (step.kind === "list") {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-md space-y-10">

          {/* ヘッダー */}
          <div className="text-center">
            <p className="text-zinc-500 text-sm font-semibold tracking-widest uppercase mb-6">
              {projectName}
            </p>
            <LiveClock />
          </div>

          {/* プルダウン */}
          <div ref={dropdownRef} className="relative">
            {/* トリガーボタン */}
            <button
              onClick={openDropdown}
              className="w-full bg-zinc-800 hover:bg-zinc-750 border border-zinc-600 rounded-2xl px-6 py-5 flex items-center justify-between gap-3 transition-colors active:scale-[0.98]"
            >
              <span className="text-zinc-400 text-lg">スタッフを選択してください</span>
              <svg
                className={`w-5 h-5 text-zinc-400 flex-shrink-0 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`}
                xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {/* ドロップダウンリスト */}
            {dropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-zinc-800 border border-zinc-600 rounded-2xl shadow-2xl shadow-black/60 z-50 overflow-hidden">
                {/* 検索 */}
                <div className="p-3 border-b border-zinc-700">
                  <input
                    ref={searchRef}
                    type="search"
                    placeholder="名前で絞り込み…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-600 rounded-xl px-4 py-3 text-white placeholder-zinc-500 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* リスト */}
                <ul className="max-h-80 overflow-y-auto overscroll-contain divide-y divide-zinc-700/50">
                  {filtered.length === 0 ? (
                    <li className="px-5 py-6 text-center text-zinc-500 text-sm">
                      該当するスタッフがいません
                    </li>
                  ) : (
                    filtered.map(m => {
                      const rowBg = m.clockedOut
                        ? "hover:bg-zinc-700/40 opacity-60"
                        : m.clockedIn
                        ? "hover:bg-emerald-900/30"
                        : "hover:bg-zinc-700/60";

                      return (
                        <li key={m.staffId}>
                          <button
                            onClick={() => handleMemberSelect(m)}
                            className={`w-full flex items-center gap-4 px-5 py-4 text-left transition-colors ${rowBg}`}
                          >
                            {/* アバター */}
                            <div className="w-10 h-10 rounded-full bg-zinc-600 flex items-center justify-center text-white font-bold text-base flex-shrink-0">
                              {m.name.charAt(0)}
                            </div>
                            {/* 名前・シフト */}
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-bold text-base leading-tight">{m.name}</p>
                              {m.shiftName && (
                                <p className="text-zinc-400 text-xs mt-0.5">
                                  {m.shiftName}
                                  {m.shiftStart && m.shiftEnd && `　${m.shiftStart}〜${m.shiftEnd}`}
                                </p>
                              )}
                            </div>
                            {/* ステータス */}
                            <StatusDot member={m} />
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* ヒント */}
          <p className="text-center text-zinc-600 text-sm">
            名前を選択して打刻してください
          </p>
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
