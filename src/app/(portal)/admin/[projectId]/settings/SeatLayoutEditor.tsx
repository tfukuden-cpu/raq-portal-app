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

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ── カード上のポップオーバー ──────────────────────────────
function SeatPopover({
  seat,
  canvasRef,
  onUpdate,
  onDuplicate,
  onDelete,
  onClose,
}: {
  seat: SeatItem;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  onUpdate: (patch: Partial<SeatItem>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);

  // キャンバス外クリックで閉じる
  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        // カード自体のクリックは SeatCard 側で制御するので、ここでは閉じるだけ
        onClose();
      }
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [onClose]);

  // ポップオーバーをカードの上 or 下に出す（yPct が 50 より大きければ上）
  const above = seat.yPct > 50;

  return (
    <div
      ref={popRef}
      // ポインターイベントを通さないようにして drag 邪魔しない
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
      {/* 小三角 */}
      <div
        className={[
          "absolute left-1/2 -translate-x-1/2 w-0 h-0",
          above
            ? "bottom-[-6px] border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-zinc-200 dark:border-t-zinc-700"
            : "top-[-6px] border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-zinc-200 dark:border-b-zinc-700",
        ].join(" ")}
      />

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

      {/* アクションボタン */}
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
  const didDragRef  = useRef(false); // ドラッグ判定フラグ

  // ── ドラッグ ──────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent, localId: string) => {
    // ポップオーバー内のクリックは無視
    if ((e.target as HTMLElement).closest(".seat-popover")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = localId;
    didDragRef.current = false;
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
    // 5px 以上動いたらドラッグとみなす
    if (!didDragRef.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      didDragRef.current = true;
      setEditingId(null); // ドラッグ開始時にポップオーバーを閉じる
    }
    if (!didDragRef.current) return;
    const xPct = clamp((dx / rect.width)  * 100, 3, 97);
    const yPct = clamp((dy / rect.height) * 100, 3, 97);
    setSeats(prev => prev.map(s =>
      s.localId === draggingRef.current ? { ...s, xPct, yPct } : s
    ));
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent, localId: string) => {
    const wasDrag = didDragRef.current;
    draggingRef.current = null;
    didDragRef.current = false;
    if (!wasDrag) {
      // クリックとみなす → ポップオーバーをトグル
      setEditingId(prev => prev === localId ? null : localId);
    }
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

  function duplicateSeat(localId: string) {
    const src = seats.find(s => s.localId === localId);
    if (!src) return;
    const newLocalId = `${baseId}-${Date.now()}`;
    const newSeat: SeatItem = {
      ...src,
      id: undefined, // DBのIDは持たせない（新規扱い）
      localId: newLocalId,
      xPct: clamp(src.xPct + 5, 3, 97),
      yPct: clamp(src.yPct + 5, 3, 97),
    };
    setSeats(prev => [...prev, newSeat]);
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
        className="relative w-full bg-zinc-50 dark:bg-zinc-900 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 touch-none overflow-visible"
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
            onPointerUp={e => handlePointerUp(e, seat.localId)}
            style={{ left: `${seat.xPct}%`, top: `${seat.yPct}%`, transform: "translate(-50%, -50%)" }}
            className={[
              "absolute w-[68px] h-[54px] rounded-xl border-2 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing select-none",
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

        {/* ポップオーバー（選択中の席に追随） */}
        {editing && (
          <div className="seat-popover">
            <SeatPopover
              seat={editing}
              canvasRef={canvasRef}
              onUpdate={patch => updateSeat(editing.localId, patch)}
              onDuplicate={() => duplicateSeat(editing.localId)}
              onDelete={() => removeSeat(editing.localId)}
              onClose={() => setEditingId(null)}
            />
          </div>
        )}
      </div>

      <p className="text-[11px] text-zinc-400">
        席をクリック → ラベル・セクション設定・複製／削除　／　ドラッグで移動
      </p>
    </div>
  );
}
