"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminLineIds, resolveMessage } from "@/lib/notify";
import { multicastLine } from "@/lib/line";
import {
  buildDefaultNotificationSettings,
  DEFAULT_NOTIFY_MESSAGES,
} from "@/app/(portal)/admin/[projectId]/settings/notify-config";
import { getCurrentProjectId } from "@/lib/project-context";

export async function submitFollowupAction(fd: FormData): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId      = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const nextAvail    = fd.get("next_day_available") === "true";
  const symptoms     = String(fd.get("symptoms") ?? "").trim();
  const absenceDate  = String(fd.get("absence_date") ?? "");

  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const admin = createAdminClient();

  // 今日の欠勤レコードを更新
  const { error: updateErr } = await admin
    .from("absence_reports")
    .update({ next_day_available: nextAvail })
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .eq("absence_date", absenceDate);

  if (updateErr) return { success: false, message: updateErr.message };

  // 翌日不可の場合は翌日分の欠勤レコードを作成
  if (!nextAvail) {
    const d = new Date(absenceDate);
    d.setDate(d.getDate() + 1);
    const tmrw = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

    await admin.from("absence_reports").upsert({
      project_id:   projectId,
      staff_id:     staffId,
      absence_date: tmrw,
      reason:       symptoms || "経過報告：翌日出勤不可",
      next_day_available: null,
    }, { onConflict: "project_id,staff_id,absence_date" });
  }

  // スタッフ名を取得
  const { data: staff } = await admin
    .from("staffs")
    .select("display_name, name")
    .eq("id", staffId)
    .maybeSingle();
  const name = staff?.display_name ?? staff?.name ?? staffId;

  // 管理者グループへ経過報告通知
  const { data: ps } = await admin
    .from("project_settings")
    .select("notification_settings")
    .eq("project_id", projectId)
    .maybeSingle();

  const settings = buildDefaultNotificationSettings(
    (ps?.notification_settings as Record<string, unknown>) ?? {}
  );

  if (settings.absence_followup_notify.enabled) {
    const adminIds = await getAdminLineIds(projectId);
    if (adminIds.length > 0) {
      const availText = nextAvail ? "出勤可" : "出勤不可";
      const symptomsText = !nextAvail && symptoms ? `【症状】${symptoms}` : "";
      const message = resolveMessage(
        settings.absence_followup_notify.message ?? DEFAULT_NOTIFY_MESSAGES.absence_followup_notify,
        {
          "名前": name,
          "日付": absenceDate,
          "翌日出勤可否": availText,
          "症状": symptomsText,
        }
      );
      await multicastLine(adminIds, message);
    }
  }

  revalidatePath("/attendance");
  return { success: true };
}
