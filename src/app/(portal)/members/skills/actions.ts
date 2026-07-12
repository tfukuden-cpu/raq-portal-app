"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

async function assertAdmin(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: s } = await supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  if (s?.global_role === "executive" || s?.global_role === "admin") return;

  const { data: membership } = await supabase
    .from("project_members").select("role")
    .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
  if (membership?.role !== "project_admin") redirect("/dashboard");
}

/** スタッフの対応可能セクション（sections配列）に1件を追加/削除する（メインセクションは変更しない） */
export async function toggleStaffSkillAction(
  projectId: string,
  staffId: string,
  section: string,
  enabled: boolean,
): Promise<{ success: boolean; message?: string }> {
  await assertAdmin(projectId);

  const admin = createAdminClient();

  const { data: row, error: fetchError } = await admin
    .from("project_members")
    .select("section, sections")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .maybeSingle();

  if (fetchError || !row) return { success: false, message: fetchError?.message ?? "対象が見つかりません" };

  const current = ((row as { sections?: string[] | null }).sections ?? []).filter(Boolean);
  const baseSections = current.length > 0
    ? current
    : ((row as { section?: string | null }).section ? [(row as { section: string }).section] : []);

  const nextSections = enabled
    ? (baseSections.includes(section) ? baseSections : [...baseSections, section])
    : baseSections.filter(s => s !== section);

  const { error } = await admin
    .from("project_members")
    .update({ sections: nextSections })
    .eq("project_id", projectId)
    .eq("staff_id", staffId);

  if (error) return { success: false, message: error.message };

  revalidatePath("/members/skills");
  revalidatePath("/members");
  revalidatePath("/shifts/manage");
  return { success: true };
}

/** カスタムスキル項目（〇〇研修済み等）を追加する */
export async function addSkillItemAction(
  projectId: string,
  label: string,
): Promise<{ success: boolean; message?: string; itemId?: string }> {
  await assertAdmin(projectId);
  const trimmed = label.trim();
  if (!trimmed) return { success: false, message: "項目名を入力してください" };
  if (trimmed.length > 20) return { success: false, message: "項目名は20文字以内にしてください" };

  const admin = createAdminClient();
  const { data: maxRow } = await admin
    .from("skill_items")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow as { sort_order?: number } | null)?.sort_order ?? 0) + 1;

  const { error } = await admin
    .from("skill_items")
    .insert({ project_id: projectId, label: trimmed, sort_order: nextOrder });
  if (error) {
    if (error.code === "23505") return { success: false, message: "同じ名前の項目があります" };
    return { success: false, message: error.message };
  }

  // insertとselectを分離（RLS対策・地雷参照）
  const { data: row } = await admin
    .from("skill_items")
    .select("id")
    .eq("project_id", projectId)
    .eq("label", trimmed)
    .maybeSingle();

  revalidatePath("/members/skills");
  return { success: true, itemId: (row as { id?: string } | null)?.id };
}

/** カスタムスキル項目を削除する（値もcascade削除） */
export async function deleteSkillItemAction(
  projectId: string,
  itemId: string,
): Promise<{ success: boolean; message?: string }> {
  await assertAdmin(projectId);
  const admin = createAdminClient();
  const { error } = await admin
    .from("skill_items")
    .delete()
    .eq("project_id", projectId)
    .eq("id", itemId);
  if (error) return { success: false, message: error.message };
  revalidatePath("/members/skills");
  return { success: true };
}

/** スタッフ×カスタム項目の○×を切り替える */
export async function toggleSkillValueAction(
  projectId: string,
  staffId: string,
  itemId: string,
  value: boolean,
): Promise<{ success: boolean; message?: string }> {
  await assertAdmin(projectId);
  const admin = createAdminClient();

  // 存在チェック→insert/update方式（upsert onConflict の地雷回避）
  const { data: existing } = await admin
    .from("staff_skill_values")
    .select("id")
    .eq("staff_id", staffId)
    .eq("item_id", itemId)
    .maybeSingle();

  const error = existing
    ? (await admin.from("staff_skill_values")
        .update({ value, updated_at: new Date().toISOString() })
        .eq("id", (existing as { id: string }).id)).error
    : (await admin.from("staff_skill_values")
        .insert({ project_id: projectId, staff_id: staffId, item_id: itemId, value })).error;

  if (error) return { success: false, message: error.message };
  revalidatePath("/members/skills");
  return { success: true };
}
