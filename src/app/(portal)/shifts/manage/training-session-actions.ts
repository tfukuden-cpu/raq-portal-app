"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type TrainingSession = {
  batchId: string;
  trainingName: string;
  dates: string[];         // ソート済み
  startTime: string | null;
  endTime: string | null;
  staffIds: string[];
  staffNames: string[];
};

/** 案件の研修セッション一覧を取得 */
export async function fetchTrainingSessionsAction(
  projectId: string,
): Promise<TrainingSession[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("staff_trainings")
    .select("id, batch_id, staff_id, training_date, training_name, start_time, end_time")
    .eq("project_id", projectId)
    .order("training_date");

  if (error || !data) return [];

  // batch_id ごとにグループ化
  const map = new Map<string, {
    trainingName: string;
    dates: Set<string>;
    startTime: string | null;
    endTime: string | null;
    staffIds: Set<string>;
  }>();

  for (const row of data) {
    const bid = (row.batch_id as string) ?? row.id;
    if (!map.has(bid)) {
      map.set(bid, {
        trainingName: (row.training_name as string) ?? "研修",
        dates:     new Set(),
        startTime: (row.start_time as string | null) ?? null,
        endTime:   (row.end_time   as string | null) ?? null,
        staffIds:  new Set(),
      });
    }
    const g = map.get(bid)!;
    g.dates.add(row.training_date as string);
    g.staffIds.add(row.staff_id as string);
  }

  // スタッフ名を取得
  const allStaffIds = [...new Set(data.map(r => r.staff_id as string))];
  const { data: staffRows } = allStaffIds.length > 0
    ? await admin.from("staffs").select("id, name, display_name").in("id", allStaffIds)
    : { data: [] };
  const nameMap = new Map(
    (staffRows ?? []).map(s => [s.id as string, ((s.display_name ?? s.name ?? s.id) as string)])
  );

  // batchId → created_at の最小値でソート（追加順）
  const batchCreatedAt = new Map<string, string>();
  for (const row of data) {
    const bid = (row.batch_id as string) ?? row.id;
    // training_date を代用（created_at がないため）
    const existing = batchCreatedAt.get(bid);
    const d = row.training_date as string;
    if (!existing || d < existing) batchCreatedAt.set(bid, d);
  }

  return [...map.entries()]
    .sort((a, b) => (batchCreatedAt.get(a[0]) ?? "").localeCompare(batchCreatedAt.get(b[0]) ?? ""))
    .map(([batchId, g]) => {
      const sortedDates = [...g.dates].sort();
      const staffIds    = [...g.staffIds];
      return {
        batchId,
        trainingName: g.trainingName,
        dates:        sortedDates,
        startTime:    g.startTime,
        endTime:      g.endTime,
        staffIds,
        staffNames:   staffIds.map(id => nameMap.get(id) ?? id),
      };
    });
}

/** 研修セッションを作成（複数スタッフ × 複数日） */
export async function createTrainingSessionAction(
  projectId: string,
  trainingName: string,
  dates: string[],
  startTime: string | null,
  endTime: string | null,
  staffIds: string[],
): Promise<{ success: boolean; message?: string }> {
  if (dates.length === 0 || staffIds.length === 0) {
    return { success: false, message: "日付とスタッフを選択してください" };
  }

  const admin = createAdminClient();
  const batchId = crypto.randomUUID();

  const rows = dates.flatMap(date =>
    staffIds.map(staffId => ({
      project_id:    projectId,
      staff_id:      staffId,
      training_type: "onboarding",
      training_name: trainingName,
      training_date: date,
      start_time:    startTime ?? null,
      end_time:      endTime   ?? null,
      batch_id:      batchId,
    }))
  );

  const { error } = await admin.from("staff_trainings").insert(rows);
  if (error) return { success: false, message: error.message };

  revalidatePath("/shifts/manage", "page");
  return { success: true };
}

/** 研修セッションを削除（同じbatch_idの行をすべて削除） */
export async function deleteTrainingSessionAction(
  batchId: string,
): Promise<{ success: boolean; message?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("staff_trainings")
    .delete()
    .eq("batch_id", batchId);

  if (error) return { success: false, message: error.message };
  revalidatePath("/shifts/manage", "page");
  return { success: true };
}
