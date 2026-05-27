"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type TrainingEntry = {
  id: string;
  training_date: string;
  training_name: string | null;
  start_time: string | null;
  end_time: string | null;
};

/** 研修日を追加 */
export async function addTrainingDateAction(
  staffId: string,
  trainingDate: string,
  trainingName?: string | null,
  startTime?: string | null,
  endTime?: string | null,
): Promise<{ success: boolean; id?: string; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "認証エラー" };

  const { data, error } = await supabase
    .from("staff_trainings")
    .insert({
      staff_id:      staffId,
      training_type: "onboarding",
      training_date: trainingDate,
      training_name: trainingName ?? null,
      start_time:    startTime ?? null,
      end_time:      endTime ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return { success: false, message: "同じ日付が既に登録されています" };
    return { success: false, message: error.message };
  }

  revalidatePath("/", "layout");
  return { success: true, id: data?.id };
}

/** 研修日を削除 */
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

/** スタッフの研修日一覧を最新取得 */
export async function fetchTrainingDatesAction(
  staffId: string,
): Promise<TrainingEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_trainings")
    .select("id, training_date, training_name, start_time, end_time")
    .eq("staff_id", staffId)
    .order("training_date");
  return (data ?? []).map(d => ({
    id:            d.id as string,
    training_date: d.training_date as string,
    training_name: (d as { training_name?: string | null }).training_name ?? null,
    start_time:    (d as { start_time?: string | null }).start_time ?? null,
    end_time:      (d as { end_time?: string | null }).end_time ?? null,
  }));
}
