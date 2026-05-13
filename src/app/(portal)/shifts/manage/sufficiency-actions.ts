"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function upsertSlotRequirementAction(fd: FormData): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "未認証" };

  const projectId    = String(fd.get("projectId")    ?? "").trim();
  const section      = String(fd.get("section")      ?? "").trim();
  const patternName  = String(fd.get("patternName")  ?? "").trim();
  const shiftDate    = String(fd.get("shiftDate")    ?? "").trim();
  const requiredCount = Number(fd.get("requiredCount") ?? 0);

  if (!projectId || !section || !patternName || !shiftDate) {
    return { success: false, message: "パラメータ不足" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("shift_slot_requirements")
    .upsert(
      { project_id: projectId, section, pattern_name: patternName, shift_date: shiftDate, required_count: requiredCount },
      { onConflict: "project_id,section,pattern_name,shift_date" }
    );

  if (error) return { success: false, message: error.message };
  return { success: true };
}
