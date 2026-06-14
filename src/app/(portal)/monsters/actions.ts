/**
 * モンスター管理（手持ち/図鑑/パーティー/育成）サーバーアクション。
 * 育成は所持インスタンス（staff_partners の行）単位。RLS バイパスのため admin クライアント。
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import {
  STAT_KEYS, type StatKey, type Evs, ZERO_EVS,
  EV_MAX_PER_STAT, evBudgetForLevel,
} from "@/lib/monster-stats";
import { monsterById } from "@/lib/rpg-chars";

async function currentStaffId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email?.split("@")[0]?.toUpperCase() ?? "";
}

/** 所持インスタンス1体 */
export type OwnedInstance = {
  /** staff_partners.id（インスタンスの一意キー） */
  instanceId: number;
  monsterId: number;
  level: number;
  exp: number;
  evs: Evs;
  /** 1〜3 / null=パーティー外 */
  partySlot: number | null;
};

export type MonsterCollection = {
  instances: OwnedInstance[];
  /** monster_id の集合（図鑑の解放判定） */
  ownedIds: number[];
  coins: number;
};

type Row = {
  id: number; monster_id: number; level: number; exp: number;
  ev_hp: number; ev_atk: number; ev_def: number; ev_spa: number; ev_spd: number; ev_spe: number;
  party_slot: number | null;
};

function rowToInstance(r: Row): OwnedInstance {
  return {
    instanceId: r.id,
    monsterId: r.monster_id,
    level: r.level ?? 1,
    exp: r.exp ?? 0,
    evs: { hp: r.ev_hp ?? 0, atk: r.ev_atk ?? 0, def: r.ev_def ?? 0, spa: r.ev_spa ?? 0, spd: r.ev_spd ?? 0, spe: r.ev_spe ?? 0 },
    partySlot: r.party_slot ?? null,
  };
}

/** 手持ち・図鑑解放・コインをまとめて取得 */
export async function getMonsterCollectionAction(): Promise<MonsterCollection> {
  const empty: MonsterCollection = { instances: [], ownedIds: [], coins: 0 };
  try {
    const staffId = await currentStaffId();
    if (!staffId) return empty;
    const admin = createAdminClient();

    const [{ data: parts }, { data: bonus }] = await Promise.all([
      admin.from("staff_partners")
        .select("id, monster_id, level, exp, ev_hp, ev_atk, ev_def, ev_spa, ev_spd, ev_spe, party_slot")
        .eq("staff_id", staffId)
        .order("monster_id", { ascending: true })
        .order("id", { ascending: true }),
      admin.from("login_bonuses").select("coins").eq("staff_id", staffId).maybeSingle(),
    ]);

    const instances = ((parts ?? []) as Row[]).map(rowToInstance);
    const ownedIds = [...new Set(instances.map(i => i.monsterId))].sort((a, b) => a - b);
    return { instances, ownedIds, coins: (bonus as { coins?: number } | null)?.coins ?? 0 };
  } catch (e) {
    console.error("getMonsterCollection error:", e);
    return empty;
  }
}

/** パーティー枠(1〜3)にインスタンスをセット（slot=null で編成から外す） */
export async function setPartySlotAction(instanceId: number, slot: number | null): Promise<{ ok: boolean; message?: string }> {
  try {
    const staffId = await currentStaffId();
    if (!staffId) return { ok: false, message: "ログインしてください" };
    if (slot !== null && (slot < 1 || slot > 3)) return { ok: false, message: "不正な枠です" };
    const admin = createAdminClient();

    // 所持確認（本人のインスタンスのみ操作可）
    const { data: own } = await admin
      .from("staff_partners").select("id, party_slot")
      .eq("id", instanceId).eq("staff_id", staffId).maybeSingle();
    if (!own) return { ok: false, message: "そのモンスターを所持していません" };

    if (slot === null) {
      await admin.from("staff_partners").update({ party_slot: null }).eq("id", instanceId);
    } else {
      // 同じ枠の既存メンバーを外す → 自分の旧枠も解消 → セット（UNIQUE制約対策で順に）
      await admin.from("staff_partners").update({ party_slot: null })
        .eq("staff_id", staffId).eq("party_slot", slot);
      await admin.from("staff_partners").update({ party_slot: slot }).eq("id", instanceId);
    }
    revalidatePath("/monsters");
    return { ok: true };
  } catch (e) {
    console.error("setPartySlot error:", e);
    return { ok: false, message: "編成に失敗しました" };
  }
}

/** 努力値を設定（割り振り/リセット）。レベルに応じた予算と各ステ上限を検証 */
export async function allocateEvAction(instanceId: number, evs: Partial<Evs>): Promise<{ ok: boolean; message?: string }> {
  try {
    const staffId = await currentStaffId();
    if (!staffId) return { ok: false, message: "ログインしてください" };
    const admin = createAdminClient();

    const { data: own } = await admin
      .from("staff_partners").select("id, level").eq("id", instanceId).eq("staff_id", staffId).maybeSingle();
    if (!own) return { ok: false, message: "そのモンスターを所持していません" };
    const level = (own as { level: number }).level ?? 1;

    // 正規化・検証
    const next: Evs = { ...ZERO_EVS };
    let total = 0;
    for (const k of STAT_KEYS) {
      const v = Math.max(0, Math.min(EV_MAX_PER_STAT, Math.floor(evs[k as StatKey] ?? 0)));
      next[k] = v;
      total += v;
    }
    const budget = evBudgetForLevel(level);
    if (total > budget) return { ok: false, message: `努力値が多すぎます（上限 ${budget}）` };

    const { error } = await admin.from("staff_partners").update({
      ev_hp: next.hp, ev_atk: next.atk, ev_def: next.def,
      ev_spa: next.spa, ev_spd: next.spd, ev_spe: next.spe,
    }).eq("id", instanceId);
    if (error) return { ok: false, message: error.message };

    revalidatePath("/monsters");
    return { ok: true };
  } catch (e) {
    console.error("allocateEv error:", e);
    return { ok: false, message: "保存に失敗しました" };
  }
}

/** （デバッグ/テスト用）レベルを直接設定。バトル実装までの暫定。本人のみ */
export async function setLevelAction(instanceId: number, level: number): Promise<{ ok: boolean; message?: string }> {
  try {
    const staffId = await currentStaffId();
    if (!staffId) return { ok: false, message: "ログインしてください" };
    const lv = Math.max(1, Math.min(50, Math.floor(level)));
    const admin = createAdminClient();
    const { data: own } = await admin
      .from("staff_partners").select("id, monster_id").eq("id", instanceId).eq("staff_id", staffId).maybeSingle();
    if (!own || !monsterById((own as { monster_id: number }).monster_id)) {
      return { ok: false, message: "そのモンスターを所持していません" };
    }
    await admin.from("staff_partners").update({ level: lv }).eq("id", instanceId);
    revalidatePath("/monsters");
    return { ok: true };
  } catch (e) {
    console.error("setLevel error:", e);
    return { ok: false, message: "保存に失敗しました" };
  }
}
