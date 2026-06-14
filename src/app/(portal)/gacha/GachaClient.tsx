"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { RpgWindow, BlinkCursor, dotGothic, RPG_PAGE_BG, RPG_KEYFRAMES, RpgStarfield } from "@/components/rpg-ui";
import { RPG_MONSTERS, monsterImg, monsterById, type Monster, type MonsterRarity } from "@/lib/rpg-chars";
import {
  RARITY_INFO, RARITY_RATES,
  GACHA_COST_SINGLE, GACHA_COST_TEN,
} from "@/lib/gacha";
import { drawGachaAction, setActivePartnerAction, type GachaState } from "./actions";

const GACHA_KEYFRAMES = `
@keyframes gachaPop { 0% { transform: scale(0) rotate(-12deg); opacity: 0; } 70% { transform: scale(1.14) rotate(3deg); } 100% { transform: scale(1) rotate(0); opacity: 1; } }
@keyframes gachaShake { 0%,100% { transform: translateX(0) rotate(0); } 20% { transform: translateX(-4px) rotate(-3deg); } 40% { transform: translateX(4px) rotate(3deg); } 60% { transform: translateX(-3px) rotate(-2deg); } 80% { transform: translateX(3px) rotate(2deg); } }
@keyframes gachaSpinShake { 0%,100% { transform: translateX(-3px) rotate(-5deg); } 50% { transform: translateX(3px) rotate(5deg); } }
@keyframes gachaGlow { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
@keyframes gachaCharge { 0% { transform: translate(-50%,-50%) scale(.25); opacity: .25; } 100% { transform: translate(-50%,-50%) scale(2.6); opacity: .95; } }
@keyframes gachaFlash { 0% { opacity: 0; } 12% { opacity: 1; } 100% { opacity: 0; } }
@keyframes gachaTitle { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
@keyframes gachaRays { to { transform: translate(-50%,-50%) rotate(360deg); } }
@keyframes gachaRing { 0% { transform: translate(-50%,-50%) scale(.3); opacity: .7; } 100% { transform: translate(-50%,-50%) scale(2.4); opacity: 0; } }
@keyframes gachaCapsule { 0% { transform: translateY(-54px) scale(.5); opacity: 0; } 45% { opacity: 1; } 66% { transform: translateY(8px) scale(1.1); } 83% { transform: translateY(-3px); } 100% { transform: translateY(3px) scale(1); opacity: 1; } }
@keyframes gachaBurstFade { 0% { opacity: 0; transform: translate(-50%,-50%) scale(.4) rotate(0); } 25% { opacity: .85; } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1.9) rotate(40deg); } }
@keyframes gachaCapDrop { 0% { transform: translateY(-64px) scale(.5); opacity: 0; } 40% { opacity: 1; } 68% { transform: translateY(10px) scale(1.08); } 84% { transform: translateY(-5px); } 100% { transform: translateY(0) scale(1); opacity: 1; } }
@keyframes gachaCapShake { 0%,100% { transform: rotate(-7deg); } 50% { transform: rotate(7deg); } }
@keyframes gachaHalfTop { 0% { transform: translateY(0) rotate(0); opacity: 1; } 100% { transform: translate(-44px,-150px) rotate(-42deg); opacity: 0; } }
@keyframes gachaHalfBot { 0% { transform: translateY(0) rotate(0); opacity: 1; } 100% { transform: translate(44px,140px) rotate(42deg); opacity: 0; } }
@keyframes gachaSpark { 0% { transform: translate(-50%,-50%) scale(0); opacity: 1; } 30% { opacity: 1; } 100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(1); opacity: 0; } }
`;

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const SPARK_DIRS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  const dist = 95 + (i % 3) * 26;
  return { tx: Math.round(Math.cos(a) * dist), ty: Math.round(Math.sin(a) * dist) };
});


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
  const [phase, setPhase]       = useState<"idle" | "spin" | "charge" | "reveal">("idle");
  const [bestRarity, setBestRarity] = useState<MonsterRarity>(1);
  const [result, setResult]     = useState<Monster[] | null>(null);
  const [newIds, setNewIds]     = useState<Set<number>>(new Set());
  const [err, setErr]           = useState<string | null>(null);
  const [, startTransition]     = useTransition();

  const busy = phase !== "idle";
  const rareColor = RARITY_INFO[bestRarity].color;
  const totalOwned = owned.reduce((a, o) => a + o.count, 0);

  async function draw(mode: "single" | "ten") {
    if (busy) return;
    setErr(null);
    const cost = mode === "single" ? GACHA_COST_SINGLE : GACHA_COST_TEN;
    if (coins < cost) { setErr("コインが たりません"); return; }

    const prevIds = new Set(owned.map(o => o.monsterId));
    setResult(null); setNewIds(new Set()); setPhase("spin");
    const startedAt = Date.now();

    const r = await drawGachaAction(mode);
    if (!r.ok) {
      setErr(r.message);
      if (r.coins != null) setCoins(r.coins);
      setPhase("idle");
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

    const best = Math.max(...r.monsters.map(mon => mon.rarity)) as MonsterRarity;
    const goVideo = () => {
      setBestRarity(best);
      setResult(r.monsters);
      setPhase("charge"); // charge = 召喚ムービー再生フェーズ
      // 動画が onEnded を出さない/読み込み失敗時のフォールバック（動画5秒＋余裕）
      setTimeout(() => setPhase(p => (p === "charge" ? "reveal" : p)), 6500);
    };
    const remain = 900 - (Date.now() - startedAt);
    if (remain > 0) setTimeout(goVideo, remain); else goVideo();
  }

  function closeResult() {
    setPhase("idle");
    setResult(null);
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
            <div className="relative flex justify-center py-1">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none" style={{ width: 160, height: 160, background: "radial-gradient(circle, rgba(252,211,77,0.30) 0%, transparent 70%)" }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/rpg/gacha-machine.png" alt="" draggable={false} className="relative h-32 md:h-40 w-auto select-none drop-shadow-[0_6px_14px_rgba(0,0,0,0.55)]" style={{ imageRendering: "pixelated" }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => draw("single")}
                disabled={busy || coins< GACHA_COST_SINGLE}
                className="flex flex-col items-center gap-1 rounded-lg border-2 border-white/70 bg-white/5 py-3 hover:bg-white/10 active:scale-95 transition disabled:opacity-40"
              >
                <span className="text-[15px] text-white">たんぱつ</span>
                <span className="flex items-center gap-1 text-[13px] text-amber-300 tabular-nums"><CoinIcon size={13} />{GACHA_COST_SINGLE}</span>
              </button>
              <button
                onClick={() => draw("ten")}
                disabled={busy || coins< GACHA_COST_TEN}
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

      {/* ── ガチャ演出オーバーレイ（回転→チャージ→フラッシュ→公開） ── */}
      {busy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden" style={{ background: "rgba(2,4,15,0.94)" }}>

          {/* 公開時の白フラッシュ */}
          {phase === "reveal" && (
            <div className="absolute inset-0 pointer-events-none" style={{ background: "#fff", animation: "gachaFlash 0.5s ease-out forwards" }} />
          )}

          {/* 待機：マシンが揺れる */}
          {phase === "spin" && (
            <div className="relative flex flex-col items-center gap-5">
              <div className="absolute top-1/2 left-1/2 rounded-full pointer-events-none" style={{ width: 200, height: 200, transform: "translate(-50%,-50%)", background: "radial-gradient(circle, #ffffff 0%, transparent 70%)", animation: "gachaGlow 1.1s ease-in-out infinite" }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/rpg/gacha-machine.png" alt="" draggable={false} className="relative h-44 w-auto select-none drop-shadow-[0_6px_16px_rgba(0,0,0,0.6)]" style={{ imageRendering: "pixelated", animation: "gachaShake 0.5s ease-in-out infinite" }} />
              <p className="relative text-amber-300 text-[15px]" style={{ animation: "gachaGlow 1s ease-in-out infinite" }}>がしゃがしゃ…</p>
            </div>
          )}

          {/* 召喚ムービー（全画面・タップでスキップ） */}
          {phase === "charge" && (
            <div className="absolute inset-0 bg-black" onClick={() => setPhase("reveal")}>
              <video autoPlay muted playsInline preload="auto" onEnded={() => setPhase("reveal")} className="w-full h-full object-cover">
                <source src="/rpg/gacha-summon.mp4" type="video/mp4" />
              </video>
              <span className="absolute bottom-7 left-1/2 -translate-x-1/2 text-[12px] text-white/75 bg-black/45 rounded-full px-3.5 py-1">タップで スキップ ▶</span>
            </div>
          )}

          {phase === "reveal" && result && (
            <div className="relative w-full max-w-md">
              {/* レア色の発光 */}
              <div className="absolute top-[40%] left-1/2 pointer-events-none -z-10" style={{
                width: 300, height: 300, transform: "translate(-50%,-50%)", borderRadius: "50%",
                background: `radial-gradient(circle, ${rareColor} 0%, transparent 62%)`,
                animation: "gachaBurstFade 0.9s ease-out forwards",
              }} />
              {/* 金の閃光バースト */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/rpg/gacha-flare.png" alt="" draggable={false} className="absolute top-[40%] left-1/2 pointer-events-none -z-10 select-none" style={{
                width: 540, height: 540, transform: "translate(-50%,-50%)", mixBlendMode: "screen",
                animation: "gachaBurstFade 0.9s ease-out forwards, gachaRays 9s linear infinite",
              }} />
              {/* キラキラ粒子の飛散 */}
              {SPARK_DIRS.map((d, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src="/rpg/gacha-spark.png" alt="" draggable={false} className="absolute top-[40%] left-1/2 pointer-events-none -z-10 select-none"
                  style={{
                    width: 48, height: 48, mixBlendMode: "screen",
                    "--tx": `${d.tx}px`, "--ty": `${d.ty}px`,
                    animation: "gachaSpark 0.8s ease-out 0.05s both",
                  } as CSSVars} />
              ))}
              {bestRarity === 4 && (
                <p className="text-center text-[13px] mb-1" style={{ color: rareColor, animation: "gachaTitle 0.5s ease-out 0.15s both", textShadow: `0 0 8px ${rareColor}` }}>
                  ☆★ ウルトラレア とうじょう！ ★☆
                </p>
              )}
              <p className="text-center text-white text-[16px] mb-3" style={{ animation: "gachaTitle 0.4s ease-out both" }}>★ けっか ★</p>
              <div className={`grid gap-2 ${result.length > 1 ? "grid-cols-5" : "grid-cols-1 justify-items-center"}`}>
                {result.map((mon, i) => (
                  <div
                    key={i}
                    className="relative flex flex-col items-center rounded-lg border-2 p-1.5"
                    style={{
                      borderColor: RARITY_INFO[mon.rarity].color,
                      background: "rgba(0,8,70,0.85)",
                      boxShadow: mon.rarity >= 3 ? `0 0 10px ${RARITY_INFO[mon.rarity].color}` : undefined,
                      animation: `gachaPop 0.4s ease-out ${i * 0.07}s both`,
                      width: result.length === 1 ? "9.5rem" : undefined,
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
              <div className="mt-4 flex flex-col items-center gap-2">
                <span className="flex items-center gap-1.5 text-[13px] text-white/70 tabular-nums"><CoinIcon size={13} />のこり {coins}</span>
                <button onClick={closeResult}
                  className="px-8 py-2.5 rounded-lg border-2 border-white text-white text-[14px] hover:bg-white/10 active:scale-95 transition">
                  とじる
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
