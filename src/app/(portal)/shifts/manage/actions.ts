"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { sendEventNotify } from "@/lib/notify";
import { multicastLine } from "@/lib/line";

export type ActionResult = { success: boolean; message?: string };

async function fetchRequestInfo(requestId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shift_requests")
    .select("project_id, staff_id, request_date, shift_openings(shift_name, shift_start, shift_end), staffs(display_name, name)")
    .eq("id", requestId)
    .maybeSingle();
  if (!data) return null;

  const opening = Array.isArray(data.shift_openings) ? data.shift_openings[0] : data.shift_openings;
  const staff   = Array.isArray(data.staffs)         ? data.staffs[0]         : data.staffs;
  const openingObj = opening as { shift_name: string; shift_start: string | null; shift_end: string | null } | null;

  return {
    projectId:  data.project_id as string,
    staffId:    data.staff_id as string,
    staffName:  (staff as { display_name: string | null; name: string | null } | null)?.display_name
              ?? (staff as { display_name: string | null; name: string | null } | null)?.name
              ?? (data.staff_id as string),
    date:       data.request_date as string,
    shiftName:  openingObj?.shift_name ?? "シフト追加",
    shiftStart: openingObj?.shift_start ?? null,
    shiftEnd:   openingObj?.shift_end ?? null,
  };
}

export async function upsertSlotRequirementsAction(
  projectId: string,
  changes: { patternName: string; date: string; section: string | null; requiredCount: number }[],
): Promise<ActionResult> {
  if (changes.length === 0) return { success: true };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();
  const rows = changes.map(c => ({
    project_id:     projectId,
    section:        c.section ?? "",
    pattern_name:   c.patternName,
    shift_date:     c.date,
    required_count: c.requiredCount,
  }));

  const { error } = await admin
    .from("shift_slot_requirements")
    .upsert(rows, { onConflict: "project_id,section,pattern_name,shift_date" });

  if (error) return { success: false, message: error.message };

  revalidatePath("/shifts/manage");
  return { success: true };
}

export async function approveShiftRequestAction(requestId: string): Promise<ActionResult> {
  if (!requestId) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const info = await fetchRequestInfo(requestId);

  const admin = createAdminClient();
  const { error } = await admin
    .from("shift_requests")
    .update({ status: "approved" })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { success: false, message: error.message };

  // 承認と同時にシフトを自動登録
  if (info) {
    await admin.from("shifts").upsert({
      project_id: info.projectId,
      staff_id:   info.staffId,
      shift_date: info.date,
      shift_name: info.shiftName,
      shift_start: info.shiftStart,
      shift_end:   info.shiftEnd,
    }, { onConflict: "project_id,staff_id,shift_date" });
  }

  revalidatePath("/shifts/manage");
  revalidatePath("/shifts");

  if (info) {
    await sendEventNotify(info.projectId, "shift_request_result", {
      名前:   info.staffName,
      日付:   info.date,
      シフト: info.shiftName,
      結果:   "承認",
    }, info.staffId);
  }

  return { success: true, message: "承認しました" };
}

export async function rejectShiftRequestAction(requestId: string): Promise<ActionResult> {
  if (!requestId) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const info = await fetchRequestInfo(requestId);

  const admin = createAdminClient();
  const { error } = await admin
    .from("shift_requests")
    .update({ status: "rejected" })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { success: false, message: error.message };

  revalidatePath("/shifts/manage");
  revalidatePath("/shifts");

  if (info) {
    await sendEventNotify(info.projectId, "shift_request_result", {
      名前:   info.staffName,
      日付:   info.date,
      シフト: info.shiftName,
      結果:   "却下",
    }, info.staffId);
  }

  return { success: true, message: "却下しました" };
}

export type LineRequestResult = {
  success: boolean;
  message?: string;
  sent?: number;
  noLine?: string[];
};

/**
 * 指定日・セクションで公休のスタッフへLINEで出勤追加依頼を送る
 * targetStaffIds: UIで絞り込んだ対象スタッフIDリスト（空なら全公休対象）
 */
export async function requestExtraShiftByLineAction(
  projectId: string,
  shiftDate: string,
  targetStaffIds: string[],
  shiftName: string,
  customMessage?: string,
): Promise<LineRequestResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  if (targetStaffIds.length === 0) {
    return { success: false, message: "送信対象のスタッフがいません" };
  }

  const admin = createAdminClient();

  // staffs テーブルから line_user_id と名前を取得
  const { data: staffRows, error: staffErr } = await admin
    .from("staffs")
    .select("id, display_name, name, line_user_id")
    .in("id", targetStaffIds);

  if (staffErr) return { success: false, message: staffErr.message };

  const withLine:    string[] = [];
  const noLineNames: string[] = [];

  for (const s of staffRows ?? []) {
    const staffName = (s.display_name ?? s.name ?? s.id) as string;
    if (s.line_user_id) {
      withLine.push(s.line_user_id as string);
    } else {
      noLineNames.push(staffName);
    }
  }

  if (withLine.length === 0) {
    return { success: false, message: "LINE連携済みのスタッフがいません", noLine: noLineNames };
  }

  const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
  const dt = new Date(shiftDate);
  const dateLabel = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}（${WEEKDAY_JP[dt.getUTCDay()]}）`;

  const text = customMessage?.trim()
    || `【出勤のご協力をお願いします】\n${dateLabel}の${shiftName}に空きが出ています。\nご都合がよければ管理者にご連絡ください。`;

  await multicastLine(withLine, text);

  return { success: true, sent: withLine.length, noLine: noLineNames };
}
