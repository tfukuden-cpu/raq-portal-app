"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** 管理者チェック（project_admin / global admin / executive） */
async function assertAdmin(projectId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: s } = await supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  if (s?.global_role === "executive" || s?.global_role === "admin") return staffId;

  const { data: membership } = await supabase
    .from("project_members").select("role")
    .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
  return membership?.role === "project_admin" ? staffId : null;
}

/** 欠勤補填日の回収 済/未 を切り替える（行が存在=済） */
export async function toggleAbsenceRecoveryAction(
  projectId: string,
  staffId: string,
  absenceDate: string, // YYYY-MM-DD
): Promise<{ success: boolean; recovered?: boolean; message?: string }> {
  try {
    const myStaffId = await assertAdmin(projectId);
    if (!myStaffId) return { success: false, message: "権限がありません" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(absenceDate)) return { success: false, message: "日付が不正です" };

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("absence_recovery_marks")
      .select("id")
      .eq("project_id", projectId)
      .eq("staff_id", staffId)
      .eq("absence_date", absenceDate)
      .maybeSingle();

    if (existing) {
      const { error } = await admin
        .from("absence_recovery_marks")
        .delete()
        .eq("id", (existing as { id: string }).id);
      if (error) return { success: false, message: error.message };
      return { success: true, recovered: false };
    } else {
      const { error } = await admin
        .from("absence_recovery_marks")
        .insert({ project_id: projectId, staff_id: staffId, absence_date: absenceDate, marked_by: myStaffId });
      if (error) {
        // 同時タップの一意制約競合は「済」扱い
        if (error.code === "23505") return { success: true, recovered: true };
        return { success: false, message: error.message };
      }
      return { success: true, recovered: true };
    }
  } catch (e) {
    console.error("[absentees] toggleAbsenceRecoveryAction failed:", e);
    return { success: false, message: "保存に失敗しました" };
  }
}
