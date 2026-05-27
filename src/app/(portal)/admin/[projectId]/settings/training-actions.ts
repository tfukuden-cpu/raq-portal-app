"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/** 導入研修日を追加 */
export async function addTrainingDateAction(
  staffId: string,
  trainingDate: string,
): Promise<{ success: boolean; id?: string; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "認証エラー" };

  const { data, error } = await supabase
    .from("staff_trainings")
    .insert({ staff_id: staffId, training_type: "onboarding", training_date: trainingDate })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return { success: false, message: "同じ日付が既に登録されています" };
    return { success: false, message: error.message };
  }

  revalidatePath("/", "layout");
  return { success: true, id: data?.id };
}

/** 導入研修日を削除 */
export async function removeTrainingDateAction(
  id: string,
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "認証エラー" };

  const { error } = await supabase
    .from("staff_trainings")
    .delete()
    .eq("id", id);

  if (error) return { success: false, message: error.message };

  revalidatePath("/", "layout");
  return { success: true };
}

/** スタッフの導入研修日を最新取得（編集モーダル開くときに使う） */
export async function fetchTrainingDatesAction(
  staffId: string,
): Promise<{ id: string; training_date: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_trainings")
    .select("id, training_date")
    .eq("staff_id", staffId)
    .eq("training_type", "onboarding")
    .order("training_date");
  return (data ?? []).map(d => ({ id: d.id as string, training_date: d.training_date as string }));
}
