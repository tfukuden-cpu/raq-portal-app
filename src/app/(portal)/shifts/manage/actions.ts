"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { sendEventNotify, logNotify } from "@/lib/notify";
import { multicastLine, pushLine, pushLineWithButton } from "@/lib/line";
import {
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

/** 単一スタッフ×日付のシフトを直接 upsert（番号順ビューの空セル → 公休 等） */
export async function upsertSingleShiftAction(
  projectId: string,
  staffId: string,
  date: string,
  shiftName: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();
  const { error } = await admin.from("shifts").upsert({
    project_id: projectId,
    staff_id:   staffId,
    shift_date: date,
    shift_name: shiftName,
    shift_start: null,
    shift_end:   null,
    note:        null,
  });

  if (error) return { success: false, message: error.message };
  revalidatePath("/shifts/manage");
  return { success: true };
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
    .select("id, line_user_id, display_name, name")
    .in("id", notifications.map(n => n.staffId));

  const staffMap = new Map(
    (staffRows ?? []).map(s => [s.id as string, s])
  );

  const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
  function fmtDateLine(d: string) {
    // d = "YYYY-MM-DD"。UTC midnight として解析し UTC メソッドで取得することで
    // サーバーのローカルタイムゾーン（UTC）に依存しない。
    const dt = new Date(d);
    return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}（${WEEKDAY_JP[dt.getUTCDay()]}）`;
  }

  let sent = 0;
  const noLine: string[] = [];

  for (const n of notifications) {
    const staff  = staffMap.get(n.staffId);
    const lineId = staff?.line_user_id as string | null | undefined;
    if (!lineId) { noLine.push(n.staffName); continue; }

    const staffName = (staff?.display_name ?? staff?.name ?? n.staffName) as string;
    const lines = n.changes.map(c => {
      if (!c.from && c.to) return `${fmtDateLine(c.date)} ${c.to} 新規追加`;
      if (c.from && !c.to) return `${fmtDateLine(c.date)} ${c.from} 削除`;
      return `${fmtDateLine(c.date)} ${c.from} → ${c.to}`;
    });

    const baseMsg = DEFAULT_NOTIFY_MESSAGES.shift_changed;
    const header  = resolveMessage(baseMsg, { "名前": staffName });
    const text    = `${header}\n\n${lines.join("\n")}`;
    await pushLine(lineId, text);
    void logNotify({
      projectId,
      notifyType:    "shift_changed",
      recipientType: "staff",
      recipientId:   n.staffId,
      recipientName: staffName,
      message:       text,
    });
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
  customMessage?: string,
): Promise<PublishShiftsResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate   = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;
  const targetMonth = `${year}/${String(month).padStart(2, "0")}`;

  // 対象月の全シフトを取得（ページネーション対応：PostgREST デフォルト1000行上限を突破）
  const allShifts: { staff_id: string; shift_date: string; shift_name: string; shift_start: string | null; shift_end: string | null }[] = [];
  {
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("shifts")
        .select("staff_id, shift_date, shift_name, shift_start, shift_end")
        .eq("project_id", projectId)
        .gte("shift_date", startDate)
        .lte("shift_date", endDate)
        .order("shift_date")
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      allShifts.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  const shifts = allShifts;

  if (!shifts.length) return { success: false, message: "対象月のシフトがありません" };

  // スタッフ別にシフトをまとめる
  const shiftsByStaff = new Map<string, typeof shifts>();
  for (const s of shifts) {
    const id = s.staff_id as string;
    if (!shiftsByStaff.has(id)) shiftsByStaff.set(id, []);
    shiftsByStaff.get(id)!.push(s);
  }

  // LINE IDを含むスタッフ情報を取得
  const allStaffIds = [...shiftsByStaff.keys()];

  // shift_published = false のスタッフを除外
  const { data: memberRows } = await admin
    .from("project_members")
    .select("staff_id, shift_published")
    .eq("project_id", projectId)
    .in("staff_id", allStaffIds);
  const unpublishedSet = new Set(
    (memberRows ?? []).filter(m => m.shift_published === false).map(m => m.staff_id as string)
  );
  const staffIds = allStaffIds.filter(id => !unpublishedSet.has(id));

  const { data: staffRows } = await admin
    .from("staffs")
    .select("id, display_name, name, line_user_id")
    .in("id", staffIds);

  const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
  const APP_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app";

  let sent = 0;
  const noLine: string[] = [];

  for (const staff of staffRows ?? []) {
    const name   = (staff.display_name ?? staff.name ?? staff.id) as string;
    const lineId = staff.line_user_id as string | null;

    if (!lineId) { noLine.push(name); continue; }

    const myShifts = shiftsByStaff.get(staff.id as string) ?? [];

    // シフト一覧テキスト生成（全シフトを日付順）
    const shiftLines = myShifts
      .sort((a, b) => (a.shift_date as string).localeCompare(b.shift_date as string))
      .map(s => {
        const dt = new Date((s.shift_date as string) + "T12:00:00+09:00");
        const wd = WEEKDAY_JP[dt.getDay()];
        const [, mm, dd] = (s.shift_date as string).split("-");
        const timeStr = s.shift_start && s.shift_end
          ? ` ${(s.shift_start as string).slice(0, 5)}〜${(s.shift_end as string).slice(0, 5)}`
          : "";
        return `${parseInt(mm)}/${parseInt(dd)}（${wd}）${s.shift_name}${timeStr}`;
      })
      .join("\n");

    const baseMsg = customMessage?.trim() || DEFAULT_NOTIFY_MESSAGES.shift_published;
    const message = resolveMessage(baseMsg, {
      "名前": name,
      "対象月": targetMonth,
      "シフト一覧": shiftLines || "（シフトなし）",
    });

    await pushLineWithButton(lineId, message, "シフトを確認する", `${APP_URL}/shifts`, "#10b981");
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
 * シフト確定お知らせをアプリ内に投稿（notices テーブル）
 */
export async function postShiftNoticeAction(
  projectId: string,
  title: string,
  body: string,
  targetStaffId?: string,       // 指定時は個人宛（そのスタッフのみ表示）
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const admin = createAdminClient();

  const { error } = await admin.from("notices").insert({
    project_id:      projectId,
    title:           title.trim(),
    body:            body.trim(),
    is_pinned:       false,
    posted_by:       staffId,
    target_staff_id: targetStaffId ?? null,
  });

  if (error) return { success: false, message: error.message };

  revalidatePath("/notices");
  revalidatePath("/notices/manage");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * シフト通知（別送り）：shift_month_status を更新せず通知のみ送信
 * PublishButton とは独立した「今回だけ送る」用
 */
export async function sendShiftNotifyAction(
  projectId: string,
  year: number,
  month: number,
  customMessage?: string,
  targetStaffId?: string,       // 指定した場合はその1人だけ送信
): Promise<PublishShiftsResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();

  const startDate  = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate    = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;
  const targetMonth = `${year}/${String(month).padStart(2, "0")}`;

  // 対象月のシフトを取得（targetStaffId指定時は1人分のみ）
  const allShifts: { staff_id: string; shift_date: string; shift_name: string; shift_start: string | null; shift_end: string | null }[] = [];
  {
    const PAGE = 1000;
    let from = 0;
    while (true) {
      let q = admin
        .from("shifts")
        .select("staff_id, shift_date, shift_name, shift_start, shift_end")
        .eq("project_id", projectId)
        .gte("shift_date", startDate)
        .lte("shift_date", endDate)
        .order("shift_date")
        .range(from, from + PAGE - 1);
      if (targetStaffId) q = q.eq("staff_id", targetStaffId);
      const { data, error } = await q;
      if (error || !data || data.length === 0) break;
      allShifts.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  if (!allShifts.length) return { success: false, message: "対象月のシフトがありません" };

  const shiftsByStaff = new Map<string, typeof allShifts>();
  for (const s of allShifts) {
    const id = s.staff_id as string;
    if (!shiftsByStaff.has(id)) shiftsByStaff.set(id, []);
    shiftsByStaff.get(id)!.push(s);
  }

  const staffIds = [...shiftsByStaff.keys()];
  const { data: staffRows } = await admin
    .from("staffs")
    .select("id, display_name, name, line_user_id")
    .in("id", staffIds);

  const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
  const APP_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app";

  let sent = 0;
  const noLine: string[] = [];

  for (const staff of staffRows ?? []) {
    const name   = (staff.display_name ?? staff.name ?? staff.id) as string;
    const lineId = staff.line_user_id as string | null;

    if (!lineId) { noLine.push(name); continue; }

    const myShifts = shiftsByStaff.get(staff.id as string) ?? [];

    const shiftLines = myShifts
      .sort((a, b) => (a.shift_date as string).localeCompare(b.shift_date as string))
      .map(s => {
        const dt = new Date((s.shift_date as string) + "T12:00:00+09:00");
        const wd = WEEKDAY_JP[dt.getDay()];
        const [, mm, dd] = (s.shift_date as string).split("-");
        const timeStr = s.shift_start && s.shift_end
          ? ` ${(s.shift_start as string).slice(0, 5)}〜${(s.shift_end as string).slice(0, 5)}`
          : "";
        return `${parseInt(mm)}/${parseInt(dd)}（${wd}）${s.shift_name}${timeStr}`;
      })
      .join("\n");

    const baseMsg = customMessage?.trim() || DEFAULT_NOTIFY_MESSAGES.shift_published;
    const message = resolveMessage(baseMsg, {
      "名前": name,
      "対象月": targetMonth,
      "シフト一覧": shiftLines || "（シフトなし）",
    });

    await pushLineWithButton(lineId, message, "シフトを確認する", `${APP_URL}/shifts`, "#10b981");
    sent++;
  }

  return { success: true, sent, noLine };
}

/**
 * 1スタッフ分のシフト通知プレビューを生成（DBから最新シフトを取得）
 */
export async function previewShiftNotifyAction(
  projectId: string,
  staffId: string,
  year: number,
  month: number,
  messageTemplate: string,
): Promise<{ success: boolean; previewText?: string; staffName?: string; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate   = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;
  const targetMonth = `${year}/${String(month).padStart(2, "0")}`;

  const [{ data: staffRow }, { data: shiftRows }] = await Promise.all([
    admin.from("staffs").select("display_name, name").eq("id", staffId).maybeSingle(),
    admin.from("shifts")
      .select("shift_date, shift_name, shift_start, shift_end")
      .eq("project_id", projectId)
      .eq("staff_id", staffId)
      .gte("shift_date", startDate)
      .lte("shift_date", endDate)
      .order("shift_date"),
  ]);

  const name = (staffRow as { display_name?: string | null; name?: string | null } | null)?.display_name
    ?? (staffRow as { display_name?: string | null; name?: string | null } | null)?.name
    ?? staffId;

  const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
  const shiftLines = (shiftRows ?? []).map(s => {
    const dt  = new Date((s.shift_date as string) + "T12:00:00+09:00");
    const wd  = WEEKDAY_JP[dt.getDay()];
    const [, mm, dd] = (s.shift_date as string).split("-");
    const timeStr = s.shift_start && s.shift_end
      ? ` ${(s.shift_start as string).slice(0, 5)}〜${(s.shift_end as string).slice(0, 5)}`
      : "";
    return `${parseInt(mm)}/${parseInt(dd)}（${wd}）${s.shift_name ?? ""}${timeStr}`;
  }).join("\n");

  const previewText = resolveMessage(messageTemplate, {
    "名前":      name,
    "対象月":    targetMonth,
    "シフト一覧": shiftLines || "（シフトなし）",
  });

  return { success: true, previewText, staffName: name };
}

/**
 * セクション仮確定の種別を設定する
 * lockType: 'none' = 解除, 'slot' = 枠確定（人の入替OK）, 'staff' = 人確定（人を固定）
 * draftEntries を渡すと draft_data も同時保存（再仮組みの保護を確実にするため）
 */
export async function setSectionLockedAction(
  projectId: string,
  targetMonth: string,
  sectionName: string,
  lockType: "none" | "slot" | "staff",
  draftEntries?: GridDraftEntry[],
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const admin = createAdminClient();
  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  // 現在の両ロック状態を取得
  const { data: draftRow } = await admin
    .from("shift_grid_drafts")
    .select("locked_sections, slot_locked_sections")
    .eq("project_id", projectId)
    .eq("target_month", targetMonth)
    .maybeSingle();

  const currentStaff = (draftRow?.locked_sections       as string[] | null) ?? [];
  const currentSlot  = (draftRow?.slot_locked_sections  as string[] | null) ?? [];

  // 一度両方から除去してから、新しいタイプに追加
  const updatedStaff = currentStaff.filter((s: string) => s !== sectionName);
  const updatedSlot  = currentSlot.filter((s:  string) => s !== sectionName);
  if (lockType === "staff") updatedStaff.push(sectionName);
  if (lockType === "slot")  updatedSlot.push(sectionName);

  const baseUpsert = {
    project_id:           projectId,
    target_month:         targetMonth,
    locked_sections:      updatedStaff,
    slot_locked_sections: updatedSlot,
  };

  // draft_data も同時保存（仮確定スタッフ除外の保護が確実に機能するようにする）
  const upsertPayload = draftEntries !== undefined
    ? { ...baseUpsert, draft_data: draftEntries, saved_by: myStaffId, saved_at: new Date().toISOString() }
    : baseUpsert;

  const { error } = await admin
    .from("shift_grid_drafts")
    .upsert(upsertPayload, { onConflict: "project_id,target_month" });

  if (error) return { success: false, message: error.message };

  revalidatePath("/shifts/manage");
  return { success: true };
}

// ── 編集ロック（同時編集防止） ────────────────────────────────────
// TTL = 5分。ハートビートで延長。stale になったら誰でも取得可能。

const EDIT_LOCK_TTL_MS = 5 * 60 * 1000; // 5分

export type AcquireLockResult = {
  success: boolean;
  acquired: boolean;         // true = ロック取得成功
  lockedByName?: string;     // 他ユーザーが保持中の場合の表示名
  lockedAt?: string;         // 保持中の場合のタイムスタンプ
  message?: string;
};

/**
 * 編集ロックを取得する。
 * - 誰も保持していない → 取得成功
 * - 自分が保持している → 再取得成功（ハートビート更新）
 * - 他ユーザーが保持中（5分以内）→ 取得失敗
 * - 他ユーザーのロックが stale（5分超）→ 強制取得成功
 */
export async function acquireEditLockAction(
  projectId: string,
  targetMonth: string,
): Promise<AcquireLockResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, acquired: false, message: "ログインしてください" };

  const admin = createAdminClient();
  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const now = new Date();

  // 現在のロック状態を取得
  const { data: row } = await admin
    .from("shift_grid_drafts")
    .select("editing_by, editing_at")
    .eq("project_id", projectId)
    .eq("target_month", targetMonth)
    .maybeSingle();

  const currentEditor = row?.editing_by as string | null;
  const editingAt = row?.editing_at ? new Date(row.editing_at as string) : null;
  const isStale = !editingAt || (now.getTime() - editingAt.getTime()) > EDIT_LOCK_TTL_MS;

  // 他ユーザーが新鮮なロックを保持中
  if (currentEditor && currentEditor !== myStaffId && !isStale) {
    // 表示名を取得
    const { data: staffData } = await admin
      .from("staffs")
      .select("display_name, name")
      .eq("id", currentEditor)
      .maybeSingle();
    const lockedByName = (staffData as { display_name?: string | null; name?: string | null } | null)?.display_name
      ?? (staffData as { display_name?: string | null; name?: string | null } | null)?.name
      ?? currentEditor;
    return {
      success: true,
      acquired: false,
      lockedByName,
      lockedAt: row?.editing_at as string,
    };
  }

  // ロック取得（upsert）
  const { error } = await admin
    .from("shift_grid_drafts")
    .upsert(
      { project_id: projectId, target_month: targetMonth, editing_by: myStaffId, editing_at: now.toISOString() },
      { onConflict: "project_id,target_month" },
    );

  if (error) return { success: false, acquired: false, message: error.message };
  return { success: true, acquired: true };
}

/** ハートビート：ロックの有効期限を延長する（3分ごとに呼ぶ） */
export async function heartbeatEditLockAction(
  projectId: string,
  targetMonth: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const admin = createAdminClient();
  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { error } = await admin
    .from("shift_grid_drafts")
    .update({ editing_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("target_month", targetMonth)
    .eq("editing_by", myStaffId);

  return { success: !error };
}

/** ロックを解放する（編集終了・閉じるボタン押下時） */
export async function releaseEditLockAction(
  projectId: string,
  targetMonth: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const admin = createAdminClient();
  const myStaffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  // 自分のロックのみ解放
  const { error } = await admin
    .from("shift_grid_drafts")
    .update({ editing_by: null, editing_at: null })
    .eq("project_id", projectId)
    .eq("target_month", targetMonth)
    .eq("editing_by", myStaffId);

  return { success: !error };
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

/** スタッフ個別シフト公開フラグを切り替える */
export async function toggleShiftPublishedAction(
  projectId: string,
  staffId: string,
  published: boolean,
): Promise<{ success: boolean; message?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("project_members")
    .update({ shift_published: published })
    .eq("project_id", projectId)
    .eq("staff_id", staffId);
  if (error) return { success: false, message: error.message };
  return { success: true };
}
