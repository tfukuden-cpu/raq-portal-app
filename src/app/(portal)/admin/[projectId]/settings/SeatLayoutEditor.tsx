"use client";

import { useState, useRef, useTransition, useCallback, useId } from "react";
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

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

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

  const canvasRef    = useRef<HTMLDivElement>(null);
  const draggingRef  = useRef<string | null>(null);
  const dragOffRef   = useRef<{ ox: number; oy: number }>({ ox: 0, oy: 0 });

  // ── ドラッグ ──────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent, localId: string) => {
    if ((e.target as HTMLElement).closest("input,select,button.delete-btn")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = localId;
    const rect = canvasRef.current!.getBoundingClientRect();
    const seat = seats.find(s => s.localId === localId)!;
    dragOffRef.current = {
      ox: e.clientX - rect.left - (seat.xPct / 100) * rect.width,
      oy: e.clientY - rect.top  - (seat.yPct / 100) * rect.height,
    };
    setEditingId(null);
  }, [seats]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const xPct = clamp(((e.clientX - rect.left - dragOffRef.current.ox) / rect.width)  * 100, 3, 97);
    const yPct = clamp(((e.clientY - rect.top  - dragOffRef.current.oy) / rect.height) * 100, 3, 97);
    setSeats(prev => prev.map(s =>
      s.localId === draggingRef.current ? { ...s, xPct, yPct } : s
    ));
  }, []);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  // ── 席追加 ────────────────────────────────────────────
  function addSeat() {
    const localId = `${baseId}-${Date.now()}`;
    setSeats(prev => [
      ...prev,
      { localId, label: `${prev.length + 1}`, xPct: 50, yPct: 50, section: "" },
    ]);
    setEditingId(localId);
  }

  function removeSeat(localId: string) {
    setSeats(prev => prev.filter(s => s.localId !== localId));
    if (editingId === localId) setEditingId(null);
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
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="relative w-full bg-zinc-50 dark:bg-zinc-900 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 touch-none"
        style={{ aspectRatio: "4/3", minHeight: 240 }}
      >
        {seats.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
            「席を追加」してドラッグで配置
          </p>
        )}
        {seats.map(seat => (
          <div
            key={seat.localId}
            onPointerDown={e => handlePointerDown(e, seat.localId)}
            onClick={() => setEditingId(id => id === seat.localId ? null : seat.localId)}
            style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
            className={[
              "absolute w-[68px] h-[54px] rounded-xl border-2 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing select-none",
              editingId === seat.localId
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 shadow-lg"
                : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 hover:border-zinc-400 shadow-sm",
            ].join(" ")}
          >
            <span className="text-[10px] font-bold text-zinc-700 dark:text-zinc-200">{seat.label || "－"}</span>
            {seat.section && (
              <span className="text-[9px] text-zinc-400">{seat.section}</span>
            )}
            <button
              className="delete-btn absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-zinc-400 hover:bg-red-500 text-white text-[10px] flex items-center justify-center leading-none"
              onClick={e => { e.stopPropagation(); removeSeat(seat.localId); }}
            >×</button>
          </div>
        ))}
      </div>

      {/* 選択中席の編集フォーム */}
      {editing && (
        <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">席の設定</p>
          <div className="flex gap-3 flex-wrap">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-zinc-400">席ラベル</span>
              <input
                type="text"
                value={editing.label}
                onChange={e => updateSeat(editing.localId, { label: e.target.value })}
                className="w-20 px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100"
                placeholder="1, A-1 など"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-zinc-400">セクション</span>
              <select
                value={editing.section}
                onChange={e => updateSeat(editing.localId, { section: e.target.value })}
                className="px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100"
              >
                {SECTIONS.map(s => (
                  <option key={s} value={s}>{s || "（なし）"}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-zinc-400">X位置 %</span>
              <input
                type="number" min={3} max={97} step={1}
                value={Math.round(editing.xPct)}
                onChange={e => updateSeat(editing.localId, { xPct: clamp(Number(e.target.value), 3, 97) })}
                className="w-16 px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-zinc-400">Y位置 %</span>
              <input
                type="number" min={3} max={97} step={1}
                value={Math.round(editing.yPct)}
                onChange={e => updateSeat(editing.localId, { yPct: clamp(Number(e.target.value), 3, 97) })}
                className="w-16 px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
