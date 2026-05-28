"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { sendEventNotify } from "@/lib/notify";
import { multicastLine, pushLine } from "@/lib/line";
import {
  buildDefaultNotificationSettings,
  DEFAULT_NOTIFY_MESSAGES,
} from "@/app/(portal)/admin/[projectId]/settings/notify-config";
import { resolveMessage } from "@/lib/notify";
import type { GridDraftEntry } from "@/app/(portal)/shifts/actions";

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

export type NotifyChangesResult = {
  success: boolean;
  message?: string;
  sent?: number;
  noLine?: string[];
};

/**
 * 確定後に変更対象スタッフへLINEで個別通知を送る
 */
export async function notifyShiftChangesAction(
  projectId: string,
  notifications: { staffId: string; staffName: string; changes: { date: string; from: string | null; to: string | null }[] }[],
): Promise<NotifyChangesResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };
  if (notifications.length === 0) return { success: true, sent: 0, noLine: [] };

  const admin = createAdminClient();
  const { data: staffRows } = await admin
    .from("staffs")
    .select("id, line_user_id")
    .in("id", notifications.map(n => n.staffId));

  const lineMap = new Map(
    (staffRows ?? []).map(s => [s.id as string, s.line_user_id as string | null])
  );

  const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
  function fmtDateLine(d: string) {
    const dt = new Date(d + "T00:00:00+09:00");
    return `${dt.getMonth() + 1}/${dt.getDate()}（${WEEKDAY_JP[dt.getDay()]}）`;
  }

  let sent = 0;
  const noLine: string[] = [];

  for (const n of notifications) {
    const lineId = lineMap.get(n.staffId);
    if (!lineId) { noLine.push(n.staffName); continue; }

    const lines = n.changes.map(c => {
      if (!c.from && c.to) return `${fmtDateLine(c.date)} ${c.to} 新規追加`;
      if (c.from && !c.to) return `${fmtDateLine(c.date)} ${c.from} 削除`;
      return `${fmtDateLine(c.date)} ${c.from} → ${c.to}`;
    });

    const text = `【シフト変更のお知らせ】\n以下のシフトが変更されました。\n\n${lines.join("\n")}`;
    await pushLine(lineId, text);
    sent++;
  }

  return { success: true, sent, noLine };
}

export type PublishShiftsResult = {
  success: boolean;
  message?: string;
  sent?: number;
  noLine?: string[];
};

/**
 * シフト展開：対象月のシフトを全スタッフへLINE通知
 */
export async function publishShiftsAction(
  projectId: string,
  year: number,
  month: number,
): Promise<PublishShiftsResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate   = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;
  const targetMonth = `${year}/${String(month).padStart(2, "0")}`;

  // 対象月の全シフトを取得
  const { data: shifts } = await admin
    .from("shifts")
    .select("staff_id, shift_date, shift_name, shift_start, shift_end")
    .eq("project_id", projectId)
    .gte("shift_date", startDate)
    .lte("shift_date", endDate)
    .order("shift_date");

  if (!shifts?.length) return { success: false, message: "対象月のシフトがありません" };

  // スタッフ別にシフトをまとめる
  const shiftsByStaff = new Map<string, typeof shifts>();
  for (const s of shifts) {
    const id = s.staff_id as string;
    if (!shiftsByStaff.has(id)) shiftsByStaff.set(id, []);
    shiftsByStaff.get(id)!.push(s);
  }

  // 通知設定を取得
  const { data: ps } = await admin
    .from("project_settings")
    .select("notification_settings")
    .eq("project_id", projectId)
    .maybeSingle();
  const settings = buildDefaultNotificationSettings(
    (ps?.notification_settings as Record<string, unknown>) ?? {}
  );

  // LINE IDを含むスタッフ情報を取得
  const staffIds = [...shiftsByStaff.keys()];
  const { data: staffRows } = await admin
    .from("staffs")
    .select("id, display_name, name, line_user_id")
    .in("id", staffIds);

  const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
  let sent = 0;
  const noLine: string[] = [];

  for (const staff of staffRows ?? []) {
    const name   = (staff.display_name ?? staff.name ?? staff.id) as string;
    const lineId = staff.line_user_id as string | null;

    if (!lineId) { noLine.push(name); continue; }

    const myShifts = shiftsByStaff.get(staff.id as string) ?? [];

    // シフト一覧を整形
    const shiftLines = myShifts.map(s => {
      const dt = new Date(`${s.shift_date}T00:00:00+09:00`);
      const dayLabel = `${dt.getMonth() + 1}/${dt.getDate()}（${WEEKDAY_JP[dt.getDay()]}）`;
      const time = s.shift_start && s.shift_end ? ` ${s.shift_start}〜${s.shift_end}` : "";
      const sName = s.shift_name ? ` ${s.shift_name}` : "";
      return `・${dayLabel}${sName}${time}`;
    }).join("\n");

    const baseMsg = settings.shift_published.message ?? DEFAULT_NOTIFY_MESSAGES.shift_published;
    const header  = resolveMessage(baseMsg, { "名前": name, "対象月": targetMonth });
    const message = `${header}\n\n${shiftLines}`;

    await pushLine(lineId, message);
    sent++;
  }

  // 展開済みとして記録
  const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
  await admin.from("shift_month_status").upsert(
    {
      project_id:   projectId,
      year_month:   yearMonth,
      published_by: user.email?.split("@")[0]?.toUpperCase() ?? "",
    },
    { onConflict: "project_id,year_month" }
  );

  return { success: true, sent, noLine };
}

