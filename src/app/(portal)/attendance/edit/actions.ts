"use server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sendEventNotify } from "@/lib/notify";

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

export async function confirmAttendanceAction(
  projectId: string,
  staffId: string,
  date: string,
): Promise<CorrectionResult> {
  const reviewerId = await requireAdmin(projectId);
  const admin = createAdminClient();
  const { error } = await admin
    .from("attendance_confirmations")
    .upsert(
      { project_id: projectId, staff_id: staffId, work_date: date, confirmed_by: reviewerId },
      { onConflict: "project_id,staff_id,work_date" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function unconfirmAttendanceAction(
  projectId: string,
  staffId: string,
  date: string,
): Promise<CorrectionResult> {
  await requireAdmin(projectId);
  const admin = createAdminClient();
  const { error } = await admin
    .from("attendance_confirmations")
    .delete()
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .eq("work_date", date);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type ReviewResult = { success: boolean; message?: string };

/** 打刻修正申請 承認・却下（承認時は punch_logs を上書き） */
export async function reviewCorrectionAction(
  formData: FormData,
): Promise<ReviewResult> {
  const id         = String(formData.get("id") ?? "").trim();
  const status     = String(formData.get("status") ?? "");
  const reviewNote = String(formData.get("reviewNote") ?? "").trim() || null;

  if (!id || !["approved", "rejected"].includes(status)) {
    return { success: false, message: "不正なパラメータです" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const reviewerId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const admin = createAdminClient();

  const { data: correction } = await admin
    .from("punch_corrections")
    .select("project_id, staff_id, target_date, corrected_in, corrected_out")
    .eq("id", id)
    .maybeSingle();

  if (!correction) return { success: false, message: "申請が見つかりません" };

  const { error } = await admin
    .from("punch_corrections")
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), review_note: reviewNote })
    .eq("id", id);

  if (error) return { success: false, message: "更新失敗：" + error.message };

  if (status === "approved") {
    const { project_id, staff_id, target_date, corrected_in, corrected_out } = correction;
    const dateStr  = target_date as string;
    const startISO = `${dateStr}T00:00:00+09:00`;
    const endISO   = `${dateStr}T23:59:59+09:00`;

    await admin.from("punch_logs")
      .delete()
      .eq("project_id", project_id).eq("staff_id", staff_id)
      .in("punch_type", ["clock_in", "clock_out"])
      .gte("recorded_at", startISO).lte("recorded_at", endISO);

    const inserts: { project_id: string; staff_id: string; punch_type: string; recorded_at: string; note: string }[] = [];
    if (corrected_in)  inserts.push({ project_id, staff_id, punch_type: "clock_in",  recorded_at: `${dateStr}T${corrected_in}:00+09:00`,  note: "勤怠補正申請による修正" });
    if (corrected_out) inserts.push({ project_id, staff_id, punch_type: "clock_out", recorded_at: `${dateStr}T${corrected_out}:00+09:00`, note: "勤怠補正申請による修正" });
    if (inserts.length > 0) await admin.from("punch_logs").insert(inserts);
  }

  const { data: staffRow } = await admin.from("staffs").select("display_name, name").eq("id", correction.staff_id).maybeSingle();
  const staffName = (staffRow as { display_name?: string | null; name?: string | null } | null)?.display_name
    ?? (staffRow as { display_name?: string | null; name?: string | null } | null)?.name
    ?? correction.staff_id;

  await sendEventNotify(
    correction.project_id as string,
    "correction_result",
    { 名前: staffName, 日付: correction.target_date as string, 結果: status === "approved" ? "承認" : "却下" },
    correction.staff_id as string,
  );

  revalidatePath("/attendance/edit");
  return { success: true };
}
