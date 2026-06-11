/**
 * ホーム画面アクション（出発報告・欠勤報告・遅刻報告）
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";
import { appendSheetRow, extractSpreadsheetId } from "@/lib/gsheets";
import { sendEventNotify } from "@/lib/notify";
import { pushLine } from "@/lib/line";

export type ActionResult = {
  success: boolean;
  message?: string;
};

/** マイキャラクター変更（staffs.rpg_character・本人のみ） */
export async function setMyRpgCharacterAction(charId: number | null): Promise<ActionResult> {
  try {
    if (charId !== null && (!Number.isInteger(charId) || charId < 1 || charId > 500)) {
      return { success: false, message: "不正なキャラクター番号です" };
    }
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, message: "ログインしてください" };
    const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
    if (!staffId) return { success: false, message: "スタッフIDを特定できません" };

    const admin = createAdminClient();
    const { error } = await admin
      .from("staffs")
      .update({ rpg_character: charId })
      .eq("id", staffId);
    if (error) return { success: false, message: error.message };
    revalidatePath("/dashboard");
    return { success: true, message: "キャラクターを変更しました" };
  } catch (e) {
    console.error("setMyRpgCharacter error:", e);
    return { success: false, message: "キャラクターの変更に失敗しました" };
  }
}

/** 出発報告 */
export async function recordDepartureAction(
  fd: FormData
): Promise<ActionResult> {
  const etaMinutes = Number(fd.get("etaMinutes") ?? 0) || null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const { error } = await supabase.from("departure_reports").insert({
    staff_id:    staffId,
    project_id:  projectId,
    eta_minutes: etaMinutes,
  });

  if (error) {
    console.error("departure error:", error);
    return { success: false, message: "送信失敗: " + error.message };
  }

  revalidatePath("/dashboard");

  // LINE通知（fire-and-forget）
  void (async () => {
    try {
      const { data: staffData } = await supabase
        .from("staffs").select("display_name, name, line_user_id").eq("id", staffId).maybeSingle();
      const name   = staffData?.display_name ?? staffData?.name ?? staffId;
      const lineId = staffData?.line_user_id as string | null;

      const admin = createAdminClient();
      const { data: ps } = await admin
        .from("project_settings").select("line_group_id")
        .eq("project_id", projectId).maybeSingle();
      const groupId = ps?.line_group_id as string | null;

      const etaText = etaMinutes ? `約${etaMinutes}分後` : "不明";
      const adminMsg = `【出発報告】\n${name}さんが出発しました。\n到着予定：${etaText}`;

      // 管理者グループへ通知
      if (groupId) await pushLine(groupId, adminMsg);

      // 出発したスタッフ本人へ確認メッセージ
      if (lineId) {
        await pushLine(lineId, `出発報告を受け付けました。\n現場への移動中もお気をつけください。`);
      }
    } catch (e) {
      console.error("[departure] LINE送信エラー:", e);
    }
  })();

  return { success: true, message: "出発報告を送信しました" };
}

