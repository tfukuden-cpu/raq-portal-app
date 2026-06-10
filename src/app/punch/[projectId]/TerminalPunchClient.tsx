"use client";

import { useState, useEffect, useMemo, useRef, useTransition } from "react";
import { terminalPunchAction, terminalBreakAction, saveConsentAction, type PunchKind } from "./actions";
import { enterBreakRoomAction, leaveBreakRoomAction } from "@/app/(portal)/seating/break-room-actions";
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
  hadBreak60: boolean;       // 本日「休憩（60分）」済み
  breakStartedAt: string | null; // 現在の離席開始時刻（ISO）
  breakNote: string | null;      // 現在の離席種別メモ
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

export type BreakSlotInfo = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
};

type MotaSlotInfo = { slot: string; positionAccount: string };

export type BreakRoomUseItem = {
  boxNumber: number;
  staffId: string;
  enteredAt: string; // ISO
};

interface Props {
  projectId: string;
  projectName: string;
  members: TerminalMember[];
  seats: TerminalSeat[];
  walls: TerminalWall[];
  breakAssignmentMap?: Record<string, number>;
  breakSlots?: BreakSlotInfo[];
  motaAccountNumbers?: string[];
  motaSlotInfoMap?: Record<string, MotaSlotInfo[]>;
  breakRoomCapacity?: number;
  breakRoomUses?: BreakRoomUseItem[];
}

// ── ステータス表示定義 ──────────────────────────────────────────
const STATUS_BG: Record<StaffStatus, string> = {
  not_arrived: "bg-zinc-700/80 border-zinc-500",
  working:     "bg-green-900/80 border-green-600",
  on_break:    "bg-amber-500 border-amber-300",
  clocked_out: "bg-zinc-800/50 border-zinc-700",
  absent:      "bg-red-900/80 border-red-700",
};
const STATUS_TEXT: Record<StaffStatus, string> = {
  not_arrived: "text-zinc-200",
  working:     "text-green-100",
  on_break:    "text-zinc-900",
  clocked_out: "text-zinc-500",
  absent:      "text-red-300",
};

// ── 休憩スロットバッジ ──────────────────────────────────────────
const BREAK_BADGE_CLASS: Record<number, string> = {
  1: "bg-blue-500 text-white",
  2: "bg-amber-600 text-white",
  3: "bg-emerald-500 text-white",
};
const BREAK_SLOT_LABEL: Record<number, string> = { 1: "①", 2: "②", 3: "③" };
const STATUS_LABEL: Record<StaffStatus, string> = {
  not_arrived: "未出勤",
  working:     "勤務中",
  on_break:    "離席中",
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

// ── 離席メニュー選択肢 ──────────────────────────────────────────
// hadBreak60=false → 休憩60分あり・小休憩なし
// hadBreak60=true  → 小休憩15分あり・休憩60分なし
const BREAK_OPTIONS_BEFORE: readonly { label: string; note: string; color: string }[] = [
  { label: "トレーニング", note: "トレーニング", color: "bg-blue-800 hover:bg-blue-700 shadow-blue-900/50" },
  { label: "離席",         note: "離席",         color: "bg-zinc-700 hover:bg-zinc-600 shadow-zinc-900/30" },
  { label: "休憩（60分）", note: "休憩（60分）", color: "bg-amber-700 hover:bg-amber-600 shadow-amber-900/50" },
];
const BREAK_OPTIONS_AFTER: readonly { label: string; note: string; color: string }[] = [
  { label: "トレーニング",   note: "トレーニング",   color: "bg-blue-800 hover:bg-blue-700 shadow-blue-900/50" },
  { label: "離席",           note: "離席",           color: "bg-zinc-700 hover:bg-zinc-600 shadow-zinc-900/30" },
  { label: "小休憩（15分）", note: "小休憩（15分）", color: "bg-amber-800 hover:bg-amber-700 shadow-amber-900/30" },
];

// ── シフト時刻の比較ヘルパー ──────────────────────────────────
function isShiftStartPassed(shiftStart: string | null): boolean {
  if (!shiftStart) return false;
  const now = new Date();
  const todayJST = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  return now >= new Date(`${todayJST}T${shiftStart}+09:00`);
}
function isShiftEndPassed(shiftEnd: string | null): boolean {
  if (!shiftEnd) return false;
  const now = new Date();
  const todayJST = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  return now >= new Date(`${todayJST}T${shiftEnd}+09:00`);
}

// ── ステップ定義 ──────────────────────────────────────────────
type Step =
  | { kind: "list" }
  | { kind: "action"; member: TerminalMember }
  | { kind: "break_menu"; member: TerminalMember }
  | { kind: "consent"; member: TerminalMember }
  | { kind: "clock_kind"; member: TerminalMember; punchType: "clock_in" | "clock_out" }
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

// ── 離席タイマー ─────────────────────────────────────────────
const BREAK_LIMIT_MIN: Record<string, number> = {
  "休憩（60分）": 60,
  "小休憩（15分）": 15,
};

function BreakTimer({
  startedAt,
  breakNote,
  size = "normal",
}: {
  startedAt: string;
  breakNote: string | null;
  size?: "compact" | "normal" | "large";
}) {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  );

  useEffect(() => {
    const base = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - base) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const limitMin = breakNote ? (BREAK_LIMIT_MIN[breakNote] ?? null) : null;
  const isOver   = limitMin !== null && elapsed >= limitMin * 60;
  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  const display = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;

  if (size === "compact") {
    return (
      <span className={[
        "tabular-nums font-bold leading-none",
        isOver ? "text-red-400 animate-pulse" : "text-amber-400",
        "text-[9px]",
      ].join(" ")}>
        {display}
      </span>
    );
  }

  if (size === "large") {
    return (
      <div className="text-center space-y-1">
        <p className={`text-5xl font-bold tabular-nums tracking-tight ${isOver ? "text-red-400 animate-pulse" : "text-amber-300"}`}>
          {display}
        </p>
        {limitMin && (
          <p className={`text-sm font-semibold ${isOver ? "text-red-400 animate-pulse" : "text-zinc-500"}`}>
            {isOver ? `⚠ ${limitMin}分超過中` : `制限 ${limitMin}分`}
          </p>
        )}
      </div>
    );
  }

  // normal
  return (
    <div className="flex items-center gap-2">
      <span className={`tabular-nums font-bold text-base ${isOver ? "text-red-400 animate-pulse" : "text-amber-300"}`}>
        {display}
      </span>
      {limitMin && isOver && (
        <span className="text-xs font-bold text-red-400 animate-pulse">超過中</span>
      )}
      {limitMin && !isOver && (
        <span className="text-xs text-zinc-500">/ {limitMin}分</span>
      )}
    </div>
  );
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
      <span className="inline-block text-zinc-400 text-xs font-semibold bg-zinc-900/80 border border-zinc-800 rounded-full px-3.5 py-1">
        {date}
      </span>
      <p className="text-6xl font-bold tabular-nums text-white mt-2.5 tracking-tight">{time}</p>
    </div>
  );
}

