"use client";

import type { SectionGroup, StaffTimeline, PunchSegment } from "./AttendanceClient";
import type { BreakSlotSetting } from "@/app/(portal)/seating/break-actions";

interface Props {
  punchTimelines: StaffTimeline[];
  grouped: SectionGroup[];
  breakSlots: BreakSlotSetting[];
  slotByStaff: Record<string, number>;
  onSlotChange: (staffId: string, slot: number) => void;
  shortByStaff: Record<string, number>;
  onShortBreakChange: (staffId: string, minutes: number) => void;
  disabled?: boolean;
}

const SLOT_BADGE: Record<number, string> = {
  1: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300",
  2: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300",
  3: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300",
};

const SEG_COLOR: Record<PunchSegment["type"], string> = {
  working:    "bg-green-400 dark:bg-green-600",
  break:      "bg-amber-400 dark:bg-amber-600",
  seat_leave: "bg-zinc-400 dark:bg-zinc-500",
};

const SEG_LABEL: Record<PunchSegment["type"], string> = {
  working:    "勤務",
  break:      "休憩",
  seat_leave: "離席",
};

function toMin(iso: string): number {
  const s = new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function fmtHM(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

export default function PunchTimelineSection({ punchTimelines, grouped, breakSlots, slotByStaff, onSlotChange, shortByStaff, onShortBreakChange, disabled }: Props) {
  const tlMap = new Map(punchTimelines.map(t => [t.staffId, t]));
  const nowMin = toMin(new Date().toISOString());

  type Row = { staffId: string; name: string; accountNumber: string | null; section: string };
  const rows: Row[] = [];
  for (const sec of grouped) {
    for (const sg of sec.shiftGroups) {
      for (const m of sg.members) {
        rows.push({ staffId: m.staffId, name: m.name, accountNumber: m.accountNumber, section: sec.section });
      }
    }
  }

  let axisStart = 9 * 60;
  let axisEnd = 21 * 60;
  const allTimes: number[] = [];
  for (const t of punchTimelines) {
    for (const s of t.segments) {
      allTimes.push(toMin(s.start));
      if (s.end) allTimes.push(toMin(s.end));
    }
  }
  if (allTimes.length > 0) {
    axisStart = Math.min(axisStart, Math.floor(Math.min(...allTimes) / 60) * 60);
    axisEnd = Math.max(axisEnd, Math.ceil(Math.max(...allTimes, nowMin) / 60) * 60);
  }
  const span = Math.max(1, axisEnd - axisStart);
  const pct = (min: number) => ((min - axisStart) / span) * 100;
  const ticks: number[] = [];
  for (let t = axisStart; t <= axisEnd; t += 60) ticks.push(t);

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400 py-6 text-center">本日の出勤予定者はいません</p>;
  }

  return (
    <TimelineView rows={rows} tlMap={tlMap} ticks={ticks} pct={pct} nowMin={nowMin}
      breakSlots={breakSlots} slotByStaff={slotByStaff} onSlotChange={onSlotChange}
      shortByStaff={shortByStaff} onShortBreakChange={onShortBreakChange} disabled={disabled} />
  );
}

type ViewProps = {
  rows: { staffId: string; name: string; accountNumber: string | null; section: string }[];
  tlMap: Map<string, StaffTimeline>;
  ticks: number[];
  pct: (min: number) => number;
  nowMin: number;
  breakSlots: BreakSlotSetting[];
  slotByStaff: Record<string, number>;
  onSlotChange: (staffId: string, slot: number) => void;
  shortByStaff: Record<string, number>;
  onShortBreakChange: (staffId: string, minutes: number) => void;
  disabled?: boolean;
};

function TimelineView({ rows, tlMap, ticks, pct, nowMin, breakSlots, slotByStaff, onSlotChange, shortByStaff, onShortBreakChange, disabled }: ViewProps) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">打刻記録（出勤〜退勤）</p>
        <div className="flex items-center gap-3">
          {(Object.keys(SEG_LABEL) as PunchSegment["type"][]).map(k => (
            <span key={k} className="flex items-center gap-1 text-[11px] text-zinc-500">
              <span className={`w-3 h-3 rounded-sm ${SEG_COLOR[k]}`} />
              {SEG_LABEL[k]}
            </span>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 overflow-x-auto">
        <div style={{ minWidth: "720px" }}>
          <TimelineHeader ticks={ticks} pct={pct} />
          {rows.map(row => (
            <TimelineRow key={row.staffId} row={row} tl={tlMap.get(row.staffId)} ticks={ticks} pct={pct} nowMin={nowMin}
              breakSlots={breakSlots} slotNumber={slotByStaff[row.staffId] ?? null} onSlotChange={onSlotChange}
              shortMinutes={shortByStaff[row.staffId] ?? null} onShortBreakChange={onShortBreakChange} disabled={disabled} />
          ))}
        </div>
      </div>
      <p className="text-[10px] text-zinc-400 mt-1.5">バーにカーソルを合わせると種別・時刻・経過時間が表示されます。進行中の区間は点滅します。</p>
    </div>
  );
}

function TimelineHeader({ ticks, pct }: { ticks: number[]; pct: (min: number) => number }) {
  return (
    <div className="flex border-b border-zinc-200 dark:border-zinc-700 sticky top-[176px] z-10 bg-zinc-50 dark:bg-zinc-900">
      <div className="w-32 shrink-0 px-3 py-2 text-[11px] font-semibold text-zinc-400">スタッフ</div>
      <div className="relative flex-1 h-8">
        {ticks.map(t => (
          <span key={t} className="absolute top-1.5 text-[10px] text-zinc-400 tabular-nums -translate-x-1/2" style={{ left: `${pct(t)}%` }}>
            {String(Math.floor(t / 60)).padStart(2, "0")}
          </span>
        ))}
      </div>
      <div className="w-36 shrink-0 px-2 py-2 text-[11px] font-semibold text-zinc-400 border-l border-zinc-200 dark:border-zinc-700">勤務/休憩/離席</div>
    </div>
  );
}

const SHORT_BREAK_OPTIONS = [0, 10, 15, 20, 30];

type RowProps = {
  row: { staffId: string; name: string; accountNumber: string | null; section: string };
  tl: StaffTimeline | undefined;
  ticks: number[];
  pct: (min: number) => number;
  nowMin: number;
  breakSlots: BreakSlotSetting[];
  slotNumber: number | null;
  onSlotChange: (staffId: string, slot: number) => void;
  shortMinutes: number | null;
  onShortBreakChange: (staffId: string, minutes: number) => void;
  disabled?: boolean;
};

function TimelineRow({ row, tl, ticks, pct, nowMin, breakSlots, slotNumber, onSlotChange, shortMinutes, onShortBreakChange, disabled }: RowProps) {
  const canSlot = row.section === "査定" || row.section === "販売";
  const segs = tl?.segments ?? [];
  let workMin = 0, breakMin = 0, leaveMin = 0;
  for (const s of segs) {
    const e = s.end ? toMin(s.end) : nowMin;
    const d = Math.max(0, e - toMin(s.start));
    if (s.type === "working") workMin += d;
    else if (s.type === "break") breakMin += d;
    else leaveMin += d;
  }
  return (
    <div className="flex items-center border-b last:border-b-0 border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
      <div className="w-32 shrink-0 px-3 py-2 min-w-0">
        <span className="text-[9px] font-mono text-zinc-400 tabular-nums block leading-none">{row.accountNumber ?? ""}</span>
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 truncate block">{row.name}</span>
        {canSlot && breakSlots.length > 0 && (
          <select
            value={slotNumber ?? ""}
            onChange={e => onSlotChange(row.staffId, parseInt(e.target.value))}
            disabled={disabled}
            className={`mt-0.5 text-[9px] px-1 py-0.5 rounded border-0 tabular-nums disabled:opacity-40 focus:outline-none ${slotNumber ? SLOT_BADGE[slotNumber] : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"}`}
          >
            <option value="">休憩未割当</option>
            {breakSlots.map(s => (
              <option key={s.slot_number} value={s.slot_number}>
                {s.label}{s.start_time.slice(0, 5)}-{s.end_time.slice(0, 5)}
              </option>
            ))}
          </select>
        )}
        {canSlot && (
          <select
            value={shortMinutes ?? 15}
            onChange={e => onShortBreakChange(row.staffId, parseInt(e.target.value))}
            disabled={disabled}
            className="mt-0.5 text-[9px] px-1 py-0.5 rounded border-0 tabular-nums disabled:opacity-40 focus:outline-none bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
          >
            {SHORT_BREAK_OPTIONS.map(m => (
              <option key={m} value={m}>{m === 0 ? "小休憩なし" : `小休憩 ${m}分`}</option>
            ))}
          </select>
        )}
      </div>
      <div className="relative flex-1 h-9 my-0.5">
        {ticks.map(t => (
          <span key={t} className="absolute top-0 bottom-0 w-px bg-zinc-100 dark:bg-zinc-800" style={{ left: `${pct(t)}%` }} />
        ))}
        {segs.map((s, i) => {
          const startMin = toMin(s.start);
          const endMin = s.end ? toMin(s.end) : nowMin;
          const left = pct(startMin);
          const width = Math.max(0.5, pct(endMin) - left);
          const dur = Math.max(0, endMin - startMin);
          const title = `${SEG_LABEL[s.type]}${s.note ? `(${s.note})` : ""} ${fmtHM(s.start)}-${s.end ? fmtHM(s.end) : "進行中"} ${fmtDur(dur)}`;
          return (
            <div key={i} title={title}
              className={`absolute top-1.5 bottom-1.5 rounded-sm ${SEG_COLOR[s.type]} ${!s.end ? "animate-pulse" : ""} flex items-center justify-center overflow-hidden`}
              style={{ left: `${left}%`, width: `${width}%` }}>
              {width > 6 && <span className="text-[8px] font-bold text-white/90 tabular-nums px-0.5 truncate">{fmtDur(dur)}</span>}
            </div>
          );
        })}
      </div>
      <div className="w-36 shrink-0 px-2 py-2 border-l border-zinc-100 dark:border-zinc-800 flex items-center gap-1.5 text-[10px] tabular-nums">
        {segs.length === 0 ? (
          <span className="text-zinc-300 dark:text-zinc-600">未打刻</span>
        ) : (
          <>
            <span className="text-green-600 dark:text-green-400 font-semibold">{fmtDur(workMin)}</span>
            <span className="text-amber-600 dark:text-amber-400">{fmtDur(breakMin)}</span>
            <span className="text-zinc-500">{fmtDur(leaveMin)}</span>
          </>
        )}
      </div>
    </div>
  );
}
