"use client";

import { useState, useTransition } from "react";
import { RpgWindow, BlinkCursor, dotGothic, RPG_PAGE_BG, RPG_KEYFRAMES, RpgStarfield } from "@/components/rpg-ui";
import { RPG_MONSTERS, monsterImg, monsterById, type Monster, type MonsterRarity } from "@/lib/rpg-chars";
import {
  RARITY_INFO, RARITY_RATES,
  GACHA_COST_SINGLE, GACHA_COST_TEN,
} from "@/lib/gacha";
import { drawGachaAction, setActivePartnerAction, type GachaState } from "./actions";

const GACHA_KEYFRAMES = `
@keyframes gachaPop { 0% { transform: scale(0) rotate(-12deg); opacity: 0; } 70% { transform: scale(1.12) rotate(3deg); } 100% { transform: scale(1) rotate(0); opacity: 1; } }
@keyframes gachaShake { 0%,100% { transform: translateX(0) rotate(0); } 20% { transform: translateX(-4px) rotate(-3deg); } 40% { transform: translateX(4px) rotate(3deg); } 60% { transform: translateX(-3px) rotate(-2deg); } 80% { transform: translateX(3px) rotate(2deg); } }
@keyframes gachaGlow { 0%,100% { opacity: .4; } 50% { opacity: 1; } }
`;

function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="inline-block shrink-0">
      <circle cx="12" cy="12" r="10" fill="#fcd34d" stroke="#b45309" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="#b45309" strokeWidth="1.2" opacity="0.7" />
      <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#92400e">G</text>
    </svg>
  );
}

const RARITY_ORDER: MonsterRarity[] = [4, 3, 2, 1];