/** 欠勤報告 */
export async function submitAbsenceAction(
  fd: FormData
): Promise<ActionResult> {
  const reason          = String(fd.get("reason")         ?? "").trim();
  const symptomsJson    = String(fd.get("symptomsJson")   ?? "{}");
  const recoveryStatus  = String(fd.get("recoveryStatus") ?? "").trim() || null;
  const hasConsultation = fd.get("hasConsultation") === "true";
  const nextDayHasShift = fd.get("nextDayHasShift") === "true";

  if (!reason) return { success: false, message: "理由を入力してください" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  let symptoms: Record<string, unknown> = {};
  try { symptoms = JSON.parse(symptomsJson); } catch { /* ignore */ }

  const { error } = await supabase.from("absence_reports").insert({
    staff_id:         staffId,
    project_id:       projectId,
    absence_date:     today,
    reason,
    symptoms,
    recovery_status:  recoveryStatus,
    has_consultation: hasConsultation,
    status:           "pending",
  });

  if (error) {
    console.error("absence error:", error);
    return { success: false, message: "送信失敗: " + error.message };
  }

  revalidatePath("/dashboard");

  // スタッフ名取得
  const { data: staffData } = await supabase
    .from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
  const name = staffData?.display_name ?? staffData?.name ?? staffId;

  // 日付を MM/DD 形式に
  const [, mm, dd] = today.split("-");
  const dateLabel = `${parseInt(mm)}/${parseInt(dd)}`;

  // 症状テキスト整形
  const s = symptoms as {
    fever?: boolean; fever_temp?: string; headache?: boolean; cough?: boolean;
    fatigue?: boolean; nausea?: boolean; other?: boolean; other_detail?: string;
  };
  const symptomLines: string[] = [];
  if (s.fever)    symptomLines.push(`発熱：有${s.fever_temp ? `（${s.fever_temp}度）` : ""}`);
  if (s.headache) symptomLines.push("頭痛：有");
  if (s.cough)    symptomLines.push("咳や喉の痛み：有");
  if (s.fatigue)  symptomLines.push("だるさ倦怠感：有");
  if (s.nausea)   symptomLines.push("吐き気や嘔吐：有");
  if (s.other)    symptomLines.push(`その他：${s.other_detail || "有"}`);
  const symptomText = symptomLines.length > 0 ? symptomLines.join("、") : "なし";

  // スプレッドシートへ追記
  try {
    const { data: settings } = await supabase
      .from("project_settings")
      .select("sheet_url")
      .eq("project_id", projectId)
      .maybeSingle();
    const spreadsheetId = settings?.sheet_url
      ? extractSpreadsheetId(settings.sheet_url) : null;
    if (spreadsheetId) {
      const nowJST = new Date()
        .toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).replace("T", " ");
      await appendSheetRow(spreadsheetId, "欠勤報告", [
        nowJST, staffId, name, today, reason, symptomText,
        recoveryStatus ?? "-",
        hasConsultation ? "有" : "無",
        nextDayHasShift ? "有" : "無",
      ]);
    }
  } catch (e) {
    console.error("欠勤報告スプシ追記エラー:", e);
  }

  // LINE通知：フォーマット通りに整形して管理者グループへ送信
  const syms = symptoms as {
    fever?: boolean; fever_temp?: string; headache?: boolean; cough?: boolean;
    fatigue?: boolean; nausea?: boolean; other?: boolean; other_detail?: string;
  };
  const fmtYN = (v?: boolean) => v ? "有" : "無";
  const lines = [
    `【欠員報告フォーマット_${dateLabel}】`,
    `※当日「9:00」までに必ずご報告お願いたします※`,
    `-------------------------------`,
    `□報告日：${dateLabel}`,
    `□報告者：${name}`,
    `□報告区分：欠勤`,
    `□理由：${reason}`,
    `□症状等：`,
    `・発熱：${fmtYN(syms.fever)}${syms.fever && syms.fever_temp ? `（${syms.fever_temp}度）` : ""}`,
    `・頭痛：${fmtYN(syms.headache)}`,
    `・咳や喉の痛み：${fmtYN(syms.cough)}`,
    `・だるさ倦怠感：${fmtYN(syms.fatigue)}`,
    `・吐き気や嘔吐：${fmtYN(syms.nausea)}`,
    `・その他：${fmtYN(syms.other)}${syms.other && syms.other_detail ? `（${syms.other_detail}）` : ""}`,
    ...(recoveryStatus ? [`□軽快状況：${recoveryStatus}`] : []),
    `□当日受診予定：${hasConsultation ? "有" : "無"}`,
    `□翌日出勤予定：${nextDayHasShift ? "有" : "無"}`,
    `□翌日出勤可否報告予定：17:00`,
  ];
  const message = lines.join("\n");

  void (async () => {
    try {
      const admin = createAdminClient();
      const { data: ps } = await admin
        .from("project_settings").select("line_group_id")
        .eq("project_id", projectId).maybeSingle();
      const groupId = ps?.line_group_id as string | null;
      if (groupId) await pushLine(groupId, message);
    } catch (e) {
      console.error("[absence] LINE送信エラー:", e);
    }
  })();

  // LINE通知：申請したスタッフ本人へ（受付完了）
  void sendEventNotify(projectId, "absence_confirm", { "名前": name }, staffId);

  return { success: true, message: "欠勤報告を送信しました" };
}

/** 遅刻報告 */
export async function submitLateAction(fd: FormData): Promise<ActionResult> {
  const reason      = String(fd.get("reason")      ?? "").trim();
  const etaMinutes  = Number(fd.get("etaMinutes")  ?? "");

  if (!reason) return { success: false, message: "理由を入力してください" };

  // etaMinutes から期待到着時刻を計算（JST）
  let expectedArrival = "";
  if (etaMinutes > 0) {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    now.setMinutes(now.getMinutes() + etaMinutes);
    expectedArrival = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  const { error } = await supabase.from("late_reports").insert({
    staff_id:         staffId,
    project_id:       projectId,
    late_date:        today,
    reason,
    expected_arrival: expectedArrival || null,
    status:           "pending",
  });

  if (error) {
    console.error("late error:", error);
    return { success: false, message: "送信失敗: " + error.message };
  }

  revalidatePath("/dashboard");

  // スタッフ名取得
  const { data: staffData } = await supabase
    .from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
  const name = staffData?.display_name ?? staffData?.name ?? staffId;

  // LINE通知：管理者グループへ（遅刻申請）
  void sendEventNotify(projectId, "tardiness", {
    "名前":        name,
    "日付":        today,
    "遅刻理由":    reason,
    "到着目安時間": expectedArrival || "未定",
  });

  return { success: true, message: "遅刻報告を送信しました" };
}
