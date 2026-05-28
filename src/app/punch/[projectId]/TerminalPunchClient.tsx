"use client";

import { useState, useEffect, useMemo, useRef, useTransition } from "react";
import { terminalPunchAction, terminalBreakAction, saveConsentAction, type PunchKind } from "./actions";
import { getSeatBgClass, resolveShiftSection, formatSectionShift } from "@/lib/seatColors";

// ── 型 ───────────────────────────────────────────────────────
export type TerminalMember = {
  staffId: string;
  name: string;
  shiftName: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  clockedIn: boolean;
  clockedOut: boolean;
  onBreak: boolean;
  isAbsent: boolean;
  section: string | null;
  accountNumber: string | null;
  hasShiftToday: boolean;
  needsConsent: boolean;
};

export type TerminalSeat = {
  id: string;
  label: string;
  xPct: number;
  yPct: number;
  section: string | null;
  seatType: "normal" | "free" | "disabled";
  shiftSlot: string | null;
  staffId: string | null;
};

export type TerminalWall = {
  x1Pct: number; y1Pct: number;
  x2Pct: number; y2Pct: number;
};

type StaffStatus = "not_arrived" | "working" | "on_break" | "clocked_out" | "absent";

function memberStatus(m: TerminalMember): StaffStatus {
  if (m.isAbsent)  return "absent";
  if (m.clockedOut) return "clocked_out";
  if (m.clockedIn && m.onBreak) return "on_break";
  if (m.clockedIn)  return "working";
  return "not_arrived";
}

interface Props {
  projectId: string;
  projectName: string;
  members: TerminalMember[];
  seats: TerminalSeat[];
  walls: TerminalWall[];
}

// ── ステータス表示定義 ──────────────────────────────────────────
const STATUS_BG: Record<StaffStatus, string> = {
  not_arrived: "bg-zinc-700/80 border-zinc-500",
  working:     "bg-green-900/80 border-green-600",
  on_break:    "bg-amber-900/80 border-amber-600",
  clocked_out: "bg-zinc-800/50 border-zinc-700",
  absent:      "bg-red-900/80 border-red-700",
};
const STATUS_TEXT: Record<StaffStatus, string> = {
  not_arrived: "text-zinc-200",
  working:     "text-green-100",
  on_break:    "text-amber-100",
  clocked_out: "text-zinc-500",
  absent:      "text-red-300",
};
const STATUS_LABEL: Record<StaffStatus, string> = {
  not_arrived: "未出勤",
  working:     "勤務中",
  on_break:    "休憩中",
  clocked_out: "退勤済",
  absent:      "欠勤",
};
const STATUS_COLOR: Record<StaffStatus, string> = {
  not_arrived: "text-zinc-400",
  working:     "text-green-400",
  on_break:    "text-amber-400",
  clocked_out: "text-zinc-500",
  absent:      "text-red-400",
};
const STATUS_AVATAR_BG: Record<StaffStatus, string> = {
  not_arrived: "bg-zinc-700",
  working:     "bg-green-800",
  on_break:    "bg-amber-800",
  clocked_out: "bg-zinc-700",
  absent:      "bg-red-900",
};

// ── ステップ定義 ──────────────────────────────────────────────
type Step =
  | { kind: "list" }
  | { kind: "seat_action"; member: TerminalMember }
  | { kind: "consent"; member: TerminalMember }
  | { kind: "punch"; member: TerminalMember }
  | { kind: "kind"; member: TerminalMember; punchType: "clock_in" | "clock_out" }
  | { kind: "approver"; member: TerminalMember; punchType: "clock_in" | "clock_out"; punchKind: Exclude<PunchKind, "normal"> }
  | { kind: "done"; message: string };