export default function GachaClient({ initialState }: { initialState: GachaState }) {
  const [coins, setCoins]       = useState(initialState.coins);
  const [owned, setOwned]       = useState(initialState.owned);
  const [activeId, setActiveId] = useState<number | null>(initialState.activePartnerId);
  const [drawing, setDrawing]   = useState(false);
  const [result, setResult]     = useState<Monster[] | null>(null);
  const [newIds, setNewIds]     = useState<Set<number>>(new Set());
  const [revealed, setRevealed] = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [, startTransition]     = useTransition();

  const totalOwned = owned.reduce((a, o) => a + o.count, 0);

  async function draw(mode: "single" | "ten") {
    if (drawing) return;
    setErr(null);
    const cost = mode === "single" ? GACHA_COST_SINGLE : GACHA_COST_TEN;
    if (coins < cost) { setErr("コインが たりません"); return; }

    const prevIds = new Set(owned.map(o => o.monsterId));
    setDrawing(true); setResult(null); setRevealed(false); setNewIds(new Set());

    const r = await drawGachaAction(mode);
    if (!r.ok) {
      setErr(r.message);
      if (r.coins != null) setCoins(r.coins);
      setDrawing(false);
      return;
    }
    setCoins(r.coins);
    // 所持にマージ
    setOwned(prev => {
      const m = new Map(prev.map(o => [o.monsterId, o.count] as const));
      for (const mon of r.monsters) m.set(mon.id, (m.get(mon.id) ?? 0) + 1);
      return [...m.entries()].map(([monsterId, count]) => ({ monsterId, count })).sort((a, b) => a.monsterId - b.monsterId);
    });
    setNewIds(new Set(r.monsters.filter(mon => !prevIds.has(mon.id)).map(mon => mon.id)));
    setResult(r.monsters);
    setTimeout(() => setRevealed(true), 700);
  }

  function closeResult() {
    setDrawing(false);
    setResult(null);
    setRevealed(false);
  }

  function toggleActive(monsterId: number) {
    const next = activeId === monsterId ? null : monsterId;
    setActiveId(next); // 楽観的
    startTransition(async () => {
      const r = await setActivePartnerAction(next);
      if (!r.ok) { setActiveId(activeId); setErr(r.message ?? "設定に失敗しました"); }
    });
  }

  return (
    <main className={`min-h-[100dvh] ${dotGothic.className}`} style={{ background: RPG_PAGE_BG }}>
      <style>{RPG_KEYFRAMES + GACHA_KEYFRAMES}</style>

      {/* ヘッダー */}
      <div className="relative px-4 md:px-8 pt-5 pb-3 overflow-hidden">
        <RpgStarfield />
        <div className="relative flex items-center justify-between gap-3">
          <h1 className="text-[20px] md:text-[22px] text-white">★ ガチャ</h1>
          <span className="flex items-center gap-1.5 text-[14px] text-white bg-[#000846]/80 border border-amber-300/70 rounded px-2.5 py-1 tabular-nums">
            <CoinIcon size={16} />{coins}
          </span>
        </div>
      </div>

      <div className="px-4 md:px-8 pb-36 md:pb-12 max-w-3xl mx-auto space-y-3.5">

        {/* メッセージ */}
        <RpgWindow>
          <div className="px-4 py-3">
            <p className="text-[13px] md:text-[14px] text-white leading-relaxed">
              ＊「コインで モンスターを なかまに しよう！ きにいった コを つれあるけるぞ。<BlinkCursor /></p>
          </div>
        </RpgWindow>

        {/* ガチャ実行 */}
        <RpgWindow title="ガチャを ひく">
          <div className="px-4 py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => draw("single")}
                disabled={drawing || coins < GACHA_COST_SINGLE}
                className="flex flex-col items-center gap-1 rounded-lg border-2 border-white/70 bg-white/5 py-3 hover:bg-white/10 active:scale-95 transition disabled:opacity-40"
              >
                <span className="text-[15px] text-white">たんぱつ</span>
                <span className="flex items-center gap-1 text-[13px] text-amber-300 tabular-nums"><CoinIcon size={13} />{GACHA_COST_SINGLE}</span>
              </button>
              <button
                onClick={() => draw("ten")}
                disabled={drawing || coins < GACHA_COST_TEN}
                className="relative flex flex-col items-center gap-1 rounded-lg border-2 border-amber-300 bg-amber-400/10 py-3 hover:bg-amber-400/20 active:scale-95 transition disabled:opacity-40"
              >
                <span className="absolute -top-2 right-2 text-[9px] text-[#000846] bg-amber-300 rounded px-1.5 py-0.5">★3かくてい</span>
                <span className="text-[15px] text-amber-200">10れん</span>
                <span className="flex items-center gap-1 text-[13px] text-amber-300 tabular-nums"><CoinIcon size={13} />{GACHA_COST_TEN}</span>
              </button>
            </div>
            {err && <p className="text-[12px] text-red-300 text-center">{err}</p>}
            {/* 排出率 */}
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 pt-1">
              {RARITY_ORDER.map(r => (
                <span key={r} className="text-[10px] tabular-nums" style={{ color: RARITY_INFO[r].color }}>
                  {RARITY_INFO[r].stars} {Math.round(RARITY_RATES[r] * 100)}%
                </span>
              ))}
            </div>
          </div>
        </RpgWindow>

        {/* 所持パートナー */}
        <RpgWindow title="てもちの パートナー">
          <div className="px-3 py-3">
            <p className="text-[11px] text-white/55 mb-2 px-1">
              タップで「つれあるく」コを せってい（{owned.length}しゅるい／ぜんぶで {totalOwned}たい・全{RPG_MONSTERS.length}しゅ）
            </p>
            {owned.length === 0 ? (
              <p className="text-[13px] text-white/40 text-center py-6">まだ いない。ガチャを ひいてみよう。</p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                {owned.map(({ monsterId, count }) => {
                  const mon = monsterById(monsterId);
                  if (!mon) return null;
                  const isActive = activeId === monsterId;
                  return (
                    <button
                      key={monsterId}
                      onClick={() => toggleActive(monsterId)}
                      className={`relative flex flex-col items-center rounded-lg border p-1 transition active:scale-95 ${
                        isActive ? "border-amber-300 bg-amber-400/15 ring-2 ring-amber-300/50" : "border-white/25 bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={monsterImg(monsterId)} alt="" draggable={false} loading="lazy" className="h-12 w-auto object-contain select-none" style={{ imageRendering: "pixelated" }} />
                      <span className="text-[9px] leading-tight truncate w-full text-center" style={{ color: RARITY_INFO[mon.rarity].color }}>{mon.label}</span>
                      {count > 1 && (
                        <span className="absolute top-0.5 right-0.5 text-[8px] text-white bg-[#000846]/90 border border-white/40 rounded px-1 tabular-nums">×{count}</span>
                      )}
                      {isActive && (
                        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[8px] text-[#000846] bg-amber-300 rounded px-1.5 whitespace-nowrap">つれてる</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </RpgWindow>
      </div>

      {/* ── 結果オーバーレイ ── */}
      {drawing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(2,4,15,0.92)" }}>
          {!result ? (
            // 演出中
            <div className="flex flex-col items-center gap-4">
              <div style={{ animation: "gachaShake 0.5s ease-in-out infinite" }}>
                <CoinIcon size={64} />
              </div>
              <p className="text-amber-300 text-[15px]" style={{ animation: "gachaGlow 1s ease-in-out infinite" }}>がしゃがしゃ…</p>
            </div>
          ) : (
            <div className="w-full max-w-md">
              <p className="text-center text-white text-[15px] mb-3">★ けっか ★</p>
              <div className={`grid gap-2 ${result.length > 1 ? "grid-cols-5" : "grid-cols-1 justify-items-center"}`}>
                {result.map((mon, i) => (
                  <div
                    key={i}
                    className="relative flex flex-col items-center rounded-lg border-2 p-1.5"
                    style={{
                      borderColor: RARITY_INFO[mon.rarity].color,
                      background: "rgba(0,8,70,0.85)",
                      animation: revealed ? `gachaPop 0.4s ease-out ${i * 0.06}s both` : "none",
                      opacity: revealed ? undefined : 0,
                      width: result.length === 1 ? "9rem" : undefined,
                    }}
                  >
                    {newIds.has(mon.id) && (
                      <span className="absolute -top-2 -left-1 text-[8px] text-[#000846] bg-amber-300 rounded px-1 z-10">NEW</span>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={monsterImg(mon.id)} alt="" draggable={false} className={`w-auto object-contain select-none ${result.length === 1 ? "h-28" : "h-12"}`} style={{ imageRendering: "pixelated" }} />
                    <span className="text-[8px] leading-none" style={{ color: RARITY_INFO[mon.rarity].color }}>{RARITY_INFO[mon.rarity].stars}</span>
                    <span className="text-[9px] text-white leading-tight truncate w-full text-center">{mon.label}</span>
                  </div>
                ))}
              </div>
              {revealed && (
                <div className="mt-4 flex flex-col items-center gap-2">
                  <span className="flex items-center gap-1.5 text-[13px] text-white/70 tabular-nums"><CoinIcon size={13} />のこり {coins}</span>
                  <button onClick={closeResult}
                    className="px-8 py-2.5 rounded-lg border-2 border-white text-white text-[14px] hover:bg-white/10 active:scale-95 transition">
                    とじる
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
