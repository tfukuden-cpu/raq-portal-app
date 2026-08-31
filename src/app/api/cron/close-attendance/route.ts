/**
 * 勤怠の月次締め cron エンドポイント
 *
 * 毎月1日 13:00(JST) に前月分を一括で確定する（＝編集不可にする）。
 * Vercel Cron: vercel.json の crons 設定を参照（04:00 UTC = 13:00 JST）。
 * 外部サービスからの呼び出し: Authorization: Bearer <CRON_SECRET> ヘッダーが必要。
 *
 * 確定は「スタッフ×稼働日」単位で attendance_confirmations に登録する。
 * 確定済みの日は打刻修正・補正申請の承認ができなくなり、解除は運営者のみ。
 *
 * 手動実行・やり直し:
 *   ?month=2026-08 で対象月を指定（省略時は前月）
 *   ?dry=1 で登録せず件数だけ返す
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushLineWithButton } from "@/lib/line";

/** 休み扱いのシフト名（稼働日ではないので締めの対象外） */
const OFF_SHIFT_NAMES = ["公休", "休", "希望休", "有休", "休暇", "振替休日", "特別休暇", "代休", "欠勤", "公募"];

/** JST今日の日付 YYYY-MM-DD */
function todayJST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** 前月の YYYY-MM と月初・月末（JST基準） */
function prevMonthRange(): { month: string; start: string; end: string } {
  const [y, m] = todayJST().split("-").map(Number);
  return monthRange(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`);
}

function monthRange(month: string): { month: string; start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { month, start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

/** 1000行制限を避けて全件取得 */
async function fetchAllShifts(
  admin: ReturnType<typeof createAdminClient>,
  start: string, end: string,
): Promise<{ project_id: string; staff_id: string; shift_date: string; shift_name: string | null }[]> {
  const PAGE = 1000;
  const all: { project_id: string; staff_id: string; shift_date: string; shift_name: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("shifts")
      .select("project_id, staff_id, shift_date, shift_name")
      .gte("shift_date", start).lte("shift_date", end)
      .order("shift_date").order("staff_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as typeof all));
    if (data.length < PAGE) break;
  }
  return all;
}

export async function GET(req: NextRequest) {
  // ─ 認証 ─
  const authHeader = req.headers.get("authorization");
  const secret     = process.env.CRON_SECRET;
  const testToken  = process.env.CRON_TEST_TOKEN;
  const isAuthorized =
    (secret && authHeader === `Bearer ${secret}`) ||
    (testToken && authHeader === `Bearer ${testToken}`);
  if (!isAuthorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const monthParam = req.nextUrl.searchParams.get("month");
  const isDryRun   = req.nextUrl.searchParams.get("dry") === "1";
  const { month, start, end } = monthParam ? monthRange(monthParam) : prevMonthRange();

  const admin = createAdminClient();

  try {
    const shifts = await fetchAllShifts(admin, start, end);
    const workRows = shifts.filter(s => !OFF_SHIFT_NAMES.includes(s.shift_name ?? ""));

    // 既に確定済みの分は除く（再実行しても二重登録しない）
    const { data: existing } = await admin
      .from("attendance_confirmations")
      .select("project_id, staff_id, work_date")
      .gte("work_date", start).lte("work_date", end);
    const done = new Set((existing ?? []).map(e => `${e.project_id}_${e.staff_id}_${e.work_date}`));

    const inserts = workRows
      .filter(r => !done.has(`${r.project_id}_${r.staff_id}_${r.shift_date}`))
      .map(r => ({
        project_id: r.project_id,
        staff_id: r.staff_id,
        work_date: r.shift_date,
        confirmed_by: "SYSTEM",
      }));

    if (isDryRun) {
      return NextResponse.json({ month, workDays: workRows.length, alreadyConfirmed: done.size, wouldInsert: inserts.length, dryRun: true });
    }

    // 1000件ずつ投入
    let inserted = 0;
    for (let i = 0; i < inserts.length; i += 1000) {
      const chunk = inserts.slice(i, i + 1000);
      const { error } = await admin.from("attendance_confirmations").upsert(chunk, {
        onConflict: "project_id,staff_id,work_date",
        ignoreDuplicates: true,
      });
      if (error) throw new Error(error.message);
      inserted += chunk.length;
    }

    // 案件ごとの件数を管理者グループLINEへ通知
    const byProject = new Map<string, number>();
    for (const r of inserts) byProject.set(r.project_id, (byProject.get(r.project_id) ?? 0) + 1);

    const appUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app";
    for (const [projectId, count] of byProject) {
      if (count === 0) continue;
      const { data: settings } = await admin
        .from("project_settings").select("line_group_id").eq("project_id", projectId).maybeSingle();
      const groupId = (settings as { line_group_id?: string | null } | null)?.line_group_id;
      if (!groupId) continue;
      try {
        await pushLineWithButton(
          groupId,
          `🔒 ${month} の勤怠を締めました\n\n確定した稼働日：${count}件\n\n確定した日は打刻修正・補正申請の承認ができません。\n修正が必要な場合は運営者に確定の解除を依頼してください。`,
          "勤怠管理を開く",
          `${appUrl}/attendance/edit`,
        );
      } catch (e) {
        console.error("[close-attendance] LINE通知失敗", projectId, e);
      }
    }

    return NextResponse.json({
      month, workDays: workRows.length, alreadyConfirmed: done.size, inserted,
      projects: Object.fromEntries(byProject),
    });
  } catch (e) {
    console.error("[close-attendance] failed", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
