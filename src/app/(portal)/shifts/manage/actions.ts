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
    .select("project_id, staff_id, request_date, shift_openings(shift_name), staffs(display_name, name)")
    .eq("id", requestId)
    .maybeSingle();
  if (!data) return null;

  const opening = Array.isArray(data.shift_openings) ? data.shift_openings[0] : data.shift_openings;
  const staff   = Array.isArray(data.staffs)         ? data.staffs[0]         : data.staffs;

  return {
    projectId:  data.project_id as string,
    staffId:    data.staff_id as string,
    staffName:  (staff as { display_name: string | null; name: string | null } | null)?.display_name
              ?? (staff as { display_name: string | null; name: string | null } | null)?.name
              ?? (data.staff_id as string),
    date:       data.request_date as string,
    shiftName:  (opening as { shift_name: string } | null)?.shift_name ?? "シフト追加",
  };
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

/** 指定日に公休のスタッフ全員にLINEで出勤追加依頼を送る */
export async function requestExtraShiftByLineAction(
  projectId: string,
  shiftDate: string,
  customMessage?: string,
): Promise<LineRequestResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();

  // 対象日に「公休」のスタッフIDを取得
  const { data: offShifts, error: shiftErr } = await admin
    .from("shifts")
    .select("staff_id")
    .eq("project_id", projectId)
    .eq("shift_date", shiftDate)
    .eq("shift_name", "公休");

  if (shiftErr) return { success: false, message: shiftErr.message };
  if (!offShifts || offShifts.length === 0) {
    return { success: false, message: "当日公休のスタッフがいません" };
  }

  const staffIds = offShifts.map(s => s.staff_id as string);

  // staffs テーブルから line_user_id と名前を取得
  const { data: staffRows, error: staffErr } = await admin
    .from("staffs")
    .select("id, display_name, name, line_user_id")
    .in("id", staffIds);

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

  // 日付を日本語表記に変換（例: 2026-05-20 → 5/20（水））
  const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
  const dt = new Date(shiftDate);
  const dateLabel = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}（${WEEKDAY_JP[dt.getUTCDay()]}）`;

  const text = customMessage?.trim()
    || `【出勤のご協力をお願いします】\n${dateLabel}にシフトの空きが出ています。\nご都合がよければ管理者にご連絡ください。`;

  await multicastLine(withLine, text);

  return { success: true, sent: withLine.length, noLine: noLineNames };
}