/**
 * セクション仮確定のON/OFFを切り替える
 * draftEntries を渡すと draft_data も同時保存（再仮組みの保護を確実にするため）
 */
export async function setSectionLockedAction(
  projectId: string,
  targetMonth: string,
  sectionName: string,
  locked: boolean,
  draftEntries?: GridDraftEntry[],
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();
  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  // 現在の locked_sections を取得
  const { data: draftRow } = await admin
    .from("shift_grid_drafts")
    .select("locked_sections")
    .eq("project_id", projectId)
    .eq("target_month", targetMonth)
    .maybeSingle();

  const current = (draftRow?.locked_sections as string[] | null) ?? [];
  const updated = locked
    ? [...new Set([...current, sectionName])]
    : current.filter((s: string) => s !== sectionName);

  // draft_data も同時保存：再仮組み時の「仮確定スタッフ除外」が確実に機能するようにする
  // draftEntries が渡された場合は draft_data も同時更新、そうでなければ locked_sections のみ更新
  let upsertError: { message: string } | null = null;
  if (draftEntries !== undefined) {
    const { error } = await admin
      .from("shift_grid_drafts")
      .upsert(
        {
          project_id:      projectId,
          target_month:    targetMonth,
          locked_sections: updated,
          draft_data:      draftEntries,
          saved_by:        myStaffId,
          saved_at:        new Date().toISOString(),
        },
        { onConflict: "project_id,target_month" },
      );
    upsertError = error;
  } else {
    const { error } = await admin
      .from("shift_grid_drafts")
      .upsert(
        { project_id: projectId, target_month: targetMonth, locked_sections: updated },
        { onConflict: "project_id,target_month" },
      );
    upsertError = error;
  }
  const error = upsertError;

  if (error) return { success: false, message: error.message };

  revalidatePath("/shifts/manage");
  return { success: true };
}

/**
 * 再仮組：シフトパターンを自動取得して仮組みを生成する
 * （展開前の管理画面から「再仮組」ボタン用）
 */
export async function regenerateShiftDraftAction(
  projectId: string,
  year: number,
  month: number,
  targetSection?: string,
  noSave?: boolean,          // true = DBへ書き込まない（グリッド編集内の再仮組み用）
  lockedSections?: string[], // 全体再仮組み時にスキップするセクション（仮確定済み）
): Promise<{ success: boolean; message?: string; assignedCount?: number; draftEntries?: import("../actions").GridDraftEntry[] }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();

  // パターン一覧を取得
  const { data: patternRows, error: patternErr } = await admin
    .from("shift_patterns")
    .select("name, section, start_time, end_time, target_role, required_count, required_weekday, required_weekend")
    .eq("project_id", projectId)
    .order("sort_order");

  if (patternErr || !patternRows) {
    return { success: false, message: "パターン取得失敗: " + (patternErr?.message ?? "") };
  }

  const patterns = patternRows.map(p => ({
    name:             p.name as string,
    section:          (p.section ?? null) as string | null,
    start_time:       (p.start_time ?? null) as string | null,
    end_time:         (p.end_time ?? null) as string | null,
    target_role:      (p.target_role ?? "all") as string,
    required_count:   (p.required_count ?? null) as number | null,
    required_weekday: (p.required_weekday ?? null) as number | null,
    required_weekend: (p.required_weekend ?? null) as number | null,
  }));

  const { generateShiftDraftAction } = await import(
    "@/app/(portal)/admin/[projectId]/settings/draft-actions"
  );
  const result = await generateShiftDraftAction(projectId, year, month, patterns, targetSection, noSave, lockedSections);
  if (!result.success) return result;

  // noSave=true のときは result.draftEntries をそのまま返す（DB フェッチ不要）
  // noSave=false のときも result.draftEntries が返されるので DB フェッチ不要
  return {
    ...result,
    draftEntries: (result.draftEntries ?? []) as import("../actions").GridDraftEntry[],
  };
}
