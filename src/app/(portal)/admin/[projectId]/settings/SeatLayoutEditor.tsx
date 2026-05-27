"use client";

import { useState, useRef, useTransition, useId, useEffect, useCallback } from "react";
import { saveSeatLayoutAction, saveSeatWallsAction } from "@/app/(portal)/seating/actions";
import { getSeatBgClass, getSeatBorderClass, getSeatTextClass } from "@/lib/seatColors";

export type SeatType = "normal" | "free" | "disabled";

export type SeatItem = {
  id?: string; localId: string;
  label: string; xPct: number; yPct: number;
  section: string;
  seatType: SeatType;
  shiftSlot: string; // "" | "早番" | "遅番"
};
export type WallItem = {
  id?: string; localId: string;
  x1Pct: number; y1Pct: number; x2Pct: number; y2Pct: number;
};

const SECTIONS = ["SV", "査定", "販売", "MOTA", "ローン", "リメイク", ""];
const CARD_W = 76;   // カード幅 + 余白
const CARD_H = 62;   // カード高 + 余白
const CANVAS_MIN_W = 1800;
const CANVAS_MIN_H = 1200;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ── ポップオーバー（席クリック時） ───────────────────────
function SeatPopover({
  seat, onUpdate, onDuplicate, onDelete, onClose,
}: {
  seat: SeatItem;
  onUpdate: (p: Partial<SeatItem>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [onClose]);

  const above = seat.yPct > 50;
  return (
    <div
      ref={ref}
      onPointerDown={e => e.stopPropagation()}
      style={{
        position: "absolute",
        left: `${seat.xPct}%`, top: above ? `calc(${seat.yPct}% - 34px)` : `calc(${seat.yPct}% + 34px)`,
        transform: above ? "translate(-50%,-100%)" : "translate(-50%,0)",
        zIndex: 40,
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
        <input type="text" value={seat.label} onChange={e => onUpdate({ label: e.target.value })}
          placeholder="1, A-1 など"
          className="w-full px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
      </div>
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold text-zinc-400">席タイプ</p>
        <select value={seat.seatType} onChange={e => {
          const t = e.target.value as SeatType;
          onUpdate({ seatType: t, ...(t !== "normal" ? { section: "" } : {}) });
        }}
          className="w-full px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-400">
          <option value="normal">通常（セクション指定）</option>
          <option value="free">フリー席（誰でも可）</option>
          <option value="disabled">無効席（使用不可）</option>
        </select>
      </div>
      {seat.seatType === "normal" && (
        <>
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold text-zinc-400">セクション</p>
            <select value={seat.section} onChange={e => onUpdate({ section: e.target.value, shiftSlot: "" })}
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-400">
              {SECTIONS.map(s => <option key={s} value={s}>{s || "（なし）"}</option>)}
            </select>
          </div>
          {seat.section && (
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold text-zinc-400">シフト帯</p>
              <select value={seat.shiftSlot} onChange={e => onUpdate({ shiftSlot: e.target.value })}
                className="w-full px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="">（なし）</option>
                <option value="早番">早番</option>
                <option value="遅番">遅番</option>
              </select>
            </div>
          )}
        </>
      )}
      <div className="flex gap-1.5 pt-0.5">
        <button onClick={onDuplicate}
          className="flex-1 px-2 py-1.5 text-[11px] font-semibold rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 transition-colors">複製</button>
        <button onClick={onDelete}
          className="flex-1 px-2 py-1.5 text-[11px] font-semibold rounded-lg bg-red-50 dark:bg-red-950/40 text-red-500 hover:bg-red-100 transition-colors">削除</button>
      </div>
    </div>
  );
}

// ── メイン ────────────────────────────────────────────────
export default function SeatLayoutEditor({
  projectId, initialSeats, initialWalls = [],
}: {
  projectId: string;
  initialSeats: SeatItem[];
  initialWalls?: WallItem[];
}) {
  const baseId = useId();
  const [seats, setSeats] = useState<SeatItem[]>(initialSeats);
  const [walls, setWalls] = useState<WallItem[]>(initialWalls);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<SeatItem[]>([]);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [mode, setMode] = useState<"select" | "wall">("select");
  const [wallStart, setWallStart] = useState<{ xPct: number; yPct: number } | null>(null);
  const [ghostPos, setGhostPos] = useState<{ xPct: number; yPct: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);

  // Refs
  const scrollRef  = useRef<HTMLDivElement>(null);
  const canvasRef  = useRef<HTMLDivElement>(null);
  const seatDragRef = useRef<string | null>(null);
  const dragOffRef  = useRef({ ox: 0, oy: 0 });
  const didDragRef  = useRef(false);
  const panRef      = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const isPanRef    = useRef(false);
  // マルチドラッグ用：ドラッグ開始時の全選択席の位置
  const multiDragStartRef = useRef<Map<string, { xPct: number; yPct: number }> | null>(null);
  // マルチドラッグ用：ドラッグ中の基準席の開始位置
  const dragStartPosRef = useRef<{ xPct: number; yPct: number } | null>(null);

  // キャンバスサイズ → グリッド計算
  const [canvasSize, setCanvasSize] = useState({ w: CANVAS_MIN_W, h: CANVAS_MIN_H });
  useEffect(() => {
    if (!canvasRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setCanvasSize({ w: width, h: height });
    });
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  const cols  = Math.max(4, Math.floor(canvasSize.w / CARD_W));
  const rows  = Math.max(3, Math.floor(canvasSize.h / CARD_H));
  const stepX = 100 / cols;
  const stepY = 100 / rows;

  const halfX = stepX / 2;
  const halfY = stepY / 2;
  function snapX(x: number) { return Math.round(x / halfX) * halfX; }
  function snapY(y: number) { return Math.round(y / halfY) * halfY; }
  function toKey(x: number, y: number) { return `${snapX(x).toFixed(3)},${snapY(y).toFixed(3)}`; }

  // クライアント座標 → キャンバス %（スクロール補正済）
  function toCanvasPct(clientX: number, clientY: number) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      xPct: clamp((clientX - rect.left) / rect.width  * 100, 0, 100),
      yPct: clamp((clientY - rect.top)  / rect.height * 100, 0, 100),
    };
  }

  // ── 席操作 ───────────────────────────────────────────
  function findFreeCell(nearX: number, nearY: number, excludeIds?: Set<string> | string) {
    const excludeSet = typeof excludeIds === "string"
      ? new Set([excludeIds])
      : excludeIds ?? new Set<string>();
    const occupied = new Set(
      seats.filter(s => !excludeSet.has(s.localId)).map(s => toKey(s.xPct, s.yPct))
    );
    for (let d = 0; d <= Math.max(cols, rows); d++) {
      const offsets: [number, number][] = [];
      for (let dc = -d; dc <= d; dc++) offsets.push([dc, -d], [dc, d]);
      for (let dr = -d + 1; dr < d; dr++) offsets.push([-d, dr], [d, dr]);
      for (const [dc, dr] of offsets) {
        const xPct = clamp(snapX(nearX + dc * stepX), stepX / 2, 100 - stepX / 2);
        const yPct = clamp(snapY(nearY + dr * stepY), stepY / 2, 100 - stepY / 2);
        if (!occupied.has(toKey(xPct, yPct))) return { xPct, yPct };
      }
    }
    return { xPct: nearX, yPct: nearY };
  }

  function addSeat() {
    const localId = `${baseId}-${Date.now()}`;
    const maxNum = seats.reduce((m, s) => { const n = parseInt(s.label); return isNaN(n) ? m : Math.max(m, n); }, 0);
    const { xPct, yPct } = findFreeCell(stepX, stepY);
    setSeats(prev => [...prev, { localId, label: `${maxNum + 1}`, xPct, yPct, section: "", seatType: "normal", shiftSlot: "" }]);
    setEditingId(localId);
    setSelectedIds(new Set());
  }

  function removeSeat(localId: string) {
    setSeats(prev => prev.filter(s => s.localId !== localId));
    if (editingId === localId) setEditingId(null);
    setSelectedIds(prev => { const s = new Set(prev); s.delete(localId); return s; });
  }

  function removeSelected() {
    const toRemove = selectedIds.size > 0 ? selectedIds : editingId ? new Set([editingId]) : new Set<string>();
    if (toRemove.size === 0) return;
    setSeats(prev => prev.filter(s => !toRemove.has(s.localId)));
    setSelectedIds(new Set());
    if (editingId && toRemove.has(editingId)) setEditingId(null);
  }

  function duplicateSeat(localId: string) {
    const src = seats.find(s => s.localId === localId);
    if (!src) return;
    const maxNum = seats.reduce((m, s) => { const n = parseInt(s.label); return isNaN(n) ? m : Math.max(m, n); }, 0);
    const srcNum = parseInt(src.label);
    const { xPct, yPct } = findFreeCell(src.xPct + stepX, src.yPct, localId);
    const newLocalId = `${baseId}-${Date.now()}`;
    setSeats(prev => [...prev, {
      ...src, id: undefined, localId: newLocalId,
      label: isNaN(srcNum) ? src.label : `${maxNum + 1}`,
      xPct, yPct,
    }]);
    setEditingId(newLocalId);
    setSelectedIds(new Set());
  }

  function updateSeat(localId: string, patch: Partial<SeatItem>) {
    setSeats(prev => prev.map(s => s.localId === localId ? { ...s, ...patch } : s));
  }

  // コピー
  const copySelected = useCallback(() => {
    const ids = selectedIds.size > 0 ? selectedIds : editingId ? new Set([editingId]) : new Set<string>();
    if (ids.size === 0) return;
    setClipboard(seats.filter(s => ids.has(s.localId)));
  }, [selectedIds, editingId, seats]);

  // ペースト
  const pasteClipboard = useCallback(() => {
    if (clipboard.length === 0) return;
    const now = Date.now();
    const maxNum = seats.reduce((m, s) => { const n = parseInt(s.label); return isNaN(n) ? m : Math.max(m, n); }, 0);
    let maxLabelNum = maxNum;
    const newSeats: SeatItem[] = [];
    const newIds = new Set<string>();
    // 全席のocupied集合（順次追加していく）
    const occupied = new Set(seats.map(s => toKey(s.xPct, s.yPct)));
    clipboard.forEach((src, i) => {
      // 貼り付け位置：元の位置 + 1グリッド右下
      let nearX = src.xPct + stepX;
      let nearY = src.yPct + stepY;
      // 空きセルを探す
      let placed = false;
      outer:
      for (let d = 0; d <= Math.max(cols, rows); d++) {
        const offsets: [number, number][] = [];
        for (let dc = -d; dc <= d; dc++) offsets.push([dc, -d], [dc, d]);
        for (let dr = -d + 1; dr < d; dr++) offsets.push([-d, dr], [d, dr]);
        for (const [dc, dr] of offsets) {
          const xPct = clamp(snapX(nearX + dc * stepX), stepX / 2, 100 - stepX / 2);
          const yPct = clamp(snapY(nearY + dr * stepY), stepY / 2, 100 - stepY / 2);
          if (!occupied.has(toKey(xPct, yPct))) {
            const srcNum = parseInt(src.label);
            maxLabelNum++;
            const newLocalId = `${baseId}-${now + i}`;
            newSeats.push({ ...src, id: undefined, localId: newLocalId, xPct, yPct, label: isNaN(srcNum) ? src.label : `${maxLabelNum}` });
            newIds.add(newLocalId);
            occupied.add(toKey(xPct, yPct));
            placed = true;
            break outer;
          }
        }
      }
      if (!placed) {
        const newLocalId = `${baseId}-${now + i}`;
        newSeats.push({ ...src, id: undefined, localId: newLocalId });
        newIds.add(newLocalId);
      }
    });
    setSeats(prev => [...prev, ...newSeats]);
    setSelectedIds(newIds);
    setEditingId(null);
  }, [clipboard, seats, baseId, cols, rows, stepX, stepY]);

  // 全選択
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(seats.map(s => s.localId)));
    setEditingId(null);
  }, [seats]);

  // ── 壁操作 ───────────────────────────────────────────
  function removeWall(localId: string) {
    setWalls(prev => prev.filter(w => w.localId !== localId));
    if (selectedWallId === localId) setSelectedWallId(null);
  }

  function cancelWall() {
    setWallStart(null); setGhostPos(null); setMode("select");
  }

  // ── キーボードショートカット ─────────────────────────
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      if (e.key === "Escape") {
        setWallStart(null); setGhostPos(null);
        if (mode === "wall") setMode("select");
        setSelectedWallId(null); setEditingId(null);
        setSelectedIds(new Set());
        return;
      }

      // 入力フォーカス中はショートカット無効
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "SELECT" || active.tagName === "TEXTAREA")) return;

      if (ctrl && e.key === "a") {
        e.preventDefault();
        selectAll();
        return;
      }
      if (ctrl && e.key === "c") {
        e.preventDefault();
        copySelected();
        return;
      }
      if (ctrl && e.key === "v") {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelected();
        return;
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [mode, copySelected, pasteClipboard, selectAll, selectedIds, editingId]);

  // ── キャンバス PointerDown ────────────────────────────
  function handleCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const seatEl = target.closest("[data-seat-id]") as HTMLElement | null;
    const isCtrl = e.ctrlKey || e.metaKey;

    // 席クリック / ドラッグ
    if (seatEl) {
      e.preventDefault();
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      const localId = seatEl.dataset.seatId!;

      if (isCtrl) {
        // Ctrl+Click: 選択トグル（ポップオーバーは開かない）
        setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(localId)) next.delete(localId);
          else next.add(localId);
          return next;
        });
        setEditingId(null);
        // ドラッグは不要（Ctrl+クリックは選択のみ）
        seatDragRef.current = null;
        return;
      }

      seatDragRef.current = localId;
      didDragRef.current  = false;
      const rect = canvasRef.current!.getBoundingClientRect();
      const seat = seats.find(s => s.localId === localId)!;
      dragOffRef.current = {
        ox: e.clientX - rect.left - (seat.xPct / 100) * rect.width,
        oy: e.clientY - rect.top  - (seat.yPct / 100) * rect.height,
      };

      // マルチドラッグ準備：選択中の複数席をまとめて動かす
      if (selectedIds.has(localId) && selectedIds.size > 1) {
        const startMap = new Map<string, { xPct: number; yPct: number }>();
        seats.forEach(s => {
          if (selectedIds.has(s.localId)) startMap.set(s.localId, { xPct: s.xPct, yPct: s.yPct });
        });
        multiDragStartRef.current = startMap;
        dragStartPosRef.current = { xPct: seat.xPct, yPct: seat.yPct };
      } else {
        multiDragStartRef.current = null;
        dragStartPosRef.current = null;
      }
      return;
    }

    // 壁モード：クリックで点を打つ
    if (mode === "wall") {
      const { xPct, yPct } = toCanvasPct(e.clientX, e.clientY);
      const sx = clamp(snapX(xPct), 0, 100);
      const sy = clamp(snapY(yPct), 0, 100);
      if (!wallStart) {
        setWallStart({ xPct: sx, yPct: sy });
      } else {
        const localId = `w-${baseId}-${Date.now()}`;
        setWalls(prev => [...prev, {
          localId, x1Pct: wallStart.xPct, y1Pct: wallStart.yPct, x2Pct: sx, y2Pct: sy,
        }]);
        setWallStart({ xPct: sx, yPct: sy }); // 連続して引ける
      }
      return;
    }

    // 選択モード：空き部分をドラッグでパン
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    panRef.current = {
      x: e.clientX, y: e.clientY,
      sl: scrollRef.current!.scrollLeft,
      st: scrollRef.current!.scrollTop,
    };
    isPanRef.current = false;
    setSelectedWallId(null);
    setEditingId(null);
    if (!isCtrl) setSelectedIds(new Set());
  }

  // ── キャンバス PointerMove ───────────────────────────
  function handleCanvasPointerMove(e: React.PointerEvent) {
    // 壁モードのゴースト
    if (mode === "wall" && wallStart) {
      const { xPct, yPct } = toCanvasPct(e.clientX, e.clientY);
      setGhostPos({ xPct: clamp(snapX(xPct), 0, 100), yPct: clamp(snapY(yPct), 0, 100) });
    }

    // 席ドラッグ
    if (seatDragRef.current) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const dx = e.clientX - rect.left - dragOffRef.current.ox;
      const dy = e.clientY - rect.top  - dragOffRef.current.oy;
      if (!didDragRef.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        didDragRef.current = true;
        setEditingId(null);
      }
      if (!didDragRef.current) return;

      const rawX = clamp(dx / rect.width  * 100, 0, 100);
      const rawY = clamp(dy / rect.height * 100, 0, 100);
      const xPct = clamp(snapX(rawX), stepX / 2, 100 - stepX / 2);
      const yPct = clamp(snapY(rawY), stepY / 2, 100 - stepY / 2);

      // マルチドラッグ（複数席を同時移動）
      if (multiDragStartRef.current && dragStartPosRef.current) {
        const deltaX = xPct - dragStartPosRef.current.xPct;
        const deltaY = yPct - dragStartPosRef.current.yPct;
        setSeats(prev => prev.map(s => {
          const start = multiDragStartRef.current!.get(s.localId);
          if (!start) return s;
          return {
            ...s,
            xPct: clamp(snapX(start.xPct + deltaX), stepX / 2, 100 - stepX / 2),
            yPct: clamp(snapY(start.yPct + deltaY), stepY / 2, 100 - stepY / 2),
          };
        }));
        return;
      }

      // 通常ドラッグ（1席）
      setSeats(prev => {
        const occupied = prev.some(
          s => s.localId !== seatDragRef.current && toKey(s.xPct, s.yPct) === toKey(xPct, yPct)
        );
        if (occupied) return prev;
        return prev.map(s => s.localId === seatDragRef.current ? { ...s, xPct, yPct } : s);
      });
      return;
    }

    // パン
    if (panRef.current) {
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      if (!isPanRef.current && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) isPanRef.current = true;
      scrollRef.current!.scrollLeft = panRef.current.sl - dx;
      scrollRef.current!.scrollTop  = panRef.current.st - dy;
    }
  }

  // ── キャンバス PointerUp ─────────────────────────────
  function handleCanvasPointerUp(e: React.PointerEvent) {
    void e;
    if (seatDragRef.current) {
      const localId = seatDragRef.current;
      const wasDrag = didDragRef.current;
      seatDragRef.current = null;
      didDragRef.current = false;
      multiDragStartRef.current = null;
      dragStartPosRef.current = null;
      if (!wasDrag) {
        // クリック確定 → ポップオーバー表示（選択解除して1席だけ）
        setSelectedIds(new Set());
        setEditingId(prev => prev === localId ? null : localId);
      }
      return;
    }
    panRef.current = null; isPanRef.current = false;
  }

  // ── 保存 ─────────────────────────────────────────────
  function handleSave() {
    startTransition(async () => {
      const [r1, r2] = await Promise.all([
        saveSeatLayoutAction(projectId, seats.map(s => ({
          id: s.id, label: s.label, xPct: s.xPct, yPct: s.yPct, section: s.section, seatType: s.seatType, shiftSlot: s.shiftSlot,
        }))),
        saveSeatWallsAction(projectId, walls.map(w => ({
          id: w.id, x1Pct: w.x1Pct, y1Pct: w.y1Pct, x2Pct: w.x2Pct, y2Pct: w.y2Pct,
        }))),
      ]);
      const ok  = r1.success && r2.success;
      const msg = ok ? "保存しました" : (r1.message ?? r2.message ?? "エラー");
      setFlash({ ok, msg });
      setTimeout(() => setFlash(null), 3000);
    });
  }

  const editing = editingId ? seats.find(s => s.localId === editingId) : null;
  const selectedWall = selectedWallId ? walls.find(w => w.localId === selectedWallId) : null;
  const selCount = selectedIds.size;

  return (
    <div className="space-y-3">
      {/* ── ツールバー ── */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={addSeat}
          className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 transition-colors">
          ＋ 席を追加
        </button>

        {mode === "select" ? (
          <button onClick={() => { setMode("wall"); setSelectedWallId(null); setEditingId(null); }}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 border border-zinc-200 dark:border-zinc-700 transition-colors">
            ✏️ 壁を追加
          </button>
        ) : (
          <button onClick={cancelWall}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 transition-colors">
            {wallStart ? "クリックで終点を打つ（Escでキャンセル）" : "始点をクリック（Escでキャンセル）"}
          </button>
        )}

        {selectedWall && (
          <button onClick={() => removeWall(selectedWall.localId)}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-red-50 dark:bg-red-950/40 text-red-500 hover:bg-red-100 border border-red-200 dark:border-red-800 transition-colors">
            選択中の壁を削除
          </button>
        )}

        {/* 複数席選択中のアクションバー */}
        {selCount > 1 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-700">
            <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{selCount}席選択中</span>
            <button onClick={copySelected}
              className="px-2 py-0.5 text-xs font-semibold rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 transition-colors">
              コピー
            </button>
            <button onClick={removeSelected}
              className="px-2 py-0.5 text-xs font-semibold rounded-lg bg-red-50 dark:bg-red-950/40 text-red-500 hover:bg-red-100 transition-colors">
              削除
            </button>
            <button onClick={() => setSelectedIds(new Set())}
              className="px-2 py-0.5 text-xs font-semibold rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-500 hover:bg-zinc-200 transition-colors">
              解除
            </button>
          </div>
        )}

        {clipboard.length > 0 && selCount === 0 && (
          <button onClick={pasteClipboard}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 hover:bg-emerald-100 transition-colors">
            貼り付け（{clipboard.length}席）
          </button>
        )}

        <button onClick={handleSave} disabled={isPending}
          className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors">
          {isPending ? "保存中…" : "レイアウト保存"}
        </button>

        {flash && (
          <span className={`text-xs font-medium ${flash.ok ? "text-emerald-600" : "text-red-500"}`}>
            {flash.ok ? "✓ " : "✗ "}{flash.msg}
          </span>
        )}
        <span className="text-xs text-zinc-400 ml-auto">
          {seats.length}席（うちフリー{seats.filter(s=>s.seatType==="free").length}・無効{seats.filter(s=>s.seatType==="disabled").length}）／ {walls.length}本の壁
        </span>
      </div>

      {/* ── スクロールコンテナ ── */}
      <div
        ref={scrollRef}
        className="rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-auto"
        style={{ maxHeight: 620, cursor: mode === "wall" ? "crosshair" : isPanRef.current ? "grabbing" : "grab" }}
      >
        {/* キャンバス（大きめ固定） */}
        <div
          ref={canvasRef}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerLeave={handleCanvasPointerUp}
          className="relative bg-zinc-50 dark:bg-zinc-900 touch-none select-none"
          style={{ minWidth: CANVAS_MIN_W, minHeight: CANVAS_MIN_H }}
        >
          {/* ── SVGレイヤー（グリッドドット + 壁） ── */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
            {/* グリッドドット */}
            {Array.from({ length: cols + 1 }, (_, c) =>
              Array.from({ length: rows + 1 }, (_, r) => (
                <circle key={`${c}-${r}`}
                  cx={`${(c / cols) * 100}%`} cy={`${(r / rows) * 100}%`}
                  r="1.5" className="fill-zinc-300 dark:fill-zinc-600" />
              ))
            )}

            {/* 既存の壁 */}
            {walls.map(w => (
              <g key={w.localId}
                style={{ pointerEvents: "all", cursor: "pointer" }}
                onPointerDown={e => {
                  e.stopPropagation();
                  if (mode === "select") setSelectedWallId(prev => prev === w.localId ? null : w.localId);
                }}>
                {/* ヒットエリア（太い透明線） */}
                <line x1={`${w.x1Pct}%`} y1={`${w.y1Pct}%`} x2={`${w.x2Pct}%`} y2={`${w.y2Pct}%`}
                  stroke="transparent" strokeWidth="14" />
                {/* 見た目の線 */}
                <line x1={`${w.x1Pct}%`} y1={`${w.y1Pct}%`} x2={`${w.x2Pct}%`} y2={`${w.y2Pct}%`}
                  stroke={selectedWallId === w.localId ? "#3b82f6" : "#71717a"}
                  strokeWidth={selectedWallId === w.localId ? 3 : 2}
                  strokeLinecap="round" />
              </g>
            ))}

            {/* ゴースト壁（描画中プレビュー） */}
            {mode === "wall" && wallStart && ghostPos && (
              <line
                x1={`${wallStart.xPct}%`} y1={`${wallStart.yPct}%`}
                x2={`${ghostPos.xPct}%`}  y2={`${ghostPos.yPct}%`}
                stroke="#3b82f6" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round"
                style={{ pointerEvents: "none" }}
              />
            )}

            {/* 始点マーカー */}
            {mode === "wall" && wallStart && (
              <circle cx={`${wallStart.xPct}%`} cy={`${wallStart.yPct}%`}
                r="5" fill="#3b82f6" style={{ pointerEvents: "none" }} />
            )}
          </svg>

          {/* ── 席カード ── */}
          {seats.map(seat => {
            const isDisabled = seat.seatType === "disabled";
            const isFree     = seat.seatType === "free";
            const isSelected = selectedIds.has(seat.localId);
            const isEditing  = editingId === seat.localId;
            return (
              <div
                key={seat.localId}
                data-seat-id={seat.localId}
                style={{
                  position: "absolute",
                  left: `${seat.xPct}%`, top: `${seat.yPct}%`,
                  transform: "translate(-50%,-50%)",
                  width:  `calc(${stepX}% - 8px)`,
                  height: `calc(${stepY}% - 8px)`,
                  zIndex: isEditing || isSelected ? 15 : 10,
                  cursor: mode === "wall" ? "crosshair" : "grab",
                  outline: isSelected ? "2px solid #3b82f6" : "none",
                  outlineOffset: "2px",
                  borderRadius: "12px",
                }}
                className={[
                  "rounded-xl border-2 flex flex-col items-center justify-center transition-shadow overflow-hidden",
                  isEditing
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 shadow-lg"
                    : isDisabled
                    ? "border-zinc-400 dark:border-zinc-500 bg-zinc-200 dark:bg-zinc-700 shadow-sm opacity-60"
                    : isFree
                    ? "border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 shadow-sm"
                    : seat.section
                    ? `${getSeatBorderClass(seat.section)} ${getSeatBgClass(seat.section, seat.shiftSlot || null)} shadow-sm`
                    : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 hover:border-zinc-400 shadow-sm",
                ].join(" ")}
              >
                <span className={[
                  "text-[10px] font-bold pointer-events-none leading-tight",
                  isDisabled
                    ? "text-zinc-400 dark:text-zinc-500"
                    : isFree
                    ? "text-emerald-800 dark:text-emerald-200"
                    : getSeatTextClass(seat.section),
                ].join(" ")}>
                  {seat.label || "－"}
                </span>
                {isDisabled ? (
                  <span className="text-[8px] text-zinc-400 pointer-events-none leading-tight">無効</span>
                ) : isFree ? (
                  <span className="text-[8px] text-emerald-600 pointer-events-none leading-tight">FREE</span>
                ) : seat.section ? (
                  <span className="text-[9px] opacity-60 pointer-events-none leading-tight">
                    {seat.section}{seat.shiftSlot ? `・${seat.shiftSlot}` : ""}
                  </span>
                ) : null}
              </div>
            );
          })}

          {/* ── ポップオーバー ── */}
          {editing && (
            <SeatPopover
              seat={editing}
              onUpdate={p => updateSeat(editing.localId, p)}
              onDuplicate={() => duplicateSeat(editing.localId)}
              onDelete={() => removeSeat(editing.localId)}
              onClose={() => setEditingId(null)}
            />
          )}
        </div>
      </div>

      <p className="text-[11px] text-zinc-400">
        席クリック：設定　／　Ctrl+クリック：複数選択　／　Ctrl+A：全選択　／　Ctrl+C/V：コピー&ペースト　／　Delete：削除　／　空き部分ドラッグ：スクロール
      </p>
    </div>
  );
}
