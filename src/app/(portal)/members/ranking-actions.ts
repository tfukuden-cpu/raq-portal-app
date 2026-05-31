"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export type RankingRow = {
  id: string;
  rank: number;
  accountNumber: string | null;
  staffName: string;
};

async function assertAdmin(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: s } = await supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  const isGlobalAdmin = s?.global_role === "executive" || s?.global_role === "admin";
  if (!isGlobalAdmin) {
    const { data: m } = await supabase
      .from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
    if (m?.role !== "project_admin") redirect("/dashboard");
  }
}

export async function fetchPeriodsAction(projectId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("rankings")
    .select("period, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const seen = new Set<string>();
  const periods: string[] = [];
  for (const row of data ?? []) {
    if (!seen.has(row.period as string)) {
      seen.add(row.period as string);
      periods.push(row.period as string);
    }
  }
  return periods;
}

export async function fetchRankingAction(projectId: string): Promise<RankingRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("rankings")
    .select("id, rank, account_number, staff_name")
    .eq("project_id", projectId)
    .order("rank", { ascending: true });

  return (data ?? []).map(r => ({
    id:            r.id as string,
    rank:          r.rank as number,
    accountNumber: r.account_number as string | null,
    staffName:     r.staff_name as string,
  }));
}

export async function importRankingAction(
  projectId: string,
  rows: { rank: number; accountNumber: string | null; staffName: string }[],
): Promise<{ success: boolean; message: string }> {
  await assertAdmin(projectId);
  const admin = createAdminClient();

  await admin.from("rankings").delete().eq("project_id", projectId);

  if (rows.length === 0) return { success: true, message: "データがありません" };

  const { error } = await admin.from("rankings").insert(
    rows.map(r => ({
      project_id:     projectId,
      period:         "",
      rank:           r.rank,
      account_number: r.accountNumber || null,
      staff_name:     r.staffName,
    }))
  );

  if (error) return { success: false, message: error.message };
  return { success: true, message: `${rows.length}件をインポートしました` };
}

export async function deleteRankingPeriodAction(
  projectId: string,
  period: string,
): Promise<{ success: boolean; message: string }> {
  await assertAdmin(projectId);
  const { error } = await createAdminClient().from("rankings").delete()
    .eq("project_id", projectId)
    .eq("period", period);
  if (error) return { success: false, message: error.message };
  return { success: true, message: "削除しました" };
}
