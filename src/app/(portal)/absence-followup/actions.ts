"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminLineIds } from "@/lib/notify";
import { multicastLine, pushLine } from "@/lib/line";
import { getCurrentProjectId } from "@/lib/project-context";

export async function submitFollowupAction(
  fd: FormData
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const absenceDate       = String(fd.get("absence_date")        ?? "");
  const symptomsJson      = String(fd.get("symptomsJson")        ?? "{}");
  const recoveryStatus    = String(fd.get("recoveryStatus")      ?? "").trim();
  const consultStatus     = String(fd.get("consultationStatus")  ?? "").trim();
  const nextDayAvailable  = fd.get("nextDayAvailable") === "true";
  const nextDayAvailLabel = String(fd.get("nextDayAvailLabel")   ?? "");
  const nextReportDate    = String(fd.get("nextReportDate")      ?? "").trim() || null;
  const nextReportTime    = String(fd.get("nextReportTime")      ?? "").trim() || null;
  const tomorrowHasShift  = fd.get("tomorrowHasShift") === "true";

  let symptoms: Record<string, unknown> = {};
  try { symptoms = JSON.parse(symptomsJson); } catch { /* ignore */ }

  const admin = createAdminClient();

  // 当日欠勤レコードを更新
  const { error: updateErr } = await admin
    .from("absence_reports")
    .update({
      next_day_available:          nextDayAvailable,
      followup_symptoms:           symptoms,
      followup_recovery_status:    recoveryStatus,
      followup_consultation_status: consultStatus,
      followup_next_report_date:   nextReportDate,
      followup_next_report_time:   nextReportTime,
    })
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .eq("absence_date", absenceDate);

  if (updateErr) return { success: false, message: updateErr.message };

  // 翌日出勤困難の場合は翌日欠勤レコードを作成
  if (!nextDayAvailable) {
    const d = new Date(absenceDate);
    d.setDate(d.getDate() + 1);
    const tmrw = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

    await admin.from("absence_reports").upsert({
      project_id:   projectId,
      staff_id:     staffId,
      absence_date: tmrw,
      reason:       "経過報告：翌日出勤困難",
      next_day_available: null,
      status: "pending",
    }, { onConflict: "project_id,staff_id,absence_date" });
  }

  // スタッフ名を取得
  const { data: staffData } = await admin
    .from("staffs")
    .select("display_name, name")
    .eq("id", staffId)
    .maybeSingle();
  const name = staffData?.display_name ?? staffData?.name ?? staffId;

  // 日付ラベル MM/DD
  const [, mm, dd] = absenceDate.split("-");
  const dateLabel = `${parseInt(mm)}/${parseInt(dd)}`;

  // 症状テキスト整形
  const s = symptoms as {
    fever?: boolean; fever_temp?: string; headache?: boolean; cough?: boolean;
    fatigue?: boolean; nausea?: boolean; other?: boolean; other_detail?: string;
  };
  const fmtYN = (v?: boolean) => v ? "有" : "無";

  // LINE通知メッセージ（フォーマット通り）
  const lines = [
    `【経過報告フォーマット_${dateLabel}】`,
    `※当日「17:00」までに必ずご報告お願いたします※`,
    `-------------------------------`,
    `□報告日：${dateLabel}`,
    `□報告者：${name}`,
    `□報告区分：体調経過`,
    `□症状等：`,
    `・発熱：${fmtYN(s.fever)}${s.fever && s.fever_temp ? `（${s.fever_temp}度）` : ""}`,
    `・頭痛：${fmtYN(s.headache)}`,
    `・咳や喉の痛み：${fmtYN(s.cough)}`,
    `・だるさ倦怠感：${fmtYN(s.fatigue)}`,
    `・吐き気や嘔吐：${fmtYN(s.nausea)}`,
    `・その他：${fmtYN(s.other)}${s.other && s.other_detail ? `（${s.other_detail}）` : ""}`,
    `□軽快状況：${recoveryStatus}`,
    `□当日受診状況：${consultStatus}`,
    `□翌日出勤予定：${tomorrowHasShift ? "有" : "無"}`,
    `□翌日出勤可否：${nextDayAvailLabel}`,
    ...(nextDayAvailLabel === "出勤困難" && nextReportDate
      ? [`□次回出勤可否報告予定：${nextReportDate.replace(/(\d{4})-(\d{2})-(\d{2})/, (_, y, m, d) => `${parseInt(m)}/${parseInt(d)}`)}${nextReportTime ? ` ${nextReportTime}` : ""}`]
      : []),
  ];
  const message = lines.join("\n");

  // LINE通知：管理者グループ＋個人LINEへ送信
  void (async () => {
    try {
      const { data: ps } = await admin
        .from("project_settings").select("line_group_id")
        .eq("project_id", projectId).maybeSingle();
      const groupId  = ps?.line_group_id as string | null;
      const adminIds = await getAdminLineIds(projectId);
      if (adminIds.length > 0) await multicastLine(adminIds, message);
      if (groupId) await pushLine(groupId, message);
    } catch (e) {
      console.error("[followup] LINE送信エラー:", e);
    }
  })();

  revalidatePath("/dashboard");
  return { success: true };
}