// ── 同意書の本文 ─────────────────────────────────────────────
const CONSENT_TEXT = `1. 身元保証
私が就業時に提出する各種書類、証明類は自らが正当に作成又は取得した自身のものであり、その内容が正確であることを保証します。また、心身を含む健康状態に虚偽はなく、就業後の業務に悪影響を及ぼす秘匿事項はありません。

2. 規則の遵守
私は、法令及び貴社の諸規則、規程等を遵守し、これらに基づく業務命令に従い、就業者として相応しい行動を取ります。

3. 個人情報及び秘密情報の守秘義務
私は、貴社が秘密情報として取り扱う次の情報を許可なく使用、開示（SNSへの投稿、口頭、書面、その他全ての方法）、複製(複写、撮影、ダウンロード、インストール等)、漏洩、毀損、滅失、又はこれらの可能性を有する行為これらの可能性を有する行為(インターネット・動画サイトの私的閲覧、他業務と無関係のPC使用)は行いません。

(1) 貴社の営業上(商品、サービス、原価、価格、業務、企画、データ、戦略、取引先等)の情報
(2) 貴社の技術上(資料、ツール、ネットワーク、セキュリティ等)の情報
(3) 貴社の経営、人事、財務等に関する情報
(4) 貴社の取り扱う個人情報(療養者・従業員の氏名、年齢（年代も含む）、住所、居住地を示唆する内容、症状、その他対象者本人にかかわるすべての情報、特定個人情報を含む)
(5) 貴社の知的財産権に関する情報

4. 私的デバイス等の扱い
私は、貴社の許可なく個人所有の携帯端末やソフトウェア等を業務に使用し、貴社の秘密情報にアクセスしません。貴社より使用・アクセス許可を得た場合、その指示に従って必要な措置を講じ、また、異動、退職時には、引き継ぎ作業を行った上で消去し、確認、制限等の要請には異議なく応じます。

5. 反社会的勢力の排除
私は、自身又は身元保証人が反社会的勢力(暴力団、暴力団関係者、総会屋、社会運動・政治活動・宗教活動標榜ゴロ、特殊知能暴力集団その他これらに準ずる者)ではないことを、過去においても且つ将来に亘っても確約します。

6. 予防・違反措置
私は、本書の義務に違反又はその恐れがあると貴社が判断した場合、直ちに該当行為の停止及びその予防に努めることを誓います。また、貴社に損害を与えるに至った場合には、退職後に違反の事実が判明した場合であっても損害賠償等に応じる義務があることを認めます。

7. 退職時及び退職後の義務
私は、貴社を退職する際、就業中に使用した又は貸与された備品類、書類、情報類の一切を返却し、また、貴社の確認には誠実に応じます。また、退職後も、就業中に知り得た第３項に定める秘密情報について、理由のいかんにかかわらず、他に開示・漏洩し、また使用致しません。

私は、当該コールセンターにて就業するにあたり、前項１〜７の同意確認事項に同意し、これらを遵守することを同意した証として当報告を致します。

内容を十分に理解した上、自らの意思により承諾し貴社へ就業いたします。`;

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
      <p className="text-5xl font-bold tabular-nums text-white mt-1 tracking-tight">{time}</p>
    </div>
  );
}

