/**
 * 欠勤者 経過報告ページ（サーバーコンポーネント）
 * 当日の欠勤理由・翌日シフトを取得してクライアントに渡す
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import FollowupClient from "./FollowupClient";

export default async function AbsenceFollowupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  // 当日欠勤レコードを取得（症状はFollowupClientのプリフィル用）
  const { data: absence } = await supabase
    .from("absence_reports")
    .select("reason, symptoms, followup_recovery_status")
    .eq("staff_id", staffId)
    .eq("project_id", projectId)
    .eq("absence_date", today)
    .maybeSingle();

  // 翌日シフトの有無を確認
  const { data: tomorrowShift } = await supabase
    .from("shifts")
    .select("id")
    .eq("staff_id", staffId)
    .eq("project_id", projectId)
    .eq("shift_date", tomorrowStr)
    .not("shift_name", "in", '("公休","休","公休日","欠勤","有休","振替休日","特別休暇","代休")')
    .maybeSingle();

  // 既に経過報告済みかどうか（followup_recovery_status が入っていれば提出済み）
  const alreadySubmitted = !!absence?.followup_recovery_status;

  return (
    <FollowupClient
      absenceDate={today}
      absenceReason={absence?.reason ?? null}
      initialSymptoms={absence?.symptoms ?? null}
      tomorrowHasShift={!!tomorrowShift}
      alreadySubmitted={alreadySubmitted}
    />
  );
}
