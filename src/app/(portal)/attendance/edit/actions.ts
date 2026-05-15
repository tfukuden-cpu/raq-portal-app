"use server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

async function requireAdmin(projectId: string): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const [{ data: membership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);
  const ok =
    membership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";
  if (!ok) redirect("/dashboard");
  return staffId;
}

export type CorrectionResult = { ok: boolean; error?: string };

/**
 * 打刻を上書き修正する
 * clockIn / clockOut は "HH:MM" または null（削除）
 */
export async function savePunchCorrectionAction(
  projectId: string,
  staffId: string,
  date: string,       // YYYY-MM-DD
  clockIn:  string | null,
  clockOut: string | null,
  isAbsent: boolean,
  absenceReason: string,
  isLate: boolean,
  lateReason: string,
): Promise<CorrectionResult> {
  await requireAdmin(projectId);
  const admin = createAdminClient();

  const dayStart = `${date}T00:00:00+09:00`;
  const dayEnd   = `${date}T23:59:59+09:00`;

  // ── 打刻修正 ──────────────────────────────────────────────
  // その日の既存打刻を削除してから再挿入
  await admin.from("punch_logs")
    .delete()
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .gte("recorded_at", dayStart)
    .lte("recorded_at", dayEnd);

  const inserts: { project_id: string; staff_id: string; punch_type: string; recorded_at: string }[] = [];
  if (clockIn)  inserts.push({ project_id: projectId, staff_id: staffId, punch_type: "clock_in",  recorded_at: `${date}T${clockIn}:00+09:00`  });
  if (clockOut) inserts.push({ project_id: projectId, staff_id: staffId, punch_type: "clock_out", recorded_at: `${date}T${clockOut}:00+09:00` });
  if (inserts.length > 0) {
    const { error } = await admin.from("punch_logs").insert(inserts);
    if (error) return { ok: false, error: error.message };
  }

  // ── 欠勤修正 ──────────────────────────────────────────────
  await admin.from("absence_reports")
    .delete()
    .eq("project_id", projectId).eq("staff_id", staffId).eq("absence_date", date);
  if (isAbsent) {
    await admin.from("absence_reports")
      .insert({ project_id: projectId, staff_id: staffId, absence_date: date, reason: absenceReason || null });
  }

  // ── 遅刻修正 ──────────────────────────────────────────────
  await admin.from("late_reports")
    .delete()
    .eq("project_id", projectId).eq("staff_id", staffId).eq("late_date", date);
  if (isLate) {
    await admin.from("late_reports")
      .insert({ project_id: projectId, staff_id: staffId, late_date: date, reason: lateReason || null });
  }

  return { ok: true };
}
