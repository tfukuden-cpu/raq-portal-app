"use server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushLine } from "@/lib/line";
import { redirect } from "next/navigation";

async function requireAdmin(projectId: string) {
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
}

export type SendResult = { staffId: string; name: string; ok: boolean; error?: string };

/** 出発報告未提出スタッフへLINEリマインダー一括送信 */
export async function sendBulkDepartureReminderAction(
  projectId: string,
  staffIds: string[],
): Promise<{ results: SendResult[] }> {
  await requireAdmin(projectId);
  const admin = createAdminClient();
  const { data: staffList } = await admin
    .from("staffs").select("id, display_name, name, line_user_id")
    .in("id", staffIds);
  const staffMap = new Map((staffList ?? []).map(s => [s.id, s]));
  const results: SendResult[] = [];
  for (const staffId of staffIds) {
    const staff = staffMap.get(staffId);
    const name = staff?.display_name ?? staff?.name ?? staffId;
    if (!staff?.line_user_id) {
      results.push({ staffId, name, ok: false, error: "LINE未連携" });
      continue;
    }
    await pushLine(
      staff.line_user_id,
      `【出発確認】${name}さん、出発報告がまだのようです。出発時にアプリから報告をお願いします。`,
    );
    results.push({ staffId, name, ok: true });
  }
  return { results };
}

/** 勤怠ステータスを手動で変更する */
export async function changeAttendanceStatusAction(
  projectId: string,
  staffId: string,
  date: string, // YYYY-MM-DD
  newStatus: "working" | "departed" | "clocked_out" | "absent" | "late" | "not_departed",
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin(projectId);
  const admin = createAdminClient();
  const nowISO = new Date().toISOString();
  const dayStart = `${date}T00:00:00+09:00`;
  const dayEnd   = `${date}T23:59:59+09:00`;

  try {
    if (newStatus === "absent") {
      // 欠勤: 打刻を削除 → 欠勤レポートを upsert
      await admin.from("punch_logs").delete()
        .eq("project_id", projectId).eq("staff_id", staffId)
        .gte("recorded_at", dayStart).lte("recorded_at", dayEnd);
      await admin.from("late_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId).eq("late_date", date);
      await admin.from("departure_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId)
        .gte("reported_at", dayStart).lte("reported_at", dayEnd);
      await admin.from("absence_reports")
        .upsert({ project_id: projectId, staff_id: staffId, absence_date: date, reason: null },
          { onConflict: "project_id,staff_id,absence_date", ignoreDuplicates: true });

    } else if (newStatus === "late") {
      // 遅刻: 欠勤を解除 → 遅刻レポートを upsert
      await admin.from("absence_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId).eq("absence_date", date);
      await admin.from("late_reports")
        .upsert({ project_id: projectId, staff_id: staffId, late_date: date, reason: null },
          { onConflict: "project_id,staff_id,late_date", ignoreDuplicates: true });

    } else if (newStatus === "not_departed") {
      // 未出発: 欠勤・遅刻・出発レポートをすべて削除、打刻は残す
      await admin.from("absence_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId).eq("absence_date", date);
      await admin.from("late_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId).eq("late_date", date);
      await admin.from("departure_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId)
        .gte("reported_at", dayStart).lte("reported_at", dayEnd);
      await admin.from("punch_logs").delete()
        .eq("project_id", projectId).eq("staff_id", staffId)
        .gte("recorded_at", dayStart).lte("recorded_at", dayEnd);

    } else if (newStatus === "departed") {
      // 出発済: 欠勤を解除 → 出発レポートを upsert
      await admin.from("absence_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId).eq("absence_date", date);
      const { data: existing } = await admin.from("departure_reports")
        .select("id").eq("project_id", projectId).eq("staff_id", staffId)
        .gte("reported_at", dayStart).lte("reported_at", dayEnd).maybeSingle();
      if (!existing) {
        await admin.from("departure_reports")
          .insert({ project_id: projectId, staff_id: staffId, reported_at: nowISO, eta_minutes: null });
      }

    } else if (newStatus === "working") {
      // 勤務中: 欠勤・出発を解除 → 出勤打刻がなければ現在時刻で作成
      await admin.from("absence_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId).eq("absence_date", date);
      await admin.from("departure_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId)
        .gte("reported_at", dayStart).lte("reported_at", dayEnd);
      const { data: ci } = await admin.from("punch_logs")
        .select("id").eq("project_id", projectId).eq("staff_id", staffId)
        .eq("punch_type", "clock_in")
        .gte("recorded_at", dayStart).lte("recorded_at", dayEnd).maybeSingle();
      if (!ci) {
        await admin.from("punch_logs")
          .insert({ project_id: projectId, staff_id: staffId, punch_type: "clock_in", recorded_at: nowISO });
      }
      // 退勤があれば削除（勤務中に戻す）
      await admin.from("punch_logs").delete()
        .eq("project_id", projectId).eq("staff_id", staffId)
        .eq("punch_type", "clock_out")
        .gte("recorded_at", dayStart).lte("recorded_at", dayEnd);

    } else if (newStatus === "clocked_out") {
      // 退勤済: 欠勤を解除 → 出勤・退勤打刻を確保
      await admin.from("absence_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId).eq("absence_date", date);
      const { data: ci } = await admin.from("punch_logs")
        .select("id").eq("project_id", projectId).eq("staff_id", staffId)
        .eq("punch_type", "clock_in")
        .gte("recorded_at", dayStart).lte("recorded_at", dayEnd).maybeSingle();
      if (!ci) {
        await admin.from("punch_logs")
          .insert({ project_id: projectId, staff_id: staffId, punch_type: "clock_in", recorded_at: nowISO });
      }
      const { data: co } = await admin.from("punch_logs")
        .select("id").eq("project_id", projectId).eq("staff_id", staffId)
        .eq("punch_type", "clock_out")
        .gte("recorded_at", dayStart).lte("recorded_at", dayEnd).maybeSingle();
      if (!co) {
        await admin.from("punch_logs")
          .insert({ project_id: projectId, staff_id: staffId, punch_type: "clock_out", recorded_at: nowISO });
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** 公休スタッフへ出勤依頼LINE一括送信 */
export async function sendBulkWorkRequestAction(
  projectId: string,
  staffIds: string[],
): Promise<{ results: SendResult[] }> {
  await requireAdmin(projectId);
  const admin = createAdminClient();
  const { data: staffList } = await admin
    .from("staffs").select("id, display_name, name, line_user_id")
    .in("id", staffIds);
  const staffMap = new Map((staffList ?? []).map(s => [s.id, s]));
  const results: SendResult[] = [];
  for (const staffId of staffIds) {
    const staff = staffMap.get(staffId);
    const name = staff?.display_name ?? staff?.name ?? staffId;
    if (!staff?.line_user_id) {
      results.push({ staffId, name, ok: false, error: "LINE未連携" });
      continue;
    }
    await pushLine(
      staff.line_user_id,
      `【出勤依頼】${name}さん、本日はお休みのところ恐れ入ります。急なご連絡で申し訳ございませんが、本日の出勤は可能でしょうか？ご確認いただけますと幸いです。`,
    );
    results.push({ staffId, name, ok: true });
  }
  return { results };
}
