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

// グリッド設定（列数・行数）
const COLS = 20;
const ROWS = 15;
const STEP_X = 100 / COLS; // ≈ 8.33%
const STEP_Y = 100 / ROWS; // ≈ 11.11%

function snapX(x: number) {
  return Math.round(x / STEP_X) * STEP_X;
}
function snapY(y: number) {
  return Math.round(y / STEP_Y) * STEP_Y;
}
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ── グリッドドット背景（SVG） ──────────────────────────────
function GridDots() {
  const dots: React.ReactNode[] = [];
  for (let col = 0; col <= COLS; col++) {
    for (let row = 0; row <= ROWS; row++) {
      dots.push(
        <circle
          key={`${col}-${row}`}
          cx={`${(col / COLS) * 100}%`}
          cy={`${(row / ROWS) * 100}%`}
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

// ── カード上のポップオーバー ──────────────────────────────
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
        top: above
          ? `calc(${seat.yPct}% - 34px)`
          : `calc(${seat.yPct}% + 34px)`,
        transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0%)",
        zIndex: 30,
      }}
      className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-xl p-3 w-52 space-y-2"
    >
      {/* 小三角 */}
      <div className={[
        "absolute left-1/2 -translate-x-1/2 w-0 h-0",
        above
          ? "bottom-[-6px] border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-zinc-200 dark:border-t-zinc-700"
          : "top-[-6px] border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-zinc-200 dark:border-b-zinc-700",
      ].join(" ")} />

      {/* ラベル */}
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

      {/* セクション */}
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

      {/* アクション */}
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

  const canvasRef   = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);
  const dragOffRef  = useRef<{ ox: number; oy: number }>({ ox: 0, oy: 0 });
  const didDragRef  = useRef(false);

  // ── ドラッグ ──────────────────────────────────────────
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
    // グリッドスナップ
    const rawX = clamp((dx / rect.width)  * 100, 0, 100);
    const rawY = clamp((dy / rect.height) * 100, 0, 100);
    const xPct = clamp(snapX(rawX), STEP_X / 2, 100 - STEP_X / 2);
    const yPct = clamp(snapY(rawY), STEP_Y / 2, 100 - STEP_Y / 2);
    setSeats(prev => {
      // 移動先に別の席がいる場合は動かさない
      const occupied = prev.some(
        s => s.localId !== draggingRef.current &&
             Math.abs(s.xPct - xPct) < 1 &&
             Math.abs(s.yPct - yPct) < 1
      );
      if (occupied) return prev;
      return prev.map(s =>
        s.localId === draggingRef.current ? { ...s, xPct, yPct } : s
      );
    });
  }, []);

  const handlePointerUp = useCallback((_e: React.PointerEvent, localId: string) => {
    const wasDrag = didDragRef.current;
    draggingRef.current = null;
    didDragRef.current  = false;
    if (!wasDrag) {
      setEditingId(prev => prev === localId ? null : localId);
    }
  }, []);

  // ── 席追加 ────────────────────────────────────────────
  function addSeat() {
    const localId = `${baseId}-${Date.now()}`;
    const maxNum = seats.reduce((max, s) => {
      const n = parseInt(s.label);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    // 既存と重ならないグリッド点を探す
    const occupied = new Set(seats.map(s => `${snapX(s.xPct)},${snapY(s.yPct)}`));
    let xPct = snapX(STEP_X * 2);
    let yPct = snapY(STEP_Y * 2);
    outer: for (let row = 1; row < ROWS; row++) {
      for (let col = 1; col < COLS; col++) {
        const cx = snapX(col * STEP_X);
        const cy = snapY(row * STEP_Y);
        if (!occupied.has(`${cx},${cy}`)) { xPct = cx; yPct = cy; break outer; }
      }
    }
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
    // 番号ラベルなら最大値+1、それ以外はそのままコピー
    const maxNum = seats.reduce((max, s) => {
      const n = parseInt(s.label);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    const srcNum = parseInt(src.label);
    const newLabel = isNaN(srcNum) ? src.label : `${maxNum + 1}`;
    // 空いているグリッド点を近傍から探す
    const occupied = new Set(seats.map(s => `${snapX(s.xPct).toFixed(2)},${snapY(s.yPct).toFixed(2)}`));
    let xPct = src.xPct, yPct = src.yPct;
    outer: for (let d = 1; d <= COLS; d++) {
      for (const [dx2, dy2] of [[d,0],[-d,0],[0,d],[0,-d],[d,d],[-d,d],[d,-d],[-d,-d]]) {
        const cx = clamp(snapX(src.xPct + dx2 * STEP_X), STEP_X / 2, 100 - STEP_X / 2);
        const cy = clamp(snapY(src.yPct + dy2 * STEP_Y), STEP_Y / 2, 100 - STEP_Y / 2);
        if (!occupied.has(`${cx.toFixed(2)},${cy.toFixed(2)}`)) { xPct = cx; yPct = cy; break outer; }
      }
    }
    setSeats(prev => [...prev, {
      ...src,
      id: undefined,
      localId: newLocalId,
      label: newLabel,
      xPct,
      yPct,
    }]);
    setEditingId(newLocalId);
  }

  function updateSeat(localId: string, patch: Partial<SeatItem>) {
    setSeats(prev => prev.map(s => s.localId === localId ? { ...s, ...patch } : s));
  }

  // ── 保存 ─────────────────────────────────────────────
  function handleSave() {
    startTransition(async () => {
      const payload = seats.map(s => ({
        id:      s.id,
        label:   s.label,
        xPct:    s.xPct,
        yPct:    s.yPct,
        section: s.section,
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
        {/* グリッドドット */}
        <GridDots />

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
              top:  `${seat.yPct}%`,
              transform: "translate(-50%, -50%)",
            }}
            className={[
              "absolute w-[68px] h-[54px] rounded-xl border-2 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing select-none transition-shadow",
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

        {/* ポップオーバー */}
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
        席をクリック → 設定・複製・削除　／　ドラッグで移動（グリッドにスナップ）
      </p>
    </div>
  );
}
