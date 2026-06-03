"use server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushLine, pushLineWithButton } from "@/lib/line";
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
      // 欠勤: 打刻・遅刻・出発を削除 → 欠勤レポートを作成（なければ）
      await admin.from("punch_logs").delete()
        .eq("project_id", projectId).eq("staff_id", staffId)
        .gte("recorded_at", dayStart).lte("recorded_at", dayEnd);
      await admin.from("late_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId).eq("late_date", date);
      await admin.from("departure_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId)
        .gte("reported_at", dayStart).lte("reported_at", dayEnd);
      const { data: existingAbs } = await admin.from("absence_reports")
        .select("id").eq("project_id", projectId).eq("staff_id", staffId)
        .eq("absence_date", date).maybeSingle();
      if (!existingAbs) {
        const { error } = await admin.from("absence_reports")
          .insert({ project_id: projectId, staff_id: staffId, absence_date: date, reason: "管理者設定" });
        if (error) return { ok: false, error: error.message };
      }

    } else if (newStatus === "late") {
      // 遅刻: 欠勤を解除 → 遅刻レポートを作成（なければ）
      await admin.from("absence_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId).eq("absence_date", date);
      const { data: existingLate } = await admin.from("late_reports")
        .select("id").eq("project_id", projectId).eq("staff_id", staffId)
        .eq("late_date", date).maybeSingle();
      if (!existingLate) {
        const { error } = await admin.from("late_reports")
          .insert({ project_id: projectId, staff_id: staffId, late_date: date, reason: "管理者設定" });
        if (error) return { ok: false, error: error.message };
      }

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
      // 勤務中（現場状態）: 欠勤・出発を解除。
      // ★ 出勤打刻(clock_in)は自動作成しない＝打刻状態と勤怠ステータスを分離。
      //   未打刻のスタッフはスタッフ用打刻ページ/座席表から本人が出勤打刻できる。
      await admin.from("absence_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId).eq("absence_date", date);
      await admin.from("departure_reports").delete()
        .eq("project_id", projectId).eq("staff_id", staffId)
        .gte("reported_at", dayStart).lte("reported_at", dayEnd);
      // 退勤があれば削除（現場状態を勤務中に戻す）。出勤打刻は作らない。
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

/** 離脱リスクフラグをON/OFFする */
export async function toggleChurnRiskAction(
  projectId: string,
  staffId: string,
  value: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin(projectId);
  const admin = createAdminClient();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  // ON にする場合は既存の since 日付があればそれを維持、なければ今日
  let churnRiskSince: string | null = null;
  if (value) {
    const { data: cur } = await admin.from("project_members")
      .select("churn_risk_since").eq("project_id", projectId).eq("staff_id", staffId).maybeSingle();
    churnRiskSince = cur?.churn_risk_since ?? today;
  }
  const { error } = await admin.from("project_members")
    .update({ churn_risk: value, churn_risk_since: churnRiskSince })
    .eq("project_id", projectId).eq("staff_id", staffId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type StaffDetails = {
  company_name: string | null;
  role: string;
  account_number: string | null;
  start_date: string | null;
  work_days_type: string | null;
  work_days_count: number | null;
  preferred_shift: string | null;
  preferred_section: string | null;
  max_consecutive_days: number | null;
  sections: string[];
};

/** スタッフ詳細情報を取得（StaffPopupMenuの表示用） */
export async function getStaffDetailsAction(
  projectId: string,
  staffId: string,
): Promise<StaffDetails | null> {
  await requireAdmin(projectId);
  const admin = createAdminClient();
  const { data } = await admin.from("project_members")
    .select("role, section, sections, work_days_type, work_days_count, preferred_shift, preferred_section, max_consecutive_days, start_date, staffs(company_name, account_number)")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .maybeSingle();
  if (!data) return null;
  const s = (Array.isArray(data.staffs) ? data.staffs[0] : data.staffs) as
    { company_name: string | null; account_number: string | null } | null;
  const sections = ((data as { sections?: string[] | null }).sections ?? []).filter(Boolean) as string[];
  return {
    company_name:         s?.company_name ?? null,
    role:                 (data.role as string) ?? "staff",
    account_number:       s?.account_number ?? null,
    start_date:           (data as { start_date?: string | null }).start_date ?? null,
    work_days_type:       (data as { work_days_type?: string | null }).work_days_type ?? null,
    work_days_count:      (data as { work_days_count?: number | null }).work_days_count ?? null,
    preferred_shift:      (data as { preferred_shift?: string | null }).preferred_shift ?? null,
    preferred_section:    (data as { preferred_section?: string | null }).preferred_section ?? null,
    max_consecutive_days: (data as { max_consecutive_days?: number | null }).max_consecutive_days ?? null,
    sections,
  };
}

/** スタッフを別セクションのシフトへ移動（最も開始時刻が近いパターンを自動選択） */
export async function moveSectionAction(
  projectId: string,
  staffId: string,
  shiftDate: string, // YYYY-MM-DD
  targetSection: string,
): Promise<{ ok: boolean; newShiftName?: string; error?: string }> {
  await requireAdmin(projectId);
  const admin = createAdminClient();

  try {
    // 1. 現在のシフトを取得
    const { data: currentShift } = await admin
      .from("shifts")
      .select("shift_name, shift_start, shift_end")
      .eq("project_id", projectId)
      .eq("staff_id", staffId)
      .eq("shift_date", shiftDate)
      .maybeSingle();

    if (!currentShift) return { ok: false, error: "シフトが見つかりません" };

    // 2. ターゲットセクションのシフトパターンを取得
    const { data: patterns } = await admin
      .from("shift_patterns")
      .select("name, start_time, end_time")
      .eq("project_id", projectId)
      .eq("section", targetSection)
      .order("sort_order");

    if (!patterns || patterns.length === 0) {
      return { ok: false, error: `${targetSection}にシフトパターンがありません` };
    }

    // 3. 現在の開始時刻に最も近いパターンを選択
    const currentStart = (currentShift.shift_start as string | null) ?? "09:00";
    let bestPattern = patterns[0];
    let minDiff = Infinity;
    for (const p of patterns) {
      const diff = Math.abs(
        _timeToMinutes((p.start_time as string | null) ?? "09:00") -
        _timeToMinutes(currentStart),
      );
      if (diff < minDiff) { minDiff = diff; bestPattern = p; }
    }

    // 4. shifts テーブルを更新
    const { error: updateErr } = await admin
      .from("shifts")
      .update({
        shift_name:  bestPattern.name,
        shift_start: bestPattern.start_time,
        shift_end:   bestPattern.end_time,
      })
      .eq("project_id", projectId)
      .eq("staff_id", staffId)
      .eq("shift_date", shiftDate);

    if (updateErr) return { ok: false, error: updateErr.message };
    return { ok: true, newShiftName: bestPattern.name as string };

  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function _timeToMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/** 欠勤スタッフへ経過報告リマインドLINE一括送信（ボタン付き） */
export async function sendBulkFollowupReminderAction(
  projectId: string,
  staffIds: string[],
): Promise<{ results: SendResult[] }> {
  await requireAdmin(projectId);
  const admin = createAdminClient();
  const { data: staffList } = await admin
    .from("staffs").select("id, display_name, name, line_user_id")
    .in("id", staffIds);
  const staffMap = new Map((staffList ?? []).map(s => [s.id, s]));
  const appUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app";
  const tomorrow = (() => {
    const d = new Date(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) + "T00:00:00+09:00");
    d.setDate(d.getDate() + 1);
    const [, m, day] = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).split("-");
    return `${parseInt(m)}月${parseInt(day)}日`;
  })();
  const results: SendResult[] = [];
  for (const staffId of staffIds) {
    const staff = staffMap.get(staffId);
    const name = staff?.display_name ?? staff?.name ?? staffId;
    if (!staff?.line_user_id) {
      results.push({ staffId, name, ok: false, error: "LINE未連携" });
      continue;
    }
    const message = `${name}さん、お疲れ様です。\n本日はご欠勤されておりますが、明日（${tomorrow}）の出勤について経過報告をお願いします。`;
    await pushLineWithButton(
      staff.line_user_id,
      message,
      "経過報告を入力する",
      `${appUrl}/absence-followup`,
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
