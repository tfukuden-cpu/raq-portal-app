"use client";

import { useState, useMemo, useTransition, type CSSProperties } from "react";
import { RpgWindow, BlinkCursor, dotGothic, RPG_PAGE_BG, RPG_KEYFRAMES, RpgStarfield } from "@/components/rpg-ui";
import { RPG_MONSTERS, monsterById, monsterImg, type MonsterRarity } from "@/lib/rpg-chars";
import {
  STAT_KEYS, STAT_LABELS, type StatKey, type Evs, ZERO_EVS,
  ELEMENT_INFO, computeStats, baseStats, monsterBattle, monsterDex,
  evBudgetForLevel, EV_MAX_PER_STAT, LEVEL_MAX,
} from "@/lib/monster-stats";
import { RARITY_INFO } from "@/lib/gacha";
import {
  setPartySlotAction, allocateEvAction, setLevelAction,
  type MonsterCollection, type OwnedInstance,
} from "./actions";

/** ステータスバーの最大目安（Lv50高ステータス相当） */
const STAT_BAR_MAX = 280;
const EV_STEP = 5;

function CoinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="inline-block shrink-0">
      <circle cx="12" cy="12" r="10" fill="#fcd34d" stroke="#b45309" strokeWidth="1.5" />
      <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#92400e">G</text>
    </svg>
  );
}

function RarityStars({ rarity, dim = false }: { rarity: MonsterRarity; dim?: boolean }) {
  const info = RARITY_INFO[rarity];
  return (
    <span className="leading-none tracking-tighter text-[8px]" style={{ color: dim ? "rgba(255,255,255,0.3)" : info.color }}>
      {info.stars}
    </span>
  );
}

function ElementBadge({ id }: { id: number }) {
  const { el } = monsterBattle(id);
  return (
    <span className="text-[9px] rounded px-1 leading-tight border" style={{ color: ELEMENT_INFO[el].color, borderColor: ELEMENT_INFO[el].color }}>
      {el}
    </span>
  );
}

