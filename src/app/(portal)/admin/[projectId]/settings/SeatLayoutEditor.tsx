"use client";

import { useState, useRef, useTransition, useCallback, useId, useEffect } from "react";
import { saveSeatLayoutAction } from "@/app/(portal)/seating/actions";

export type SeatItem = {
  id?: string;
  localId: string;
  label: string;
  xPct: number;
  yPct: number;
  section: string;
};

const SECTIONS = ["SV", "査定", "販売", "MOTA", "ローン", "リメイク", ""];

// 席カードの実ピクセルサイズ（+ 余白）
const CARD_W = 76;  // 68px card + 8px gap
const CARD_H = 62;  // 54px card + 8px gap

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// グリッドのドット背景（cols/rows は動的）
function GridDots({ cols, rows }: { cols: number; rows: number }) {
  const dots: React.ReactNode[] = [];
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r <= rows; r++) {
      dots.push(
        <circle
          key={`${c}-${r}`}
          cx={`${(c / cols) * 100}%`}
          cy={`${(r / rows) * 100}%`}
          r="1.5"
          className="fill-zinc-300 dark:fill-zinc-600"
        />
      );
    }
  }
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
      {dots}
    </svg>
  );
}

// ── ポップオーバー ────────────────────────────────────────
function SeatPopover({
  seat,
  onUpdate,
  onDuplicate,
  onDelete,
  onClose,
}: {
  seat: SeatItem;
  onUpdate: (patch: Partial<SeatItem>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [onClose]);

  const above = seat.yPct > 50;

  return (
    <div
      ref={popRef}
      onPointerDown={e => e.stopPropagation()}
      style={{
        position: "absolute",
        left: `${seat.xPct}%`,
        top: above ? `calc(${seat.yPct}% - 34px)` : `calc(${seat.yPct}% + 34px)`,
        transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0%)",
        zIndex: 30,
      }}
      className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-xl p-3 w-52 space-y-2"
    >
      <div className={[
        "absolute left-1/2 -translate-x-1/2 w-0 h-0",
        above
          ? "bottom-[-6px] border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-zinc-200 dark:border-t-zinc-700"
          : "top-[-6px] border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-zinc-200 dark:border-b-zinc-700",
      ].join(" ")} />

      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold text-zinc-400">席ラベル</p>
        <input
          type="text"
          value={seat.label}
          onChange={e => onUpdate({ label: e.target.value })}
          placeholder="1, A-1 など"
          className="w-full px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold text-zinc-400">セクション</p>
        <select
          value={seat.section}
          onChange={e => onUpdate({ section: e.target.value })}
          className="w-full px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {SECTIONS.map(s => (
            <option key={s} value={s}>{s || "（なし）"}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-1.5 pt-0.5">
        <button
          onClick={onDuplicate}
          className="flex-1 px-2 py-1.5 text-[11px] font-semibold rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
        >
          複製
        </button>
        <button
          onClick={onDelete}
          className="flex-1 px-2 py-1.5 text-[11px] font-semibold rounded-lg bg-red-50 dark:bg-red-950/40 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
        >
          削除
        </button>
      </div>
    </div>
  );
}