// ── メインコンポーネント ──────────────────────────────────────
export default function TerminalPunchClient({ projectId, projectName, members, seats, walls, breakAssignmentMap = {}, breakSlots = [], motaAccountNumbers = [], motaSlotInfoMap = {}, breakRoomCapacity = 6, breakRoomUses = [] }: Props) {
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [localMembers, setLocalMembers] = useState(members);
  const [isPending, startTransition] = useTransition();

  // 休憩室
  const [roomCapacity, setRoomCapacity] = useState(breakRoomCapacity);
  const [roomUses, setRoomUses] = useState<BreakRoomUseItem[]>(breakRoomUses);
  const [roomPickBox, setRoomPickBox] = useState<number | null>(null);   // 入室する箱番号（名前選択モーダル表示中）
  const [roomLeaveBox, setRoomLeaveBox] = useState<number | null>(null); // 退室確認中の箱番号
  const [roomError, setRoomError] = useState<string | null>(null);

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
  const [activeTab, setActiveTab] = useState<"seat" | "name" | "break_room">(hasSeatData ? "seat" : "name");

  // ホバーツールチップ
  const [hoveredSeatId, setHoveredSeatId] = useState<string | null>(null);
  const motaAccountSet = useMemo(() => new Set(motaAccountNumbers), [motaAccountNumbers]);

  // ── 30秒ポーリング ───────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/punch/${projectId}/statuses`);
        if (!res.ok) return;
        const data: {
          statuses: {
            staffId: string; clockedIn: boolean; clockedOut: boolean;
            onBreak: boolean; isAbsent: boolean; hadBreak60: boolean;
            breakStartedAt: string | null; breakNote: string | null;
          }[];
          breakRoom: { capacity: number; uses: BreakRoomUseItem[] };
        } = await res.json();
        setLocalMembers(prev => prev.map(m => {
          const s = data.statuses.find(d => d.staffId === m.staffId);
          if (!s) return m;
          return { ...m, clockedIn: s.clockedIn, clockedOut: s.clockedOut, onBreak: s.onBreak, isAbsent: s.isAbsent, hadBreak60: s.hadBreak60, breakStartedAt: s.breakStartedAt, breakNote: s.breakNote };
        }));
        if (data.breakRoom) {
          setRoomCapacity(data.breakRoom.capacity);
          setRoomUses(data.breakRoom.uses);
        }
      } catch { /* ignore */ }
    };
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [projectId]);

  const memberMap = useMemo(() => {
    const m = new Map<string, TerminalMember>();
    localMembers.forEach(mem => m.set(mem.staffId, mem));
    return m;
  }, [localMembers]);

  // 名前タブ：今日シフトがある全員を表示
  const membersToday = localMembers.filter(m => m.hasShiftToday);
  const unclockedCount = membersToday.filter(m => !m.clockedIn && !m.isAbsent).length;
  const filteredMembers = membersToday.filter(m =>
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

  // ── 座席タップ ──────────────────────────────────────────────
  function handleSeatTap(seat: TerminalSeat) {
    if (!seat.staffId) return;
    const member = memberMap.get(seat.staffId);
    if (!member) return;
    setStep({ kind: "action", member });
  }

  // ── 名前選択 ─────────────────────────────────────────────────
  function handleMemberSelect(member: TerminalMember) {
    setDropdownOpen(false);
    setSearch("");
    setStep({ kind: "action", member });
  }

  // ── 出勤アクション開始（シフト時刻で自動判定）──────────────
  function handleClockIn(member: TerminalMember) {
    if (member.needsConsent) {
      setStep({ kind: "consent", member });
      return;
    }
    if (isShiftStartPassed(member.shiftStart)) {
      // シフト開始時刻を過ぎている → 遅刻
      setStep({ kind: "approver", member, punchType: "clock_in", punchKind: "late" });
    } else {
      // 開始前 or 時刻なし → 定時出勤で即打刻
      handleConfirm(member, "clock_in", "normal", undefined);
    }
  }

  // ── 退勤アクション開始（常に早退/定時/残業を選択）──────────
  function handleClockOut(member: TerminalMember) {
    setStep({ kind: "clock_kind", member, punchType: "clock_out" });
  }

  // ── 離席開始 ─────────────────────────────────────────────────
  function handleBreakStart(member: TerminalMember, breakNote: string) {
    startTransition(async () => {
      const res = await terminalBreakAction(projectId, member.staffId, breakNote);
      if (res.ok) {
        const now = new Date().toISOString();
        setLocalMembers(prev => prev.map(m =>
          m.staffId !== member.staffId ? m : {
            ...m,
            onBreak: true,
            hadBreak60: m.hadBreak60 || breakNote === "休憩（60分）",
            breakStartedAt: now,
            breakNote,
          }
        ));
      }
      setStep({ kind: "done", message: res.ok ? res.message : `⚠️ ${res.message}` });
      setTimeout(() => setStep({ kind: "list" }), 2000);
    });
  }

  // ── 離席終了（戻る） ─────────────────────────────────────────
  function handleBreakEnd(member: TerminalMember) {
    startTransition(async () => {
      const res = await terminalBreakAction(projectId, member.staffId);
      if (res.ok) {
        setLocalMembers(prev => prev.map(m =>
          m.staffId !== member.staffId ? m : { ...m, onBreak: false, breakStartedAt: null, breakNote: null }
        ));
      }
      setStep({ kind: "done", message: res.ok ? res.message : `⚠️ ${res.message}` });
      setTimeout(() => setStep({ kind: "list" }), 2000);
    });
  }

  // ── 休憩室 入室（箱に名前を入れる） ─────────────────────────
  function handleRoomEnter(staffId: string, boxNumber: number) {
    setRoomError(null);
    startTransition(async () => {
      const res = await enterBreakRoomAction(projectId, staffId, boxNumber);
      if (res.ok) {
        setRoomUses(prev => [
          ...prev.filter(u => u.staffId !== staffId),
          { boxNumber, staffId, enteredAt: new Date().toISOString() },
        ]);
        setRoomPickBox(null);
      } else {
        setRoomError(res.error ?? "入室に失敗しました");
      }
    });
  }

  // ── 休憩室 退室（箱から名前を外す） ─────────────────────────
  function handleRoomLeave(staffId: string) {
    startTransition(async () => {
      const res = await leaveBreakRoomAction(projectId, staffId);
      if (res.ok) {
        setRoomUses(prev => prev.filter(u => u.staffId !== staffId));
      }
      setRoomLeaveBox(null);
    });
  }

  // ── 同意書確認 ──────────────────────────────────────────────
  function handleConsentConfirm(member: TerminalMember) {
    if (!consentName.trim()) return;
    startTransition(async () => {
      await saveConsentAction(projectId, member.staffId, consentName.trim());
      const updated = { ...member, needsConsent: false };
      setLocalMembers(prev => prev.map(m =>
        m.staffId === member.staffId ? { ...m, needsConsent: false } : m
      ));
      // 同意書後も時刻で自動判定
      if (isShiftStartPassed(updated.shiftStart)) {
        setStep({ kind: "approver", member: updated, punchType: "clock_in", punchKind: "late" });
      } else {
        handleConfirm(updated, "clock_in", "normal", undefined);
      }
    });
  }

  // ── 種別選択 → 承認者へ or 直接打刻 ─────────────────────────
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

  // ══════════════════════════════════════════════════════════
  // ── メイン画面（座席表 + 名前選択）────────────────────────
  // ══════════════════════════════════════════════════════════
  if (step.kind === "list") {
    const tabBtnBase = "flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-1.5 active:scale-[0.97]";
    const tabBtnOn   = "bg-blue-600 text-white shadow-lg shadow-blue-950/60";
    const tabBtnOff  = "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60";

    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col">
        {/* ヘッダー */}
        <div className="relative px-6 pt-8 pb-5 overflow-hidden">
          {/* 背景グロー */}
          <div className="absolute inset-x-0 -top-24 h-48 bg-blue-600/10 blur-3xl pointer-events-none" />
          <p className="relative text-zinc-500 text-xs font-semibold tracking-[0.35em] uppercase text-center">
            {projectName}
          </p>
          <div className="relative mt-1.5">
            <LiveClock />
          </div>
        </div>

        {/* タブ（セグメントコントロール） */}
        <div className="px-4 pb-4">
          <div className={`max-w-lg mx-auto grid ${hasSeatData ? "grid-cols-3" : "grid-cols-2"} gap-1 bg-zinc-900/80 border border-zinc-800 rounded-2xl p-1.5 shadow-xl shadow-black/30`}>
            {hasSeatData && (
              <button
                onClick={() => setActiveTab("seat")}
                className={`${tabBtnBase} ${activeTab === "seat" ? tabBtnOn : tabBtnOff}`}
              >
                座席表
              </button>
            )}
            <button
              onClick={() => setActiveTab("name")}
              className={`${tabBtnBase} ${activeTab === "name" ? tabBtnOn : tabBtnOff}`}
            >
              打刻
            </button>
            <button
              onClick={() => setActiveTab("break_room")}
              className={`${tabBtnBase} ${activeTab === "break_room" ? tabBtnOn : tabBtnOff}`}
            >
              休憩室
              <span className={[
                "text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full",
                roomUses.length >= roomCapacity
                  ? "bg-red-500/90 text-white"
                  : activeTab === "break_room"
                    ? "bg-white/20 text-white"
                    : "bg-zinc-800 text-amber-400",
              ].join(" ")}>
                {roomUses.length}/{roomCapacity}
              </span>
            </button>
          </div>
        </div>

        <div className="flex-1 px-4 pt-4 pb-10 space-y-5 overflow-y-auto">
          {/* ── 座席表タブ ─────────────────────────────────── */}
          {activeTab === "seat" && hasSeatData && (
            <div>
              <p className="text-zinc-600 text-xs mb-3 text-center">自分の席をタップして打刻してください</p>
              {/* ステータス凡例 */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 px-1">
                {(["not_arrived", "working", "on_break", "clocked_out", "absent"] as StaffStatus[]).map(s => (
                  <div key={s} className="flex items-center gap-1">
                    <span className={`w-2.5 h-2.5 rounded-sm border-2 ${STATUS_BG[s]}`} />
                    <span className="text-[11px] text-zinc-500">{STATUS_LABEL[s]}</span>
                  </div>
                ))}
              </div>
              {/* 休憩スロット凡例 */}
              {breakSlots.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 px-1">
                  {breakSlots.map(slot => (
                    <div key={slot.slotNumber} className="flex items-center gap-1.5">
                      <span className={`w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold ${BREAK_BADGE_CLASS[slot.slotNumber] ?? "bg-zinc-600 text-white"}`}>
                        {slot.label}
                      </span>
                      <span className="text-[11px] text-zinc-500 tabular-nums">
                        {slot.startTime.slice(0, 5)}–{slot.endTime.slice(0, 5)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto rounded-2xl">
                <div
                  className="relative bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden"
                  style={{ width: "max(100%, 1800px)", aspectRatio: "3/2" }}
                  onMouseLeave={() => setHoveredSeatId(null)}
                >
                  {seats.every(s => s.seatType === "disabled") && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="text-zinc-500 text-sm">座席が設定されていません</p>
                    </div>
                  )}
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
                  {/* ── ホバーツールチップ ── */}
                  {(() => {
                    const hSeat = hoveredSeatId ? seats.find(s => s.id === hoveredSeatId) : null;
                    const hMember = hSeat?.staffId ? memberMap.get(hSeat.staffId) : null;
                    if (!hSeat || !hMember) return null;
                    const hStatus = memberStatus(hMember);
                    const hSlotNum = hSeat.staffId ? breakAssignmentMap[hSeat.staffId] : undefined;
                    const hSlot = hSlotNum ? breakSlots.find(s => s.slotNumber === hSlotNum) : null;
                    const hasMota = hMember.accountNumber ? motaAccountSet.has(hMember.accountNumber) : false;
                    const showAbove = hSeat.yPct > 15;
                    return (
                      <div
                        className="absolute z-[200] pointer-events-none"
                        style={{
                          left: `${hSeat.xPct}%`,
                          top: `${hSeat.yPct}%`,
                          transform: showAbove
                            ? "translate(-50%, calc(-100% - 38px))"
                            : "translate(-50%, 36px)",
                        }}
                      >
                        <div className="bg-zinc-900/95 backdrop-blur-sm border border-zinc-600 rounded-2xl p-3 shadow-2xl shadow-black/70 min-w-[170px] max-w-[230px]">
                          <div className="flex items-baseline gap-1.5 mb-1.5">
                            {hMember.accountNumber && (
                              <span className="text-[10px] font-mono text-zinc-500 tabular-nums shrink-0">{hMember.accountNumber}</span>
                            )}
                            <span className="text-xs font-bold text-white truncate">{hMember.name}</span>
                          </div>
                          {hMember.shiftName && (
                            <p className="text-[10px] text-zinc-400 mb-1">
                              {hMember.shiftName}
                              {hMember.shiftStart && hMember.shiftEnd && ` ${hMember.shiftStart}〜${hMember.shiftEnd}`}
                            </p>
                          )}
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_BG[hStatus].split(" ")[0]}`} />
                            <span className={`text-[10px] font-semibold ${STATUS_COLOR[hStatus]}`}>{STATUS_LABEL[hStatus]}</span>
                          </div>
                          {hSlot && (
                            <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-zinc-700">
                              <span className={`w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold shrink-0 ${BREAK_BADGE_CLASS[hSlotNum!] ?? ""}`}>
                                {hSlot.label}
                              </span>
                              <span className="text-[10px] text-zinc-300 tabular-nums">
                                休憩 {hSlot.startTime.slice(0, 5)}〜{hSlot.endTime.slice(0, 5)}
                              </span>
                            </div>
                          )}
                          {hStatus === "on_break" && hMember.breakNote && (
                            <p className="text-[10px] text-amber-400 mt-1">
                              {hMember.breakNote}
                            </p>
                          )}
                          {hasMota && (() => {
                            const slots = hMember.accountNumber ? motaSlotInfoMap[hMember.accountNumber] : null;
                            return (
                              <div className="mt-1.5 pt-1.5 border-t border-zinc-700 space-y-0.5">
                                {slots && slots.length > 0 ? slots.map((s, i) => (
                                  <div key={i} className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[9px] font-bold bg-purple-600 text-white px-1.5 py-0.5 rounded-full">H MOTA</span>
                                    <span className="text-[9px] font-semibold text-purple-300 tabular-nums">{s.slot}</span>
                                    <span className="text-[9px] text-zinc-500">{s.positionAccount}</span>
                                  </div>
                                )) : (
                                  <div className="flex items-center gap-1">
                                    <span className="text-[9px] font-bold bg-purple-600 text-white px-1.5 py-0.5 rounded-full">H MOTA</span>
                                    <span className="text-[10px] text-zinc-400">割り当て済み</span>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        {/* 吹き出し矢印 */}
                        <div className={`absolute left-1/2 -translate-x-1/2 w-0 h-0 ${showAbove ? "bottom-[-6px] border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-zinc-600" : "top-[-6px] border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-zinc-600"}`} />
                      </div>
                    );
                  })()}

                  {seats.map(seat => {
                    const isDisabled = seat.seatType === "disabled";
                    const isFree     = seat.seatType === "free";
                    const member     = seat.staffId ? memberMap.get(seat.staffId) : undefined;
                    const status     = member ? memberStatus(member) : null;
                    const tappable   = !isDisabled && !!seat.staffId && !!member;
                    const hasMota    = member?.accountNumber ? motaAccountSet.has(member.accountNumber) : false;

                    if (isDisabled) {
                      return (
                        <div key={seat.id}
                          style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
                          className="absolute w-[70px] h-[58px] rounded-xl border-2 border-zinc-800 bg-zinc-900 opacity-30"
                        />
                      );
                    }

                    const bgCls = status ? STATUS_BG[status]
                      : isFree  ? "bg-emerald-900/30 border-emerald-700"
                      : "bg-zinc-800 border-zinc-600";
                    const textCls = status ? STATUS_TEXT[status] : "text-zinc-400";
                    const effectiveSection = member
                      ? resolveShiftSection(member.shiftName, seat.section)
                      : seat.section;
                    const sectionLabel = member
                      ? formatSectionShift(effectiveSection, member.shiftName ?? seat.shiftSlot)
                      : null;

                    return (
                      <button key={seat.id}
                        onClick={() => tappable && handleSeatTap(seat)}
                        onMouseEnter={() => member && setHoveredSeatId(seat.id)}
                        onMouseLeave={() => setHoveredSeatId(null)}
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
                        {!isFree && effectiveSection && (
                          <div className={`absolute top-0 left-0 right-0 h-1 rounded-t-[10px] ${getSeatBgClass(effectiveSection, member?.shiftName ?? seat.shiftSlot)}`} />
                        )}
                        {member ? (
                          <>
                            <span className={`text-[10px] font-mono tabular-nums leading-none ${status === "on_break" ? "text-zinc-800" : "text-zinc-500"}`}>
                              {member.accountNumber ?? ""}
                            </span>
                            <span className={`text-[11px] font-bold leading-tight px-0.5 w-full truncate text-center ${textCls}`}>
                              {member.name}
                            </span>
                            {status === "on_break" && member.breakStartedAt ? (
                              <BreakTimer startedAt={member.breakStartedAt} breakNote={member.breakNote} size="compact" />
                            ) : sectionLabel ? (
                              <span className={`text-[9px] leading-none truncate px-0.5 w-full text-center ${status === "on_break" ? "text-zinc-800" : "text-zinc-500"}`}>
                                {sectionLabel}
                              </span>
                            ) : status ? (
                              <span className={`text-[9px] leading-none truncate px-0.5 w-full text-center ${STATUS_COLOR[status]}`}>
                                {STATUS_LABEL[status]}
                              </span>
                            ) : null}
                            {/* 休憩スロットバッジ */}
                            {seat.staffId && breakAssignmentMap[seat.staffId] && (
                              <span className={`absolute bottom-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold ${BREAK_BADGE_CLASS[breakAssignmentMap[seat.staffId]] ?? ""}`}>
                                {BREAK_SLOT_LABEL[breakAssignmentMap[seat.staffId]] ?? ""}
                              </span>
                            )}
                            {/* H MOTAバッジ + スロット情報 */}
                            {hasMota && (() => {
                              const slots = member?.accountNumber ? motaSlotInfoMap[member.accountNumber] : null;
                              const slotLabel = slots?.map(s => s.slot.slice(0, 5)).join("/") ?? "";
                              const posLabel  = slots?.map(s => s.positionAccount).join("/") ?? "";
                              return (
                                <>
                                  <span className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded-full text-[8px] font-bold bg-purple-600 text-white">
                                    M
                                  </span>
                                  {slotLabel && (
                                    <span className="absolute bottom-0 left-0 right-0 text-center text-[7px] font-bold text-purple-300 leading-none pb-0.5 truncate px-0.5">
                                      {posLabel} {slotLabel}
                                    </span>
                                  )}
                                </>
                              );
                            })()}
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
          {activeTab === "name" && (
            <div className="max-w-md mx-auto w-full">
              <div ref={dropdownRef} className="relative">
                <button
                  onClick={() => { setDropdownOpen(true); setSearch(""); }}
                  disabled={membersToday.length === 0}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-2xl px-6 py-5 flex items-center justify-between gap-3 transition-colors active:scale-[0.98] disabled:opacity-50"
                >
                  <span className="text-zinc-400 text-lg">
                    {membersToday.length === 0 ? "本日のシフトがありません" : "名前を選択してください"}
                  </span>
                  {membersToday.length > 0 && (
                    <svg className={`w-5 h-5 text-zinc-400 flex-shrink-0 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`}
                      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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
                      {filteredMembers.length === 0 ? (
                        <li className="px-5 py-6 text-center text-zinc-500 text-sm">該当するスタッフがいません</li>
                      ) : (
                        filteredMembers.map(m => {
                          const st = memberStatus(m);
                          return (
                            <li key={m.staffId}>
                              <button
                                onClick={() => handleMemberSelect(m)}
                                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-zinc-700/60 transition-colors"
                              >
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0 ${STATUS_AVATAR_BG[st]}`}>
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
                                <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                                  <span className={`text-xs font-semibold ${STATUS_COLOR[st]}`}>
                                    {STATUS_LABEL[st]}
                                  </span>
                                  {st === "on_break" && m.breakStartedAt && (
                                    <BreakTimer startedAt={m.breakStartedAt} breakNote={m.breakNote} size="compact" />
                                  )}
                                </div>
                                {m.needsConsent && (
                                  <span className="text-[10px] text-amber-400 font-semibold border border-amber-700/60 rounded px-1.5 py-0.5 flex-shrink-0">
                                    同意書
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </div>
                )}
              </div>

              <p className="text-center text-zinc-600 text-sm tabular-nums mt-4">
                {unclockedCount > 0 ? `未出勤 ${unclockedCount}名` : "全員出勤済み"}
              </p>
            </div>
          )}

          {/* ── 休憩室タブ ─────────────────────────────────── */}
          {activeTab === "break_room" && (
            <div className="max-w-2xl mx-auto w-full">
              <div className="text-center mb-4">
                <p className="text-zinc-300 text-sm font-semibold">
                  空き <span className="text-amber-400 text-lg tabular-nums font-bold">{Math.max(0, roomCapacity - roomUses.length)}</span>
                  <span className="text-zinc-600"> / {roomCapacity}</span>
                </p>
                <p className="text-zinc-600 text-xs mt-1">
                  休憩中のスタッフのみ入室できます・休憩戻りで自動的に退室します
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Array.from({ length: roomCapacity }, (_, i) => i + 1).map(boxNumber => {
                  const use = roomUses.find(u => u.boxNumber === boxNumber);
                  const occupant = use ? memberMap.get(use.staffId) : null;
                  if (use) {
                    return (
                      <button
                        key={boxNumber}
                        onClick={() => setRoomLeaveBox(boxNumber)}
                        disabled={isPending}
                        className="rounded-2xl border-2 border-amber-500 bg-amber-500 p-3 text-left active:scale-95 transition-transform disabled:opacity-60"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-amber-900 tabular-nums">No.{boxNumber}</span>
                          <BreakTimer startedAt={use.enteredAt} breakNote={null} size="compact" />
                        </div>
                        <p className="text-zinc-900 font-bold text-base mt-1 truncate">
                          {occupant?.name ?? use.staffId}
                        </p>
                        <p className="text-[10px] text-amber-900 mt-0.5">タップで退室</p>
                      </button>
                    );
                  }
                  return (
                    <button
                      key={boxNumber}
                      onClick={() => { setRoomError(null); setRoomPickBox(boxNumber); }}
                      disabled={isPending}
                      className="rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-900/60 p-3 text-left active:scale-95 transition-transform hover:border-zinc-500 disabled:opacity-60"
                    >
                      <span className="text-[10px] font-bold text-zinc-600 tabular-nums">No.{boxNumber}</span>
                      <p className="text-zinc-500 font-semibold text-base mt-1">空き</p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">タップで入室</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── 休憩室: 入室する名前の選択モーダル ───────────── */}
        {roomPickBox !== null && (
          <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center px-6" onClick={() => setRoomPickBox(null)}>
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-3 border-b border-zinc-800">
                <p className="text-white font-bold">No.{roomPickBox} に入室</p>
                <p className="text-zinc-500 text-xs mt-0.5">自分の名前を選択してください（本人のみ）</p>
              </div>
              {roomError && (
                <p className="px-5 py-2 text-xs text-red-400 bg-red-950/40">⚠️ {roomError}</p>
              )}
              <ul className="max-h-72 overflow-y-auto overscroll-contain divide-y divide-zinc-800">
                {(() => {
                  const candidates = localMembers.filter(m =>
                    memberStatus(m) === "on_break" && !roomUses.some(u => u.staffId === m.staffId)
                  );
                  if (candidates.length === 0) {
                    return <li className="px-5 py-6 text-center text-zinc-500 text-sm">休憩中のスタッフがいません</li>;
                  }
                  return candidates.map(m => (
                    <li key={m.staffId}>
                      <button
                        onClick={() => handleRoomEnter(m.staffId, roomPickBox)}
                        disabled={isPending}
                        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-zinc-800 transition-colors disabled:opacity-50"
                      >
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold bg-amber-800 flex-shrink-0">
                          {m.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-bold text-sm truncate">{m.name}</p>
                          {m.breakNote && <p className="text-amber-400 text-[10px] mt-0.5">{m.breakNote}</p>}
                        </div>
                        {m.breakStartedAt && (
                          <BreakTimer startedAt={m.breakStartedAt} breakNote={m.breakNote} size="compact" />
                        )}
                      </button>
                    </li>
                  ));
                })()}
              </ul>
              <div className="px-5 py-3 border-t border-zinc-800">
                <button onClick={() => setRoomPickBox(null)} className="w-full py-2.5 text-sm text-zinc-400 hover:text-zinc-200 rounded-xl border border-zinc-700">
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 休憩室: 退室確認モーダル ─────────────────────── */}
        {roomLeaveBox !== null && (() => {
          const use = roomUses.find(u => u.boxNumber === roomLeaveBox);
          if (!use) return null;
          const occupant = memberMap.get(use.staffId);
          return (
            <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center px-6" onClick={() => setRoomLeaveBox(null)}>
              <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
                <p className="text-white font-bold text-lg text-center">
                  {occupant?.name ?? use.staffId} さんを退室させますか？
                </p>
                <p className="text-zinc-500 text-xs text-center mt-1.5">本人のみ操作してください</p>
                <div className="flex gap-3 mt-5">
                  <button
                    onClick={() => setRoomLeaveBox(null)}
                    className="flex-1 py-3 text-sm text-zinc-400 hover:text-zinc-200 rounded-xl border border-zinc-700"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={() => handleRoomLeave(use.staffId)}
                    disabled={isPending}
                    className="flex-1 py-3 text-sm font-bold text-white bg-amber-600 hover:bg-amber-500 rounded-xl disabled:opacity-50"
                  >
                    退室する
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // ── 統合アクション画面 ────────────────────────────────────
  //    未出勤→出勤のみ  出勤中→離席+退勤  離席中→戻る
  // ══════════════════════════════════════════════════════════
  if (step.kind === "action") {
    const { member } = step;
    const latestMember = memberMap.get(member.staffId) ?? member;
    const status = memberStatus(latestMember);

    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-8">

          {/* スタッフ情報 */}
          <div className="text-center">
            <div className={`w-24 h-24 rounded-full flex items-center justify-center text-white text-4xl font-bold mx-auto mb-4 ${STATUS_AVATAR_BG[status]}`}>
              {latestMember.name.charAt(0)}
            </div>
            <p className="text-white text-3xl font-bold">{latestMember.name}</p>
            {latestMember.accountNumber && (
              <p className="text-zinc-500 text-sm tabular-nums mt-0.5">{latestMember.accountNumber}</p>
            )}
            {latestMember.shiftName && (
              <p className="text-zinc-400 text-sm mt-1.5">
                {latestMember.shiftName}
                {latestMember.shiftStart && latestMember.shiftEnd && `　${latestMember.shiftStart}〜${latestMember.shiftEnd}`}
              </p>
            )}
            <p className={`text-2xl font-bold mt-3 ${STATUS_COLOR[status]}`}>
              {STATUS_LABEL[status]}
            </p>
          </div>

          {/* ── アクションボタン ── */}
          <div className="space-y-3">

            {/* 未出勤 → 出勤ボタンのみ */}
            {status === "not_arrived" && (
              <button
                onClick={() => handleClockIn(latestMember)}
                disabled={isPending}
                className="w-full py-6 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-xl font-bold transition-all active:scale-95 shadow-xl shadow-blue-900/50 disabled:opacity-50"
              >
                出勤
              </button>
            )}

            {/* 出勤中 → 離席 + 退勤 */}
            {status === "working" && (
              <>
                <button
                  onClick={() => setStep({ kind: "break_menu", member: latestMember })}
                  disabled={isPending}
                  className="w-full py-5 rounded-2xl bg-amber-600 hover:bg-amber-500 text-white text-xl font-bold transition-all active:scale-95 shadow-xl shadow-amber-900/50 disabled:opacity-50"
                >
                  離席
                </button>
                <button
                  onClick={() => handleClockOut(latestMember)}
                  disabled={isPending}
                  className="w-full py-5 rounded-2xl bg-rose-700 hover:bg-rose-600 text-white text-xl font-bold transition-all active:scale-95 shadow-xl shadow-rose-900/50 disabled:opacity-50"
                >
                  退勤
                </button>
              </>
            )}

            {/* 離席中 → タイマー + 戻るボタン */}
            {status === "on_break" && (
              <div className="space-y-4">
                {latestMember.breakStartedAt && (
                  <div className="py-3">
                    {latestMember.breakNote && (
                      <p className="text-zinc-500 text-sm text-center mb-2">{latestMember.breakNote}</p>
                    )}
                    <BreakTimer startedAt={latestMember.breakStartedAt} breakNote={latestMember.breakNote} size="large" />
                  </div>
                )}
                <button
                  onClick={() => handleBreakEnd(latestMember)}
                  disabled={isPending}
                  className="w-full py-6 rounded-2xl bg-green-700 hover:bg-green-600 text-white text-xl font-bold transition-all active:scale-95 shadow-xl shadow-green-900/50 disabled:opacity-50"
                >
                  {isPending ? "記録中…" : "戻る（離席終了）"}
                </button>
              </div>
            )}

            {/* 退勤済み */}
            {status === "clocked_out" && (
              <div className="py-6 text-center space-y-2">
                <p className="text-zinc-300 text-lg font-semibold">退勤済みです</p>
                <p className="text-zinc-500 text-sm">本日の打刻は完了しています</p>
              </div>
            )}

            {/* 欠勤 */}
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
  // ── 離席メニュー ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════
  if (step.kind === "break_menu") {
    const { member } = step;
    const latestMember = memberMap.get(member.staffId) ?? member;
    const breakOptions = latestMember.hadBreak60 ? BREAK_OPTIONS_AFTER : BREAK_OPTIONS_BEFORE;

    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <p className="text-zinc-400 text-sm mb-1">{latestMember.name}</p>
            <p className="text-white text-2xl font-bold">離席の種類を選択</p>
            {latestMember.hadBreak60 && (
              <p className="text-zinc-500 text-xs mt-1">休憩取得済み</p>
            )}
          </div>

          <div className="space-y-3">
            {breakOptions.map(opt => (
              <button
                key={opt.note}
                onClick={() => handleBreakStart(latestMember, opt.note)}
                disabled={isPending}
                className={`w-full py-5 rounded-2xl text-white text-xl font-bold transition-all active:scale-95 shadow-lg disabled:opacity-50 ${opt.color}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setStep({ kind: "action", member: latestMember })}
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
            <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-line">{CONSENT_TEXT}</p>
          </div>
          <div className="space-y-2">
            <p className="text-zinc-400 text-sm font-semibold">お名前を入力して同意を確認してください</p>
            <input
              ref={consentNameRef}
              type="text"
              placeholder="例：山田 太郎"
              value={consentName}
              onChange={e => setConsentName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && consentName.trim()) handleConsentConfirm(member); }}
              className="w-full bg-zinc-900 border-2 border-zinc-600 rounded-2xl px-5 py-4 text-white text-xl placeholder-zinc-600 focus:outline-none focus:border-blue-500 text-center"
            />
          </div>
          <div className="space-y-3 pb-8">
            <button
              onClick={() => handleConsentConfirm(member)}
              disabled={!consentName.trim() || isPending}
              className="w-full py-5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-lg font-bold transition-all active:scale-95 disabled:opacity-40"
            >
              {isPending ? "保存中…" : "同意して出勤へ進む"}
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
  // ── 出退勤種別選択（定時/遅刻/早退/残業）─────────────────
  // ══════════════════════════════════════════════════════════
  if (step.kind === "clock_kind") {
    const { member, punchType } = step;
    const isClockIn = punchType === "clock_in";

    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <p className="text-zinc-400 text-sm mb-1">{member.name}</p>
            <p className="text-white text-2xl font-bold">退勤の種別を選択</p>
            <p className="text-zinc-500 text-xs mt-1">
              シフト終了時刻 {member.shiftEnd ? member.shiftEnd.slice(0, 5) : "未設定"}
            </p>
          </div>

          <div className="space-y-3">
            {/* 早退 */}
            <button
              onClick={() => handleKindSelect(member, punchType, "early")}
              disabled={isPending}
              className="w-full py-5 rounded-2xl bg-amber-700 hover:bg-amber-600 text-white text-xl font-bold transition-all active:scale-95 disabled:opacity-50"
            >
              早退
              <span className="block text-xs font-normal text-amber-200 mt-0.5">打刻時刻を15分切り下げ・SV承認必要</span>
            </button>
            {/* 定時 */}
            <button
              onClick={() => handleKindSelect(member, punchType, "normal")}
              disabled={isPending}
              className="w-full py-5 rounded-2xl bg-zinc-700 hover:bg-zinc-600 text-white text-xl font-bold transition-all active:scale-95 disabled:opacity-50"
            >
              定時退勤
              <span className="block text-xs font-normal text-zinc-400 mt-0.5">
                {member.shiftEnd ? `→ ${member.shiftEnd.slice(0, 5)} で記録` : "シフト終了時刻で記録"}
              </span>
            </button>
            {/* 残業 */}
            <button
              onClick={() => handleKindSelect(member, punchType, "overtime")}
              disabled={isPending}
              className="w-full py-5 rounded-2xl bg-blue-800 hover:bg-blue-700 text-white text-xl font-bold transition-all active:scale-95 disabled:opacity-50"
            >
              残業
              <span className="block text-xs font-normal text-blue-200 mt-0.5">実打刻時刻をそのまま記録・SV承認必要</span>
            </button>
          </div>

          <button
            onClick={() => setStep({ kind: "action", member })}
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
              onClick={() =>
                punchKind === "overtime"
                  ? setStep({ kind: "clock_kind", member, punchType })
                  : setStep({ kind: "action", member })
              }
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
          <p className="text-zinc-500 text-sm">2秒後に戻ります…</p>
        </div>
      </div>
    );
  }

  return null;
}