function StatBars({ stats }: { stats: Record<StatKey, number> }) {
  return (
    <div className="space-y-1">
      {STAT_KEYS.map(k => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-[10px] text-white/70 w-12 shrink-0">{STAT_LABELS[k]}</span>
          <span className="text-[11px] text-white tabular-nums w-9 text-right shrink-0">{stats[k]}</span>
          <span className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (stats[k] / STAT_BAR_MAX) * 100)}%`, background: "linear-gradient(90deg,#60a5fa,#a78bfa)" }} />
          </span>
        </div>
      ))}
    </div>
  );
}

type Tab = "party" | "box" | "dex";

export default function MonstersClient({ initial }: { initial: MonsterCollection }) {
  const [instances, setInstances] = useState<OwnedInstance[]>(initial.instances);
  const [tab, setTab] = useState<Tab>("party");
  const [detailId, setDetailId] = useState<number | null>(null); // instanceId
  const [dexId, setDexId] = useState<number | null>(null);        // monsterId (図鑑)
  const [, startTransition] = useTransition();

  const ownedIds = useMemo(() => new Set(instances.map(i => i.monsterId)), [instances]);
  const party = useMemo(() => {
    const slots: (OwnedInstance | null)[] = [null, null, null];
    for (const i of instances) if (i.partySlot && i.partySlot >= 1 && i.partySlot <= 3) slots[i.partySlot - 1] = i;
    return slots;
  }, [instances]);

  const detail = instances.find(i => i.instanceId === detailId) ?? null;

  function patchInstance(instanceId: number, patch: Partial<OwnedInstance>) {
    setInstances(prev => prev.map(i => (i.instanceId === instanceId ? { ...i, ...patch } : i)));
  }

  function assignSlot(instanceId: number, slot: number | null) {
    setInstances(prev => prev.map(i => {
      if (i.instanceId === instanceId) return { ...i, partySlot: slot };
      if (slot !== null && i.partySlot === slot) return { ...i, partySlot: null }; // 既存を押し出す
      return i;
    }));
    startTransition(async () => { await setPartySlotAction(instanceId, slot); });
  }

  // パーティーへの出し入れ（タップで追加＝空き枠へ／もう一度で外す）
  function toggleParty(inst: OwnedInstance) {
    if (inst.partySlot) { assignSlot(inst.instanceId, null); return; }
    const emptyIdx = party.findIndex(s => s === null);
    if (emptyIdx === -1) return; // パーティーがいっぱい
    assignSlot(inst.instanceId, emptyIdx + 1);
  }
  const partyFull = party.every(s => s !== null);

  return (
    <main className={`min-h-[100dvh] pb-28 md:pb-12 ${dotGothic.className}`} style={{ background: RPG_PAGE_BG }}>
      <style>{RPG_KEYFRAMES}</style>

      {/* ヘッダー */}
      <div className="relative px-4 md:px-8 pt-5 pb-3 overflow-hidden">
        <RpgStarfield />
        <div className="relative flex items-center justify-between gap-3">
          <h1 className="text-[20px] md:text-[22px] text-white">★ モンスター</h1>
          <span className="flex items-center gap-1.5 text-[13px] text-white bg-[#000846]/80 border border-amber-300/70 rounded px-2.5 py-1 tabular-nums">
            <CoinIcon size={14} />{initial.coins}
          </span>
        </div>
      </div>

      <div className="px-4 md:px-8 max-w-3xl mx-auto space-y-3.5">
        {/* タブ */}
        <div className="grid grid-cols-3 gap-2">
          {([["party", "パーティー"], ["box", "てもち"], ["dex", "ずかん"]] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg border-2 py-2 text-[13px] transition active:scale-95 ${
                tab === t ? "border-amber-300 bg-amber-400/15 text-amber-200" : "border-white/25 bg-white/5 text-white/80 hover:bg-white/10"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── パーティー ── */}
        {tab === "party" && (
          <RpgWindow title="パーティー（3たい）">
            <div className="px-4 py-4 space-y-3">
              <p className="text-[12px] text-white/60">＊バトルで たたかう 3たいを えらぶ。<BlinkCursor /></p>
              <div className="grid grid-cols-3 gap-2.5">
                {party.map((inst, i) => (
                  <div key={i} className="rounded-lg border-2 border-white/25 bg-white/5 p-2 flex flex-col items-center min-h-[120px] justify-center">
                    <span className="text-[10px] text-amber-200 mb-1">わく {i + 1}</span>
                    {inst ? (
                      <button onClick={() => setDetailId(inst.instanceId)} className="flex flex-col items-center active:scale-95 transition">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={monsterImg(inst.monsterId)} alt="" className="h-14 w-auto object-contain" style={{ imageRendering: "pixelated" }} />
                        <RarityStars rarity={monsterById(inst.monsterId)?.rarity ?? 1} />
                        <span className="text-[10px] text-white truncate w-full text-center">{monsterById(inst.monsterId)?.label}</span>
                        <span className="flex items-center gap-1 mt-0.5"><span className="text-[9px] text-white/70">Lv{inst.level}</span><ElementBadge id={inst.monsterId} /></span>
                      </button>
                    ) : (
                      <span className="text-white/30 text-[24px] leading-none">＋</span>
                    )}
                  </div>
                ))}
              </div>

              {/* てもち一覧（タップで編成・もう一度で外す） */}
              <div className="border-t border-white/15 pt-3 mt-1">
                <p className="text-[11px] text-white/55 mb-2 px-0.5">
                  タップで パーティーに いれる／はずす（{instances.length}たい）{partyFull && <span className="text-amber-300/80">・いまは いっぱい</span>}
                </p>
                {instances.length === 0 ? (
                  <p className="text-[12px] text-white/40 text-center py-5">まだ いない。ガチャを ひいてみよう。</p>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                    {instances.map(inst => {
                      const mon = monsterById(inst.monsterId);
                      if (!mon) return null;
                      const inParty = inst.partySlot != null;
                      const disabled = !inParty && partyFull;
                      return (
                        <button key={inst.instanceId} onClick={() => toggleParty(inst)} disabled={disabled}
                          className="relative flex flex-col items-center rounded-lg border-2 p-1 transition active:scale-95 bg-white/5 hover:bg-white/10 disabled:opacity-35"
                          style={{ borderColor: inParty ? "#fcd34d" : `${RARITY_INFO[mon.rarity].color}66` }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={monsterImg(inst.monsterId)} alt="" loading="lazy" className="h-11 w-auto object-contain" style={{ imageRendering: "pixelated" }} />
                          <RarityStars rarity={mon.rarity} />
                          <span className="text-[9px] leading-tight truncate w-full text-center" style={{ color: RARITY_INFO[mon.rarity].color }}>{mon.label}</span>
                          <span className="absolute top-0.5 left-0.5 text-[8px] text-white bg-[#000846]/90 border border-white/40 rounded px-1 tabular-nums">Lv{inst.level}</span>
                          {inParty && <span className="absolute -top-1.5 -right-1 text-[8px] text-[#000846] bg-amber-300 rounded-full h-4 w-4 grid place-items-center">{inst.partySlot}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </RpgWindow>
        )}

        {/* ── てもち ── */}
        {tab === "box" && (
          <RpgWindow title="てもちの モンスター">
            <div className="px-3 py-3">
              <p className="text-[11px] text-white/55 mb-2 px-1">タップで しょうさい・そだてる（{instances.length}たい）</p>
              {instances.length === 0 ? (
                <p className="text-[13px] text-white/40 text-center py-8">まだ いない。ガチャを ひいてみよう。</p>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                  {instances.map(inst => {
                    const mon = monsterById(inst.monsterId);
                    if (!mon) return null;
                    return (
                      <button key={inst.instanceId} onClick={() => setDetailId(inst.instanceId)}
                        className="relative flex flex-col items-center rounded-lg border-2 p-1 transition active:scale-95 bg-white/5 hover:bg-white/10"
                        style={{ borderColor: inst.partySlot ? "#fcd34d" : `${RARITY_INFO[mon.rarity].color}66` }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={monsterImg(inst.monsterId)} alt="" loading="lazy" className="h-12 w-auto object-contain" style={{ imageRendering: "pixelated" }} />
                        <RarityStars rarity={mon.rarity} />
                        <span className="text-[9px] leading-tight truncate w-full text-center" style={{ color: RARITY_INFO[mon.rarity].color }}>{mon.label}</span>
                        <span className="absolute top-0.5 left-0.5 text-[8px] text-white bg-[#000846]/90 border border-white/40 rounded px-1 tabular-nums">Lv{inst.level}</span>
                        {inst.partySlot && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] text-[#000846] bg-amber-300 rounded px-1 whitespace-nowrap">わく{inst.partySlot}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </RpgWindow>
        )}

        {/* ── ずかん ── */}
        {tab === "dex" && (
          <RpgWindow title={`ずかん（${ownedIds.size}／${RPG_MONSTERS.length}）`}>
            <div className="px-3 py-3">
              {/* レア度の凡例 */}
              <div className="flex flex-wrap gap-x-2.5 gap-y-1 mb-2.5 px-1">
                {([1, 2, 3, 4, 5] as MonsterRarity[]).map(r => (
                  <span key={r} className="text-[9px] leading-none" style={{ color: RARITY_INFO[r].color }}>
                    {RARITY_INFO[r].stars} {RARITY_INFO[r].label}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                {RPG_MONSTERS.map(mon => {
                  const owned = ownedIds.has(mon.id);
                  return (
                    <button key={mon.id} onClick={() => owned && setDexId(mon.id)} disabled={!owned}
                      className="relative flex flex-col items-center rounded-lg border-2 p-1 bg-white/5 disabled:opacity-100"
                      style={{ borderColor: owned ? `${RARITY_INFO[mon.rarity].color}66` : "rgba(255,255,255,0.12)" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={monsterImg(mon.id)} alt="" loading="lazy"
                        className="h-12 w-auto object-contain transition"
                        style={{ imageRendering: "pixelated", filter: owned ? "none" : "brightness(0) opacity(0.55)" }} />
                      <RarityStars rarity={mon.rarity} dim={!owned} />
                      <span className="text-[9px] leading-tight truncate w-full text-center" style={{ color: owned ? RARITY_INFO[mon.rarity].color : "rgba(255,255,255,0.35)" }}>
                        {owned ? mon.label : "？？？"}
                      </span>
                      <span className="absolute top-0.5 right-0.5 text-[7px] text-white/50 tabular-nums">{mon.id}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </RpgWindow>
        )}
      </div>

      {/* ── インスタンス詳細（育成） ── */}
      {detail && <InstanceDetail
        inst={detail}
        onClose={() => setDetailId(null)}
        onPatch={patchInstance}
        onAssign={assignSlot}
      />}

      {/* ── 図鑑 詳細 ── */}
      {dexId != null && <DexDetail monsterId={dexId} onClose={() => setDexId(null)} />}
    </main>
  );
}

/* ── インスタンス詳細＋育成（努力値・レベル・パーティー） ── */
function InstanceDetail({
  inst, onClose, onPatch, onAssign,
}: {
  inst: OwnedInstance;
  onClose: () => void;
  onPatch: (instanceId: number, patch: Partial<OwnedInstance>) => void;
  onAssign: (instanceId: number, slot: number | null) => void;
}) {
  const mon = monsterById(inst.monsterId)!;
  const dex = monsterDex(inst.monsterId)!;
  const [level, setLevel] = useState(inst.level);
  const [evs, setEvs] = useState<Evs>(inst.evs);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const budget = evBudgetForLevel(level);
  const used = STAT_KEYS.reduce((s, k) => s + evs[k], 0);
  const remain = budget - used;
  const stats = computeStats(inst.monsterId, level, evs);
  const base = baseStats(inst.monsterId);

  function bump(k: StatKey, dir: 1 | -1) {
    setEvs(prev => {
      const cur = prev[k];
      if (dir > 0) {
        const add = Math.min(EV_STEP, remain, EV_MAX_PER_STAT - cur);
        if (add <= 0) return prev;
        return { ...prev, [k]: cur + add };
      } else {
        const sub = Math.min(EV_STEP, cur);
        if (sub <= 0) return prev;
        return { ...prev, [k]: cur - sub };
      }
    });
  }

  function saveEv() {
    setBusy(true);
    startTransition(async () => {
      const r = await allocateEvAction(inst.instanceId, evs);
      setBusy(false);
      if (r.ok) onPatch(inst.instanceId, { evs });
      else alert(r.message ?? "保存に失敗しました");
    });
  }
  function resetEv() {
    setEvs({ ...ZERO_EVS });
  }
  function changeLevel(next: number) {
    const lv = Math.max(1, Math.min(LEVEL_MAX, next));
    setLevel(lv);
    onPatch(inst.instanceId, { level: lv });
    startTransition(async () => { await setLevelAction(inst.instanceId, lv); });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-3 md:p-6" style={{ background: "rgba(2,4,15,0.8)" }} onClick={onClose}>
      <div className={`w-full max-w-md max-h-[88dvh] overflow-y-auto rounded-2xl border-2 border-white/70 ${dotGothic.className}`}
        style={{ background: "#000846" }} onClick={e => e.stopPropagation()}>
        <div className="p-4 space-y-3">
          {/* ヘッダー */}
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={monsterImg(inst.monsterId)} alt="" className="h-20 w-20 object-contain shrink-0" style={{ imageRendering: "pixelated" }} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px]" style={{ color: RARITY_INFO[mon.rarity].color }}>{RARITY_INFO[mon.rarity].stars} {RARITY_INFO[mon.rarity].label}</span>
                <span className="text-[9px] rounded px-1 border" style={{ color: ELEMENT_INFO[dex.el].color, borderColor: ELEMENT_INFO[dex.el].color }}>{dex.el}</span>
                <span className="text-[9px] text-white/70 rounded px-1 border border-white/40">{dex.role}</span>
              </div>
              <p className="text-[16px] text-white mt-0.5">{mon.label}</p>
              <p className="text-[10px] text-white/55 leading-snug mt-0.5">{dex.desc}</p>
            </div>
          </div>

          {/* レベル（バトル実装までの仮の調整） */}
          <div className="flex items-center justify-between bg-white/5 rounded-lg border border-white/20 px-3 py-2">
            <span className="text-[12px] text-white">レベル <span className="text-amber-300 text-[15px] tabular-nums">{level}</span></span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => changeLevel(level - 1)} className="h-7 w-7 rounded border border-white/40 text-white text-[14px] active:scale-90">−</button>
              <button onClick={() => changeLevel(level + 1)} className="h-7 w-7 rounded border border-white/40 text-white text-[14px] active:scale-90">＋</button>
            </div>
          </div>
          <p className="text-[9px] text-white/40 -mt-1.5">＊レベルはバトル実装までの仮調整。レベルアップで努力値がもらえます。</p>

          {/* ステータス */}
          <div className="bg-white/5 rounded-lg border border-white/20 p-3">
            <p className="text-[11px] text-white/70 mb-2">のうりょく（Lv{level}）</p>
            <StatBars stats={stats} />
          </div>

          {/* 努力値 */}
          <div className="bg-white/5 rounded-lg border border-white/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/70">どりょくち</span>
              <span className="text-[11px] text-white">のこり <span className="text-amber-300 tabular-nums">{remain}</span> / {budget}</span>
            </div>
            {budget === 0 && <p className="text-[10px] text-white/40">レベルを上げると振り分けられます。</p>}
            {STAT_KEYS.map(k => (
              <div key={k} className="flex items-center gap-2">
                <span className="text-[10px] text-white/70 w-12 shrink-0">{STAT_LABELS[k]}</span>
                <button onClick={() => bump(k, -1)} className="h-6 w-6 rounded border border-white/30 text-white text-[12px] active:scale-90 disabled:opacity-30" disabled={evs[k] <= 0}>−</button>
                <span className="text-[11px] text-amber-200 tabular-nums w-7 text-center">{evs[k]}</span>
                <button onClick={() => bump(k, 1)} className="h-6 w-6 rounded border border-white/30 text-white text-[12px] active:scale-90 disabled:opacity-30" disabled={remain <= 0 || evs[k] >= EV_MAX_PER_STAT}>＋</button>
                <span className="text-[9px] text-white/40">base {base[k]}</span>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button onClick={saveEv} disabled={busy} className="flex-1 rounded-lg border-2 border-amber-300 bg-amber-400/15 text-amber-200 text-[12px] py-1.5 active:scale-95 disabled:opacity-40">ほぞん</button>
              <button onClick={resetEv} className="rounded-lg border border-white/40 text-white/80 text-[12px] px-3 py-1.5 active:scale-95">リセット</button>
            </div>
          </div>

          {/* パーティー編成 */}
          <div className="bg-white/5 rounded-lg border border-white/20 p-3 space-y-2">
            <span className="text-[11px] text-white/70">パーティー</span>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map(slot => (
                <button key={slot} onClick={() => onAssign(inst.instanceId, inst.partySlot === slot ? null : slot)}
                  className={`rounded-lg border-2 py-1.5 text-[11px] active:scale-95 ${
                    inst.partySlot === slot ? "border-amber-300 bg-amber-400/20 text-amber-200" : "border-white/25 text-white/80 hover:bg-white/10"
                  }`}>
                  {inst.partySlot === slot ? `わく${slot}・はずす` : `わく${slot}`}
                </button>
              ))}
            </div>
          </div>

          <button onClick={onClose} className="w-full rounded-lg border-2 border-white text-white text-[13px] py-2 active:scale-95">とじる</button>
        </div>
      </div>
    </div>
  );
}

/* ── 図鑑の種別詳細（所持済みのみ・育成なし） ── */
function DexDetail({ monsterId, onClose }: { monsterId: number; onClose: () => void }) {
  const mon = monsterById(monsterId)!;
  const dex = monsterDex(monsterId)!;
  const stats = useMemo<Record<StatKey, number>>(() => ({ ...dex.base }), [dex]);
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-3 md:p-6" style={{ background: "rgba(2,4,15,0.8)" }} onClick={onClose}>
      <div className={`w-full max-w-md rounded-2xl border-2 border-white/70 ${dotGothic.className}`} style={{ background: "#000846" }} onClick={e => e.stopPropagation()}>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={monsterImg(monsterId)} alt="" className="h-24 w-24 object-contain shrink-0" style={{ imageRendering: "pixelated" }} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-white/50 tabular-nums">No.{monsterId}</span>
                <span className="text-[10px]" style={{ color: RARITY_INFO[mon.rarity].color }}>{RARITY_INFO[mon.rarity].stars} {RARITY_INFO[mon.rarity].label}</span>
                <span className="text-[9px] rounded px-1 border" style={{ color: ELEMENT_INFO[dex.el].color, borderColor: ELEMENT_INFO[dex.el].color }}>{dex.el}</span>
                <span className="text-[9px] text-white/70 rounded px-1 border border-white/40">{dex.role}</span>
              </div>
              <p className="text-[17px] text-white mt-0.5">{mon.label}</p>
            </div>
          </div>
          <p className="text-[12px] text-white/80 leading-relaxed bg-white/5 rounded-lg border border-white/15 p-3">{dex.desc || "ーー"}</p>
          <div className="bg-white/5 rounded-lg border border-white/20 p-3">
            <p className="text-[11px] text-white/70 mb-2">きそ のうりょく（合計 {dex.baseTotal}）</p>
            <StatBars stats={stats} />
          </div>
          <button onClick={onClose} className="w-full rounded-lg border-2 border-white text-white text-[13px] py-2 active:scale-95">とじる</button>
        </div>
      </div>
    </div>
  );
}