// ── メイン ────────────────────────────────────────────────
export default function SeatLayoutEditor({
  projectId,
  initialSeats,
}: {
  projectId: string;
  initialSeats: SeatItem[];
}) {
  const baseId = useId();
  const [seats, setSeats] = useState<SeatItem[]>(initialSeats);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);

  // キャンバス実寸 → グリッド計算
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 640, h: 480 });

  useEffect(() => {
    if (!canvasRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setCanvasSize({ w: width, h: height });
    });
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  // グリッド: 1マス = カード1枚分のサイズ
  const cols   = Math.max(4, Math.floor(canvasSize.w / CARD_W));
  const rows   = Math.max(3, Math.floor(canvasSize.h / CARD_H));
  const stepX  = 100 / cols;
  const stepY  = 100 / rows;

  function snapX(x: number) { return Math.round(x / stepX) * stepX; }
  function snapY(y: number) { return Math.round(y / stepY) * stepY; }
  function toKey(x: number, y: number) { return `${snapX(x).toFixed(3)},${snapY(y).toFixed(3)}`; }

  // ドラッグ
  const draggingRef = useRef<string | null>(null);
  const dragOffRef  = useRef<{ ox: number; oy: number }>({ ox: 0, oy: 0 });
  const didDragRef  = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent, localId: string) => {
    if ((e.target as HTMLElement).closest(".seat-popover")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = localId;
    didDragRef.current  = false;
    const rect = canvasRef.current!.getBoundingClientRect();
    const seat = seats.find(s => s.localId === localId)!;
    dragOffRef.current = {
      ox: e.clientX - rect.left - (seat.xPct / 100) * rect.width,
      oy: e.clientY - rect.top  - (seat.yPct / 100) * rect.height,
    };
  }, [seats]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const dx = e.clientX - rect.left - dragOffRef.current.ox;
    const dy = e.clientY - rect.top  - dragOffRef.current.oy;
    if (!didDragRef.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      didDragRef.current = true;
      setEditingId(null);
    }
    if (!didDragRef.current) return;

    const rawX = clamp((dx / rect.width)  * 100, 0, 100);
    const rawY = clamp((dy / rect.height) * 100, 0, 100);
    const xPct = clamp(snapX(rawX), stepX / 2, 100 - stepX / 2);
    const yPct = clamp(snapY(rawY), stepY / 2, 100 - stepY / 2);

    setSeats(prev => {
      const occupied = prev.some(
        s => s.localId !== draggingRef.current && toKey(s.xPct, s.yPct) === toKey(xPct, yPct)
      );
      if (occupied) return prev;
      return prev.map(s =>
        s.localId === draggingRef.current ? { ...s, xPct, yPct } : s
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepX, stepY]);

  const handlePointerUp = useCallback((_e: React.PointerEvent, localId: string) => {
    const wasDrag = didDragRef.current;
    draggingRef.current = null;
    didDragRef.current  = false;
    if (!wasDrag) {
      setEditingId(prev => prev === localId ? null : localId);
    }
  }, []);

  // 空きグリッド点を探す（近傍優先）
  function findFreeCell(nearX: number, nearY: number, excludeId?: string): { xPct: number; yPct: number } {
    const occupied = new Set(
      seats
        .filter(s => s.localId !== excludeId)
        .map(s => toKey(s.xPct, s.yPct))
    );
    for (let d = 0; d <= Math.max(cols, rows); d++) {
      for (let dc = -d; dc <= d; dc++) {
        for (const dr of d === 0 ? [0] : [-d, d]) {
          const xPct = clamp(snapX(nearX + dc * stepX), stepX / 2, 100 - stepX / 2);
          const yPct = clamp(snapY(nearY + dr * stepY), stepY / 2, 100 - stepY / 2);
          if (!occupied.has(toKey(xPct, yPct))) return { xPct, yPct };
        }
      }
      for (let dr = -d + 1; dr <= d - 1; dr++) {
        for (const dc of [-d, d]) {
          const xPct = clamp(snapX(nearX + dc * stepX), stepX / 2, 100 - stepX / 2);
          const yPct = clamp(snapY(nearY + dr * stepY), stepY / 2, 100 - stepY / 2);
          if (!occupied.has(toKey(xPct, yPct))) return { xPct, yPct };
        }
      }
    }
    return { xPct: nearX, yPct: nearY };
  }

  // 席追加
  function addSeat() {
    const localId = `${baseId}-${Date.now()}`;
    const maxNum = seats.reduce((max, s) => {
      const n = parseInt(s.label);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    const { xPct, yPct } = findFreeCell(50, 50);
    setSeats(prev => [
      ...prev,
      { localId, label: `${maxNum + 1}`, xPct, yPct, section: "" },
    ]);
    setEditingId(localId);
  }

  function removeSeat(localId: string) {
    setSeats(prev => prev.filter(s => s.localId !== localId));
    if (editingId === localId) setEditingId(null);
  }

  function duplicateSeat(localId: string) {
    const src = seats.find(s => s.localId === localId);
    if (!src) return;
    const newLocalId = `${baseId}-${Date.now()}`;
    const maxNum = seats.reduce((max, s) => {
      const n = parseInt(s.label);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    const srcNum = parseInt(src.label);
    const newLabel = isNaN(srcNum) ? src.label : `${maxNum + 1}`;
    const { xPct, yPct } = findFreeCell(src.xPct + stepX, src.yPct, localId);
    setSeats(prev => [...prev, {
      ...src, id: undefined, localId: newLocalId, label: newLabel, xPct, yPct,
    }]);
    setEditingId(newLocalId);
  }

  function updateSeat(localId: string, patch: Partial<SeatItem>) {
    setSeats(prev => prev.map(s => s.localId === localId ? { ...s, ...patch } : s));
  }

  // 保存
  function handleSave() {
    startTransition(async () => {
      const payload = seats.map(s => ({
        id: s.id, label: s.label, xPct: s.xPct, yPct: s.yPct, section: s.section,
      }));
      const res = await saveSeatLayoutAction(projectId, payload);
      setFlash({ ok: res.success, msg: res.success ? "保存しました" : (res.message ?? "エラー") });
      setTimeout(() => setFlash(null), 3000);
    });
  }

  const editing = editingId ? seats.find(s => s.localId === editingId) : null;

  return (
    <div className="space-y-4">
      {/* ツールバー */}
      <div className="flex items-center gap-2">
        <button
          onClick={addSeat}
          className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 transition-colors"
        >
          ＋ 席を追加
        </button>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
        >
          {isPending ? "保存中…" : "レイアウト保存"}
        </button>
        {flash && (
          <span className={`text-xs font-medium ${flash.ok ? "text-emerald-600" : "text-red-500"}`}>
            {flash.ok ? "✓ " : "✗ "}{flash.msg}
          </span>
        )}
        <span className="text-xs text-zinc-400 ml-auto">{seats.length}席</span>
      </div>

      {/* キャンバス */}
      <div
        ref={canvasRef}
        onPointerMove={handlePointerMove}
        className="relative w-full bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 touch-none overflow-visible"
        style={{ aspectRatio: "4/3", minHeight: 240 }}
      >
        <GridDots cols={cols} rows={rows} />

        {seats.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400 pointer-events-none">
            「席を追加」してドラッグで配置
          </p>
        )}

        {seats.map(seat => (
          <div
            key={seat.localId}
            onPointerDown={e => handlePointerDown(e, seat.localId)}
            onPointerUp={e => handlePointerUp(e, seat.localId)}
            style={{
              left: `${seat.xPct}%`,
              top: `${seat.yPct}%`,
              transform: "translate(-50%, -50%)",
              width:  `calc(${stepX}% - 8px)`,
              height: `calc(${stepY}% - 8px)`,
            }}
            className={[
              "absolute rounded-xl border-2 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing select-none transition-shadow",
              editingId === seat.localId
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 shadow-lg"
                : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 hover:border-zinc-400 shadow-sm",
            ].join(" ")}
          >
            <span className="text-[10px] font-bold text-zinc-700 dark:text-zinc-200 pointer-events-none">
              {seat.label || "－"}
            </span>
            {seat.section && (
              <span className="text-[9px] text-zinc-400 pointer-events-none">{seat.section}</span>
            )}
          </div>
        ))}

        {editing && (
          <div className="seat-popover">
            <SeatPopover
              seat={editing}
              onUpdate={patch => updateSeat(editing.localId, patch)}
              onDuplicate={() => duplicateSeat(editing.localId)}
              onDelete={() => removeSeat(editing.localId)}
              onClose={() => setEditingId(null)}
            />
          </div>
        )}
      </div>

      <p className="text-[11px] text-zinc-400">
        席をクリック → 設定・複製・削除　／　ドラッグで移動（隣接してもぴったり並ぶ）
      </p>
    </div>
  );
}
