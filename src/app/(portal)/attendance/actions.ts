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
