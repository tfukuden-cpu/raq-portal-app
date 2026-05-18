"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { terminalPunchAction, saveConsentAction } from "./actions";

// ── 型 ───────────────────────────────────────────────────────
export type TerminalMember = {
  staffId: string;
  name: string;
  shiftName: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  clockedIn: boolean;
  clockedOut: boolean;
  needsConsent: boolean; // 当月まだ同意書未サイン
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

// ── 署名キャンバス ─────────────────────────────────────────────
function SignatureCanvas({
  onChange,
}: {
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const [hasSigned, setHasSigned] = useState(false);

  function getXY(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement
  ) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function startDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawing.current = true;
    lastPos.current = getXY(e, canvasRef.current!);
  }

  function moveDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const pos = getXY(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current!.x, lastPos.current!.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = pos;
    if (!hasSigned) {
      setHasSigned(true);
      onChange(canvas.toDataURL("image/png"));
    } else {
      onChange(canvas.toDataURL("image/png"));
    }
  }

  function endDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawing.current = false;
    lastPos.current = null;
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasSigned(false);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={640}
        height={200}
        className="w-full rounded-2xl border-2 border-zinc-600 bg-zinc-900 touch-none cursor-crosshair"
        style={{ height: "140px" }}
        onMouseDown={startDraw}
        onMouseMove={moveDraw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={moveDraw}
        onTouchEnd={endDraw}
      />
      <div className="flex justify-between items-center">
        <p className="text-zinc-600 text-xs">↑ 上の枠内にサインしてください</p>
        {hasSigned && (
          <button
            type="button"
            onClick={clear}
            className="text-xs text-zinc-500 hover:text-zinc-300 underline transition-colors"
          >
            やり直す
          </button>
        )}
      </div>
    </div>
  );
}

// ── ステップ定義 ──────────────────────────────────────────────
type Step =
  | { kind: "list" }
  | { kind: "consent"; member: TerminalMember }
  | { kind: "punch"; member: TerminalMember }
  | { kind: "kind"; member: TerminalMember; punchType: "clock_in" | "clock_out" }
  | { kind: "approver"; member: TerminalMember; punchType: "clock_in" | "clock_out"; punchKind: "late" | "early" }
  | { kind: "done"; message: string };

// ── 同意書の本文（必要に応じて編集してください）────────────────
const CONSENT_TEXT = `以下の事項について確認し、同意します。

1. 就業規則および労働条件通知書の内容を遵守します。
2. 業務上知り得た情報（個人情報・顧客情報・機密情報）を外部に漏洩しません。
3. ハラスメント防止に関する会社方針を遵守し、良好な職場環境の維持に努めます。
4. 打刻記録は正確に行い、不正な打刻操作は行いません。
5. 上記に違反した場合、就業規則に基づく措置を受けることに同意します。`;

// ── メインコンポーネント ──────────────────────────────────────
export default function TerminalPunchClient({ projectId, projectName, members }: Props) {
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [localMembers, setLocalMembers] = useState(members);
  const [isPending, startTransition] = useTransition();

  // プルダウン
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 承認者
  const [approverInput, setApproverInput] = useState("");
  const approverRef = useRef<HTMLInputElement>(null);

  // 同意書サイン
  const [signatureData, setSignatureData] = useState<string | null>(null);

  // 未打刻者のみ
  const unclockedMembers = localMembers.filter(m => !m.clockedIn);
  const filtered = unclockedMembers.filter(m =>
    search === "" || m.name.includes(search)
  );

  // 外クリックでドロップダウンを閉じる
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

  useEffect(() => {
    if (dropdownOpen) setTimeout(() => searchRef.current?.focus(), 50);
  }, [dropdownOpen]);

  useEffect(() => {
    if (step.kind === "approver") {
      setApproverInput("");
      setTimeout(() => approverRef.current?.focus(), 50);
    }
    if (step.kind === "consent") {
      setSignatureData(null);
    }
  }, [step.kind]);

  function openDropdown() {
    setDropdownOpen(true);
    setSearch("");
  }

  function handleMemberSelect(member: TerminalMember) {
    setDropdownOpen(false);
    setSearch("");
    // 当月未同意なら同意書ステップへ
    if (member.needsConsent) {
      setStep({ kind: "consent", member });
    } else {
      setStep({ kind: "punch", member });
    }
  }

  function handleConsentConfirm(member: TerminalMember) {
    if (!signatureData) return;
    startTransition(async () => {
      await saveConsentAction(projectId, member.staffId, signatureData);
      // ローカルでneedsConsentをfalseに
      setLocalMembers(prev => prev.map(m =>
        m.staffId === member.staffId ? { ...m, needsConsent: false } : m
      ));
      setStep({ kind: "punch", member: { ...member, needsConsent: false } });
    });
  }

  function handlePunchTypeSelect(member: TerminalMember, punchType: "clock_in" | "clock_out") {
    setStep({ kind: "kind", member, punchType });
  }

  function handleKindSelect(
    member: TerminalMember,
    punchType: "clock_in" | "clock_out",
    punchKind: "normal" | "late" | "early"
  ) {
    if (punchKind === "normal") {
      handleConfirm(member, punchType, "normal", undefined);
    } else {
      setStep({ kind: "approver", member, punchType, punchKind });
    }
  }

  function handleConfirm(
    member: TerminalMember,
    punchType: "clock_in" | "clock_out",
    punchKind: "normal" | "late" | "early",
    approverName: string | undefined
  ) {
    startTransition(async () => {
      const res = await terminalPunchAction(projectId, member.staffId, punchType, punchKind, approverName);
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

  // ══════════════════════════════════════════════════════════
  // ── スタッフ選択（プルダウン）─────────────────────────────
  // ══════════════════════════════════════════════════════════
  if (step.kind === "list") {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-md space-y-10">
          <div className="text-center">
            <p className="text-zinc-500 text-sm font-semibold tracking-widest uppercase mb-6">
              {projectName}
            </p>
            <LiveClock />
          </div>

          <div ref={dropdownRef} className="relative">
            <button
              onClick={openDropdown}
              disabled={unclockedMembers.length === 0}
              className="w-full bg-zinc-800 border border-zinc-600 rounded-2xl px-6 py-5 flex items-center justify-between gap-3 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-default"
            >
              <span className="text-zinc-400 text-lg">
                {unclockedMembers.length === 0 ? "全員打刻済み" : "名前を選択してください"}
              </span>
              {unclockedMembers.length > 0 && (
                <svg
                  className={`w-5 h-5 text-zinc-400 flex-shrink-0 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`}
                  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              )}
            </button>

            {dropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-zinc-800 border border-zinc-600 rounded-2xl shadow-2xl shadow-black/60 z-50 overflow-hidden">
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
                <ul className="max-h-80 overflow-y-auto overscroll-contain divide-y divide-zinc-700/50">
                  {filtered.length === 0 ? (
                    <li className="px-5 py-6 text-center text-zinc-500 text-sm">
                      該当するスタッフがいません
                    </li>
                  ) : (
                    filtered.map(m => (
                      <li key={m.staffId}>
                        <button
                          onClick={() => handleMemberSelect(m)}
                          className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-zinc-700/60 transition-colors"
                        >
                          <div className="w-10 h-10 rounded-full bg-zinc-600 flex items-center justify-center text-white font-bold text-base flex-shrink-0">
                            {m.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-bold text-base leading-tight">{m.name}</p>
                            {m.shiftName && (
                              <p className="text-zinc-400 text-xs mt-0.5">
                                {m.shiftName}
                                {m.shiftStart && m.shiftEnd && `　${m.shiftStart}〜${m.shiftEnd}`}
                              </p>
                            )}
                          </div>
                          {m.needsConsent && (
                            <span className="text-[10px] text-amber-400 font-semibold border border-amber-700/60 rounded px-1.5 py-0.5 flex-shrink-0">
                              同意書
                            </span>
                          )}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </div>

          <p className="text-center text-zinc-600 text-sm tabular-nums">
            {unclockedMembers.length > 0
              ? `未打刻 ${unclockedMembers.length}名`
              : "本日の出勤打刻が完了しました"}
          </p>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // ── 同意書サイン ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════
  if (step.kind === "consent") {
    const { member } = step;
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col px-6 py-10 overflow-y-auto">
        <div className="w-full max-w-lg mx-auto space-y-6">

          {/* タイトル */}
          <div className="text-center">
            <p className="text-zinc-400 text-sm mb-1">{member.name}</p>
            <p className="text-white text-2xl font-bold">同意書の確認・署名</p>
            <p className="text-zinc-500 text-sm mt-1">今月初めての打刻です。内容をご確認ください。</p>
          </div>

          {/* 同意書本文 */}
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl px-5 py-5">
            <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-line">
              {CONSENT_TEXT}
            </p>
          </div>

          {/* 署名エリア */}
          <div className="space-y-2">
            <p className="text-zinc-400 text-sm font-semibold">署名</p>
            <SignatureCanvas onChange={setSignatureData} />
          </div>

          {/* ボタン */}
          <div className="space-y-3 pb-8">
            <button
              onClick={() => handleConsentConfirm(member)}
              disabled={!signatureData || isPending}
              className="w-full py-5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-40"
            >
              {isPending ? "保存中…" : "同意して打刻へ進む"}
            </button>
            <button
              onClick={() => setStep({ kind: "list" })}
              className="w-full py-3 rounded-2xl border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              ← 戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // ── 出勤 / 退勤 選択 ────────────────────────────────────
  // ══════════════════════════════════════════════════════════
  if (step.kind === "punch") {
    const { member } = step;
    const canClockIn  = !member.clockedIn;
    const canClockOut = member.clockedIn && !member.clockedOut;

    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6">
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

  // ══════════════════════════════════════════════════════════
  // ── 定時 / 遅刻 / 早退 選択 ─────────────────────────────
  // ══════════════════════════════════════════════════════════
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
              onClick={() => handleKindSelect(member, punchType, "normal")}
              disabled={isPending}
              className="w-full py-5 rounded-2xl bg-zinc-700 hover:bg-zinc-600 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-50"
            >
              {isClockIn ? "定時出勤" : "定時退勤"}
            </button>
            {isClockIn ? (
              <button
                onClick={() => handleKindSelect(member, punchType, "late")}
                disabled={isPending}
                className="w-full py-5 rounded-2xl bg-amber-700 hover:bg-amber-600 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                遅刻出勤
                <span className="block text-xs font-normal text-amber-200 mt-0.5">SV承認が必要です</span>
              </button>
            ) : (
              <button
                onClick={() => handleKindSelect(member, punchType, "early")}
                disabled={isPending}
                className="w-full py-5 rounded-2xl bg-amber-700 hover:bg-amber-600 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                早退退勤
                <span className="block text-xs font-normal text-amber-200 mt-0.5">SV承認が必要です</span>
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

  // ══════════════════════════════════════════════════════════
  // ── 承認者名入力（遅刻・早退）──────────────────────────────
  // ══════════════════════════════════════════════════════════
  if (step.kind === "approver") {
    const { member, punchType, punchKind } = step;
    const kindLabel = punchKind === "late" ? "遅刻出勤" : "早退退勤";

    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <p className="text-zinc-400 text-sm mb-1">{member.name}　{kindLabel}</p>
            <p className="text-white text-2xl font-bold">承認SVの名前を入力</p>
            <p className="text-zinc-500 text-sm mt-2">承認を受けたSVの名前を入力してください</p>
          </div>

          <input
            ref={approverRef}
            type="text"
            placeholder="例：田中SV"
            value={approverInput}
            onChange={e => setApproverInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && approverInput.trim()) {
                handleConfirm(member, punchType, punchKind, approverInput.trim());
              }
            }}
            className="w-full bg-zinc-800 border border-zinc-600 rounded-2xl px-5 py-4 text-white text-xl placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500 text-center"
          />

          <div className="space-y-3">
            <button
              onClick={() => handleConfirm(member, punchType, punchKind, approverInput.trim() || undefined)}
              disabled={isPending || !approverInput.trim()}
              className="w-full py-5 rounded-2xl bg-amber-600 hover:bg-amber-500 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-40"
            >
              {isPending ? "記録中…" : "打刻を確定する"}
            </button>
            <button
              onClick={() => setStep({ kind: "kind", member, punchType })}
              className="w-full py-3 rounded-2xl border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              ← 戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // ── 完了画面 ─────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════
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
