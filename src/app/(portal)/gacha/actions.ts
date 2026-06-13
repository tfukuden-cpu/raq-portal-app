/**
 * モンスターガチャ サーバーアクション（SPEC.md §6-7）＜骨組み・UI未接続＞
 *
 * - コインは login_bonuses.coins を消費（全社共通）
 * - 重複所持OK・還元なし（staff_partners に無条件 insert）
 * - 残高チェック→減算→insert を admin クライアントで実施
 *
 * ⚠️ まだガチャ画面（/gacha）からは呼んでいない。テーブル作成後に動作する。
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { drawGacha, gachaPlan, type GachaRoll } from "@/lib/gacha";
import { monsterById, type Monster } from "@/lib/rpg-chars";

async function currentStaffId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email?.split("@")[0]?.toUpperCase() ?? "";
}

export type GachaDrawResult =
  | { ok: true; monsters: Monster[]; spent: number; coins: number }
  | { ok: false; reason: "insufficient" | "auth" | "error"; message: string; coins?: number };

/** ガチャを引く（mode: 単発 / 10連） */
export async function drawGachaAction(mode: "single" | "ten"): Promise<GachaDrawResult> {
  try {
    const staffId = await currentStaffId();
    if (!staffId) return { ok: false, reason: "auth", message: "ログインしてください" };

    const { cost, count } = gachaPlan(mode);
    const admin = createAdminClient();

    // 残高の行を用意（無ければ作る）
    await admin.from("login_bonuses").upsert(
      { staff_id: staffId },
      { onConflict: "staff_id", ignoreDuplicates: true },
    );

    const { data: row } = await admin
      .from("login_bonuses").select("coins").eq("staff_id", staffId).maybeSingle();
    const coins = (row as { coins?: number } | null)?.coins ?? 0;

    if (coins < cost) {
      return { ok: false, reason: "insufficient", message: "コインが足りません", coins };
    }

    // 減算（gte ガードで残高割れを防ぐ。個人操作のため低競合）
    const { data: spent } = await admin
      .from("login_bonuses")
      .update({ coins: coins - cost, updated_at: new Date().toISOString() })
      .eq("staff_id", staffId)
      .gte("coins", cost)
      .select("coins")
      .maybeSingle();

    if (!spent) {
      return { ok: false, reason: "insufficient", message: "コインが足りません", coins };
    }
    const remaining = (spent as { coins: number }).coins;

    // 抽選
    const rolls: GachaRoll[] = Array.from({ length: count }, () => ({
      rarityRoll: Math.random(),
      pickRoll: Math.random(),
    }));
    const monsters = drawGacha(count, rolls);

    // 所持に追加（重複OK・無条件 insert）
    const { error: insErr } = await admin
      .from("staff_partners")
      .insert(monsters.map(m => ({ staff_id: staffId, monster_id: m.id })));
    if (insErr) {
      // 失敗時はコインを払い戻す
      await admin.from("login_bonuses")
        .update({ coins: remaining + cost }).eq("staff_id", staffId);
      console.error("gacha insert error:", insErr);
      return { ok: false, reason: "error", message: "ガチャに失敗しました（コインは返却されました）", coins };
    }

    revalidatePath("/dashboard");
    return { ok: true, monsters, spent: cost, coins: remaining };
  } catch (e) {
    console.error("drawGacha error:", e);
    return { ok: false, reason: "error", message: "ガチャに失敗しました" };
  }
}

export type GachaState = {
  coins: number;
  /** 所持パートナー（重複含む全行を monster_id でカウント） */
  owned: { monsterId: number; count: number }[];
  ownedSpecies: number;
  totalOwned: number;
  activePartnerId: number | null;
};

/** ガチャ画面用の状態取得（残高・所持パートナー・連れ歩き） */
export async function getGachaStateAction(): Promise<GachaState> {
  const empty: GachaState = { coins: 0, owned: [], ownedSpecies: 0, totalOwned: 0, activePartnerId: null };
  try {
    const staffId = await currentStaffId();
    if (!staffId) return empty;
    const admin = createAdminClient();

    const [{ data: bonus }, { data: parts }, { data: staff }] = await Promise.all([
      admin.from("login_bonuses").select("coins").eq("staff_id", staffId).maybeSingle(),
      admin.from("staff_partners").select("monster_id").eq("staff_id", staffId),
      admin.from("staffs").select("active_partner_id").eq("id", staffId).maybeSingle(),
    ]);

    const counts = new Map<number, number>();
    for (const p of (parts ?? []) as { monster_id: number }[]) {
      counts.set(p.monster_id, (counts.get(p.monster_id) ?? 0) + 1);
    }
    const owned = [...counts.entries()]
      .map(([monsterId, count]) => ({ monsterId, count }))
      .sort((a, b) => a.monsterId - b.monsterId);

    return {
      coins: (bonus as { coins?: number } | null)?.coins ?? 0,
      owned,
      ownedSpecies: owned.length,
      totalOwned: (parts ?? []).length,
      activePartnerId: (staff as { active_partner_id?: number | null } | null)?.active_partner_id ?? null,
    };
  } catch (e) {
    console.error("getGachaState error:", e);
    return empty;
  }
}

/** 連れ歩くパートナーを設定（所持しているモンスターのみ・null で解除） */
export async function setActivePartnerAction(monsterId: number | null): Promise<{ ok: boolean; message?: string }> {
  try {
    const staffId = await currentStaffId();
    if (!staffId) return { ok: false, message: "ログインしてください" };
    if (monsterId !== null && !monsterById(monsterId)) {
      return { ok: false, message: "不正なモンスターです" };
    }
    const admin = createAdminClient();

    // 所持確認（連れ歩けるのは持っているモンスターのみ）
    if (monsterId !== null) {
      const { data: owned } = await admin
        .from("staff_partners").select("id")
        .eq("staff_id", staffId).eq("monster_id", monsterId).limit(1);
      if (!owned || owned.length === 0) {
        return { ok: false, message: "そのパートナーを所持していません" };
      }
    }

    const { error } = await admin
      .from("staffs").update({ active_partner_id: monsterId }).eq("id", staffId);
    if (error) return { ok: false, message: error.message };

    revalidatePath("/dashboard");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    console.error("setActivePartner error:", e);
    return { ok: false, message: "設定に失敗しました" };
  }
}