// ── メインコンポーネント ──────────────────────────────────────
export default function TerminalPunchClient({ projectId, projectName, members, seats, walls }: Props) {
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

  // 同意書確認名
  const [consentName, setConsentName] = useState("");
  const consentNameRef = useRef<HTMLInputElement>(null);

  // 座席表の「名前で探す」タブ
  const hasSeatData = seats.length > 0;
  const [activeTab, setActiveTab] = useState<"seat" | "name">(hasSeatData ? "seat" : "name");

  // ── 30秒ポーリング：他の人の打刻を反映 ───────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/punch/${projectId}/statuses`);
        if (!res.ok) return;
        const data: {
          staffId: string;
          clockedIn: boolean;
          clockedOut: boolean;
          onBreak: boolean;
          isAbsent: boolean;
        }[] = await res.json();
        setLocalMembers(prev => prev.map(m => {
          const s = data.find(d => d.staffId === m.staffId);
          if (!s) return m;
          return { ...m, clockedIn: s.clockedIn, clockedOut: s.clockedOut, onBreak: s.onBreak, isAbsent: s.isAbsent };
        }));
      } catch { /* ネットワークエラーは無視 */ }
    };
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [projectId]);

  // memberMap: staffId → TerminalMember（最新状態）
  const memberMap = useMemo(() => {
    const m = new Map<string, TerminalMember>();
    localMembers.forEach(mem => m.set(mem.staffId, mem));
    return m;
  }, [localMembers]);

  // ドロップダウン用：当日シフトがあり、未打刻の人のみ
  const unclockedMembers = localMembers.filter(m => m.hasShiftToday && !m.clockedIn);
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
      setConsentName("");
      setTimeout(() => consentNameRef.current?.focus(), 50);
    }
  }, [step.kind]);

  function openDropdown() {
    setDropdownOpen(true);
    setSearch("");
  }

  // ── 座席タップ ──────────────────────────────────────────────
  function handleSeatTap(seat: TerminalSeat) {
    if (!seat.staffId) return;
    const member = memberMap.get(seat.staffId);
    if (!member) return;
    setStep({ kind: "seat_action", member });
  }

  // ── 名前選択（ドロップダウン）────────────────────────────────
  function handleMemberSelect(member: TerminalMember) {
    setDropdownOpen(false);
    setSearch("");
    if (member.needsConsent) {
      setStep({ kind: "consent", member });
    } else {
      setStep({ kind: "punch", member });
    }
  }

  // ── 同意書確認 ──────────────────────────────────────────────
  function handleConsentConfirm(member: TerminalMember) {
    if (!consentName.trim()) return;
    startTransition(async () => {
      await saveConsentAction(projectId, member.staffId, consentName.trim());
      setLocalMembers(prev => prev.map(m =>
        m.staffId === member.staffId ? { ...m, needsConsent: false } : m
      ));
      setStep({ kind: "punch", member: { ...member, needsConsent: false } });
    });
  }

  // ── 出退勤種別選択 ──────────────────────────────────────────
  function handlePunchTypeSelect(member: TerminalMember, punchType: "clock_in" | "clock_out") {
    setStep({ kind: "kind", member, punchType });
  }

  function handleKindSelect(member: TerminalMember, punchType: "clock_in" | "clock_out", punchKind: PunchKind) {
    if (punchKind === "normal") {
      handleConfirm(member, punchType, "normal", undefined);
    } else {
      setStep({ kind: "approver", member, punchType, punchKind });
    }
  }

  // ── 打刻確定 ────────────────────────────────────────────────
  function handleConfirm(member: TerminalMember, punchType: "clock_in" | "clock_out", punchKind: PunchKind, approverName: string | undefined) {
    startTransition(async () => {
      const res = await terminalPunchAction(
        projectId, member.staffId, punchType, punchKind, approverName,
        member.shiftStart, member.shiftEnd,
      );
      if (res.ok) {
        setLocalMembers(prev => prev.map(m => {
          if (m.staffId !== member.staffId) return m;
          return {
            ...m,
            clockedIn:  punchType === "clock_in"  ? true : m.clockedIn,
            clockedOut: punchType === "clock_out" ? true : m.clockedOut,
          };
        }));
      }
      setStep({ kind: "done", message: res.ok ? res.message : `⚠️ ${res.message}` });
      setTimeout(() => setStep({ kind: "list" }), 3000);
    });
  }

  // ── 休憩トグル ──────────────────────────────────────────────
  function handleBreakToggle(member: TerminalMember) {
    startTransition(async () => {
      const res = await terminalBreakAction(projectId, member.staffId);
      if (res.ok && res.newStatus) {
        setLocalMembers(prev => prev.map(m =>
          m.staffId !== member.staffId ? m : {
            ...m,
            onBreak: res.newStatus === "on_break",
          }
        ));
      }
      setStep({ kind: "done", message: res.ok ? res.message : `⚠️ ${res.message}` });
      setTimeout(() => setStep({ kind: "list" }), 2000);
    });
  }

  // ══════════════════════════════════════════════════════════
  // ── メイン画面（座席表 + 名前選択）────────────────────────
  // ══════════════════════════════════════════════════════════
  if (step.kind === "list") {
    // 出勤統計
    const withShift    = localMembers.filter(m => m.hasShiftToday);
    const arrivedCount = withShift.filter(m => m.clockedIn || m.isAbsent).length;

    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col">
        {/* ヘッダー */}
        <div className="px-6 pt-6 pb-4 space-y-3">
          <p className="text-zinc-500 text-sm font-semibold tracking-widest uppercase text-center">
            {projectName}
          </p>
          <LiveClock />

          {/* 出勤統計バー */}
          <div className="flex justify-center gap-6 text-sm tabular-nums">
            {(["working", "on_break", "not_arrived", "clocked_out", "absent"] as StaffStatus[]).map(s => {
              const cnt = withShift.filter(m => memberStatus(m) === s).length;
              if (cnt === 0) return null;
              return (
                <div key={s} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full border ${STATUS_BG[s]}`} />
                  <span className={`${STATUS_COLOR[s]} font-semibold`}>{cnt}</span>
                  <span className="text-zinc-600 text-xs">{STATUS_LABEL[s]}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* タブ（座席データがあるときのみ表示） */}
        {hasSeatData && (
          <div className="flex border-b border-zinc-800 px-6">
            <button
              onClick={() => setActiveTab("seat")}
              className={[
                "flex-1 py-2.5 text-sm font-semibold transition-colors",
                activeTab === "seat"
                  ? "text-white border-b-2 border-blue-500"
                  : "text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
            >
              座席表で打刻
            </button>
            <button
              onClick={() => setActiveTab("name")}
              className={[
                "flex-1 py-2.5 text-sm font-semibold transition-colors",
                activeTab === "name"
                  ? "text-white border-b-2 border-blue-500"
                  : "text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
            >
              名前で打刻
            </button>
          </div>
        )}

        <div className="flex-1 px-4 pt-4 pb-10 space-y-5 overflow-y-auto">
          {/* ── 座席表タブ ─────────────────────────────────── */}
          {activeTab === "seat" && hasSeatData && (
            <div>
              <p className="text-zinc-600 text-xs mb-3 text-center">
                自分の席をタップして打刻してください
              </p>

              {/* 凡例 */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 px-1">
                {(["not_arrived", "working", "on_break", "clocked_out", "absent"] as StaffStatus[]).map(s => (
                  <div key={s} className="flex items-center gap-1">
                    <span className={`w-2.5 h-2.5 rounded-sm border-2 ${STATUS_BG[s]}`} />
                    <span className="text-[11px] text-zinc-500">{STATUS_LABEL[s]}</span>
                  </div>
                ))}
              </div>

              {/* キャンバス */}
              <div className="overflow-x-auto rounded-2xl">
                <div
                  className="relative bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden"
                  style={{ width: "max(100%, 1800px)", aspectRatio: "3/2" }}
                >
                  {seats.every(s => s.seatType === "disabled") && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="text-zinc-500 text-sm">座席が設定されていません</p>
                    </div>
                  )}

                  {/* 壁 */}
                  {walls.length > 0 && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none">
                      {walls.map((w, i) => (
                        <line key={i}
                          x1={`${w.x1Pct}%`} y1={`${w.y1Pct}%`}
                          x2={`${w.x2Pct}%`} y2={`${w.y2Pct}%`}
                          stroke="#3f3f46" strokeWidth="2" strokeLinecap="round"
                        />
                      ))}
                    </svg>
                  )}

                  {/* 席 */}
                  {seats.map(seat => {
                    const isDisabled = seat.seatType === "disabled";
                    const isFree     = seat.seatType === "free";
                    const member     = seat.staffId ? memberMap.get(seat.staffId) : undefined;
                    const status     = member ? memberStatus(member) : null;
                    const tappable   = !isDisabled && !!seat.staffId && !!member;

                    if (isDisabled) {
                      return (
                        <div key={seat.id}
                          style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
                          className="absolute w-[70px] h-[58px] rounded-xl border-2 border-zinc-800 bg-zinc-900 opacity-30 flex items-center justify-center"
                        >
                          <span className="text-[9px] text-zinc-600">{seat.label}</span>
                        </div>
                      );
                    }

                    const bgCls   = status ? STATUS_BG[status]
                      : isFree    ? "bg-emerald-900/30 border-emerald-700"
                      : "bg-zinc-800 border-zinc-600";
                    const textCls = status ? STATUS_TEXT[status] : "text-zinc-400";

                    // セクション色バー（上部）
                    const effectiveSection = member
                      ? resolveShiftSection(member.shiftName, seat.section)
                      : seat.section;
                    const sectionLabel = member
                      ? formatSectionShift(effectiveSection, member.shiftName ?? seat.shiftSlot)
                      : null;

                    return (
                      <button key={seat.id}
                        onClick={() => tappable && handleSeatTap(seat)}
                        disabled={isPending || !tappable}
                        style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
                        className={[
                          "absolute flex flex-col items-center justify-center gap-px",
                          "w-[70px] h-[58px] rounded-xl border-2 text-center transition-all shadow-sm select-none overflow-hidden",
                          bgCls,
                          tappable ? "cursor-pointer active:scale-95 hover:brightness-125" : "cursor-default",
                          isPending ? "opacity-60" : "",
                        ].join(" ")}
                      >
                        {/* セクション色バー */}
                        {!isFree && effectiveSection && (
                          <div className={`absolute top-0 left-0 right-0 h-1 rounded-t-[10px] ${getSeatBgClass(effectiveSection, member?.shiftName ?? seat.shiftSlot)}`} />
                        )}

                        <span className="text-[9px] text-zinc-500 leading-none">{seat.label}</span>
                        {member ? (
                          <>
                            <span className="text-[10px] font-mono text-zinc-500 tabular-nums leading-none">
                              {member.accountNumber ?? ""}
                            </span>
                            <span className={`text-[11px] font-bold leading-tight px-0.5 w-full truncate text-center ${textCls}`}>
                              {member.name}
                            </span>
                            {sectionLabel ? (
                              <span className="text-[9px] leading-none text-zinc-500 truncate px-0.5 w-full text-center">
                                {sectionLabel}
                              </span>
                            ) : status ? (
                              <span className={`text-[9px] leading-none truncate px-0.5 w-full text-center ${STATUS_COLOR[status]}`}>
                                {STATUS_LABEL[status]}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className={`text-[10px] mt-0.5 ${isFree ? "text-emerald-600" : "text-zinc-600"}`}>
                            {isFree ? "FREE" : "空席"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── 名前選択タブ ────────────────────────────────── */}
          {(activeTab === "name" || !hasSeatData) && (
            <div className="max-w-md mx-auto w-full">
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

              <p className="text-center text-zinc-600 text-sm tabular-nums mt-4">
                {unclockedMembers.length > 0
                  ? `未打刻 ${unclockedMembers.length}名`
                  : "本日の出勤打刻が完了しました"}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // ── 座席タップ → アクション選択 ────────────────────────────
  // ══════════════════════════════════════════════════════════
  if (step.kind === "seat_action") {
    const { member } = step;
    // ローカル状態から最新メンバーを取得
    const latestMember = memberMap.get(member.staffId) ?? member;
    const status = memberStatus(latestMember);

    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6">

          {/* スタッフ情報 */}
          <div className="text-center">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold mx-auto mb-3 ${STATUS_AVATAR_BG[status]}`}>
              {latestMember.name.charAt(0)}
            </div>
            <p className="text-white text-2xl font-bold">{latestMember.name}</p>
            {latestMember.accountNumber && (
              <p className="text-zinc-500 text-sm tabular-nums mt-0.5">{latestMember.accountNumber}</p>
            )}
            {latestMember.shiftName && (
              <p className="text-zinc-400 text-sm mt-1">
                {latestMember.shiftName}
                {latestMember.shiftStart && latestMember.shiftEnd && `　${latestMember.shiftStart}〜${latestMember.shiftEnd}`}
              </p>
            )}
            <p className={`text-xl font-bold mt-3 ${STATUS_COLOR[status]}`}>
              {STATUS_LABEL[status]}
            </p>
          </div>

          {/* アクションボタン */}
          <div className="space-y-3">
            {status === "not_arrived" && (
              <button
                onClick={() => {
                  if (latestMember.needsConsent) {
                    setStep({ kind: "consent", member: latestMember });
                  } else {
                    setStep({ kind: "punch", member: latestMember });
                  }
                }}
                disabled={isPending}
                className="w-full py-5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-lg font-bold transition-all active:scale-95 shadow-lg shadow-blue-900/50"
              >
                出勤打刻
              </button>
            )}

            {(status === "working" || status === "on_break") && (
              <>
                <button
                  onClick={() => handleBreakToggle(latestMember)}
                  disabled={isPending}
                  className={[
                    "w-full py-5 rounded-2xl text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-50",
                    status === "on_break"
                      ? "bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-900/50"
                      : "bg-amber-700 hover:bg-amber-600 shadow-lg shadow-amber-900/30",
                  ].join(" ")}
                >
                  {isPending ? "記録中…" : status === "on_break" ? "休憩終了" : "休憩開始"}
                </button>
                <button
                  onClick={() => {
                    if (latestMember.needsConsent) {
                      setStep({ kind: "consent", member: latestMember });
                    } else {
                      setStep({ kind: "punch", member: latestMember });
                    }
                  }}
                  disabled={isPending}
                  className="w-full py-5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-rose-900/50"
                >
                  退勤打刻
                </button>
              </>
            )}

            {status === "clocked_out" && (
              <div className="py-6 text-center space-y-2">
                <p className="text-zinc-300 text-lg font-semibold">退勤済みです</p>
                <p className="text-zinc-500 text-sm">本日の打刻は完了しています</p>
              </div>
            )}

            {status === "absent" && (
              <div className="py-6 text-center space-y-2">
                <p className="text-red-400 text-lg font-semibold">欠勤登録済み</p>
                <p className="text-zinc-500 text-sm">本日は欠勤として登録されています</p>
              </div>
            )}
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
  // ── 同意書サイン ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════
  if (step.kind === "consent") {
    const { member } = step;
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col px-6 py-10 overflow-y-auto">
        <div className="w-full max-w-lg mx-auto space-y-6">
          <div className="text-center">
            <p className="text-zinc-400 text-sm mb-1">{member.name}</p>
            <p className="text-white text-2xl font-bold">同意書の確認・署名</p>
            <p className="text-zinc-500 text-sm mt-1">今月初めての打刻です。内容をご確認ください。</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl px-5 py-5">
            <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-line">
              {CONSENT_TEXT}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-zinc-400 text-sm font-semibold">お名前を入力して同意を確認してください</p>
            <input
              ref={consentNameRef}
              type="text"
              placeholder="例：山田 太郎"
              value={consentName}
              onChange={e => setConsentName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && consentName.trim()) handleConsentConfirm(member);
              }}
              className="w-full bg-zinc-900 border-2 border-zinc-600 rounded-2xl px-5 py-4 text-white text-xl placeholder-zinc-600 focus:outline-none focus:border-blue-500 text-center"
            />
          </div>
          <div className="space-y-3 pb-8">
            <button
              onClick={() => handleConsentConfirm(member)}
              disabled={!consentName.trim() || isPending}
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
    const latestMember = memberMap.get(member.staffId) ?? member;
    const canClockIn  = !latestMember.clockedIn;
    const canClockOut = latestMember.clockedIn && !latestMember.clockedOut;

    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-zinc-700 flex items-center justify-center text-white text-3xl font-bold mx-auto mb-3">
              {latestMember.name.charAt(0)}
            </div>
            <p className="text-white text-2xl font-bold">{latestMember.name}</p>
            {latestMember.shiftName && (
              <p className="text-zinc-400 text-sm mt-1">
                {latestMember.shiftName}
                {latestMember.shiftStart && latestMember.shiftEnd && `　${latestMember.shiftStart}〜${latestMember.shiftEnd}`}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <button
              onClick={() => canClockIn && handlePunchTypeSelect(latestMember, "clock_in")}
              disabled={!canClockIn}
              className={`w-full py-5 rounded-2xl text-lg font-bold transition-all active:scale-95 ${
                canClockIn
                  ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/50"
                  : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
              }`}
            >
              出勤打刻
              {latestMember.clockedIn && <span className="text-sm font-normal ml-2">（打刻済）</span>}
            </button>
            <button
              onClick={() => canClockOut && handlePunchTypeSelect(latestMember, "clock_out")}
              disabled={!canClockOut}
              className={`w-full py-5 rounded-2xl text-lg font-bold transition-all active:scale-95 ${
                canClockOut
                  ? "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/50"
                  : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
              }`}
            >
              退勤打刻
              {latestMember.clockedOut && <span className="text-sm font-normal ml-2">（打刻済）</span>}
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
              <span className="block text-xs font-normal text-zinc-400 mt-0.5">
                {isClockIn
                  ? (member.shiftStart ? `→ ${member.shiftStart.slice(0, 5)} で記録` : "シフト開始時刻で記録")
                  : (member.shiftEnd   ? `→ ${member.shiftEnd.slice(0, 5)} で記録`   : "シフト終了時刻で記録")}
              </span>
            </button>
            {isClockIn ? (
              <button
                onClick={() => handleKindSelect(member, punchType, "late")}
                disabled={isPending}
                className="w-full py-5 rounded-2xl bg-amber-700 hover:bg-amber-600 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                遅刻出勤
                <span className="block text-xs font-normal text-amber-200 mt-0.5">実打刻時刻を15分繰り上げ　SV承認必要</span>
              </button>
            ) : (<>
              <button
                onClick={() => handleKindSelect(member, punchType, "early")}
                disabled={isPending}
                className="w-full py-5 rounded-2xl bg-amber-700 hover:bg-amber-600 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                早退退勤
                <span className="block text-xs font-normal text-amber-200 mt-0.5">実打刻時刻を15分切り下げ　SV承認必要</span>
              </button>
              <button
                onClick={() => handleKindSelect(member, punchType, "overtime")}
                disabled={isPending}
                className="w-full py-5 rounded-2xl bg-blue-800 hover:bg-blue-700 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                残業退勤
                <span className="block text-xs font-normal text-blue-200 mt-0.5">実打刻時刻を15分切り下げ　SV承認必要</span>
              </button>
            </>)}
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
  // ── 承認者名入力 ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════
  if (step.kind === "approver") {
    const { member, punchType, punchKind } = step;
    const kindLabel = punchKind === "late" ? "遅刻出勤" : punchKind === "early" ? "早退退勤" : "残業退勤";

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
          <p className="text-zinc-500 text-sm">{isError ? "3秒後に戻ります…" : "2秒後に戻ります…"}</p>
        </div>
      </div>
    );
  }

  return null;
}
