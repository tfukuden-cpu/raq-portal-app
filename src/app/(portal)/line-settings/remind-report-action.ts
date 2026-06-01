"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { pushLine } from "@/lib/line";

function todayJST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function tomorrowJST(): string {
  const [y, m, d] = todayJST().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1))
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function yesterdayJST(): string {
  const [y, m, d] = todayJST().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1))
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function fmtMD(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

const SECTION_ORDER = ["SV", "査定", "販売", "MOTA", "ローン", "未アポ", "インフォ", "研修関連"];
const sectionRank = (sec: string) => { const i = SECTION_ORDER.indexOf(sec); return i === -1 ? SECTION_ORDER.length : i; };

function formatShift(name: string | null, start: string | null, end: string | null): string {
  if (name && start && end) return `${name}（${start}〜${end}）`;
  if (start && end) return `${start}〜${end}`;
  return name ?? "";
}

/** レポート本文を生成して返す（送信しない） */
export async function previewRemindReportAction(): Promise<{ ok: boolean; text?: string; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "未認証です" };

  const projectId = await getCurrentProjectId();
  if (!projectId) return { ok: false, message: "案件が選択されていません" };

  const admin = createAdminClient();
  const tmrw  = tomorrowJST();
  const yday  = yesterdayJST();

  const { data: tShifts } = await admin
    .from("shifts")
    .select("staff_id, shift_start, shift_end, shift_name")
    .eq("project_id", projectId)
    .eq("shift_date", tmrw)
    .not("shift_start", "is", null);

  if (!tShifts?.length) return { ok: false, message: `翌日（${fmtMD(tmrw)}）の出勤予定者がいません` };

  const staffIds = [...new Set(tShifts.map(s => s.staff_id))];

  const [{ data: staffRows }, { data: memberRows }, { data: ydayAbsences }] = await Promise.all([
    admin.from("staffs").select("id, display_name, name, line_user_id, account_number").in("id", staffIds),
    admin.from("project_members").select("staff_id, section").eq("project_id", projectId).in("staff_id", staffIds),
    admin.from("absence_reports").select("staff_id").eq("project_id", projectId).eq("absence_date", yday),
  ]);

  const staffMap   = Object.fromEntries((staffRows ?? []).map(s => [s.id, s]));
  const sectionMap = Object.fromEntries((memberRows ?? []).map(m => [m.staff_id as string, (m.section as string | null) ?? "セクション設定なし"]));
  const absentYday = new Set((ydayAbsences ?? []).map(a => a.staff_id as string));

  type Entry = { name: string; accountNumber: string; section: string; star: boolean; lineRegistered: boolean };
  const entries: Entry[] = tShifts.map(shift => {
    const staff = staffMap[shift.staff_id] as { display_name: string | null; name: string | null; line_user_id: string | null; account_number: string | null } | undefined;
    return {
      name:           staff?.display_name ?? staff?.name ?? shift.staff_id,
      accountNumber:  (staff?.account_number as string | null) ?? shift.staff_id,
      section:        sectionMap[shift.staff_id] ?? "セクション設定なし",
      star:           absentYday.has(shift.staff_id),
      lineRegistered: !!staff?.line_user_id,
    };
  });

  const bySection = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!bySection.has(e.section)) bySection.set(e.section, []);
    bySection.get(e.section)!.push(e);
  }
  const sectionOrder = [...bySection.keys()].sort((a, b) => sectionRank(a) - sectionRank(b));
  const unregistered = entries.filter(e => !e.lineRegistered);

  const lines: string[] = [
    `【 翌日（${fmtMD(tmrw)}）出勤リマインドレポート】`,
    "",
    `合計 ${entries.length}名`,
    ...sectionOrder.map(sec => `${sec} ${bySection.get(sec)!.length}名`),
  ];

  if (unregistered.length > 0) {
    lines.push("");
    lines.push(`⚠️ 送信失敗 ${unregistered.length}名`);
    for (const e of unregistered) {
      lines.push(`・${e.accountNumber} ${e.name}`);
      lines.push(`　→ LINE未登録`);
    }
  }

  lines.push("");
  lines.push("----------");

  for (let i = 0; i < sectionOrder.length; i++) {
    if (i > 0) lines.push("");
    const sec = sectionOrder[i];
    lines.push(`【${sec}】`);
    for (const e of bySection.get(sec)!) {
      const suffix = [e.star ? "※前日欠勤" : "", !e.lineRegistered ? "✗未送信" : ""].filter(Boolean).join(" ");
      lines.push(`・${e.accountNumber} ${e.name}${suffix ? " " + suffix : ""}`);
    }
  }

  return { ok: true, text: lines.join("\n") };
}

export async function sendRemindReportNowAction(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "未認証です" };

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { ok: false, message: "案件が選択されていません" };

  const admin = createAdminClient();
  const tmrw  = tomorrowJST();
  const yday  = yesterdayJST();

  // LINEグループID取得
  const { data: ps } = await admin
    .from("project_settings")
    .select("line_group_id")
    .eq("project_id", projectId)
    .maybeSingle();
  const groupId = ps?.line_group_id as string | null;
  if (!groupId) return { ok: false, message: "LINEグループが設定されていません" };

  // 翌日シフト
  const { data: tShifts } = await admin
    .from("shifts")
    .select("staff_id, shift_start, shift_end, shift_name")
    .eq("project_id", projectId)
    .eq("shift_date", tmrw)
    .not("shift_start", "is", null);

  if (!tShifts?.length) return { ok: false, message: `翌日（${fmtMD(tmrw)}）の出勤予定者がいません` };

  const staffIds = [...new Set(tShifts.map(s => s.staff_id))];

  // スタッフ情報
  const { data: staffRows } = await admin
    .from("staffs")
    .select("id, display_name, name, line_user_id, account_number")
    .in("id", staffIds);
  const staffMap = Object.fromEntries((staffRows ?? []).map(s => [s.id, s]));

  // セクション情報
  const { data: memberRows } = await admin
    .from("project_members")
    .select("staff_id, section")
    .eq("project_id", projectId)
    .in("staff_id", staffIds);
  const sectionMap = Object.fromEntries(
    (memberRows ?? []).map(m => [
      m.staff_id as string,
      (m.section as string | null) ?? "セクション設定なし",
    ])
  );

  // 昨日の欠勤者
  const { data: ydayAbsences } = await admin
    .from("absence_reports")
    .select("staff_id")
    .eq("project_id", projectId)
    .eq("absence_date", yday);
  const absentYday = new Set((ydayAbsences ?? []).map(a => a.staff_id as string));

  // 個人送信 + 結果記録
  type SendResult = {
    staffId: string;
    name: string;
    accountNumber: string;
    section: string;
    star: boolean;
    success: boolean;
    failReason: string | null;
  };
  const results: SendResult[] = [];

  for (const shift of tShifts) {
    const staff  = staffMap[shift.staff_id] as { id: string; display_name: string | null; name: string | null; line_user_id: string | null; account_number: string | null } | undefined;
    const name   = staff?.display_name ?? staff?.name ?? shift.staff_id;
    const acct   = (staff?.account_number as string | null) ?? shift.staff_id;
    const section = sectionMap[shift.staff_id] ?? "セクション設定なし";
    const star   = absentYday.has(shift.staff_id);

    if (!staff?.line_user_id) {
      results.push({ staffId: shift.staff_id, name, accountNumber: acct, section, star, success: false, failReason: "LINE未登録" });
      continue;
    }

    const msg = `${name}さん、明日（${fmtMD(tmrw)}）の出勤予定となっております。\n${formatShift(shift.shift_name as string | null, shift.shift_start as string | null, shift.shift_end as string | null)}\nよろしくお願いします！`;

    let success = true;
    let failReason: string | null = null;
    try {
      await pushLine(staff.line_user_id, msg);
    } catch {
      success = false;
      failReason = "送信エラー";
    }
    results.push({ staffId: shift.staff_id, name, accountNumber: acct, section, star, success, failReason });
  }

  // グループへまとめレポート
  const bySection = new Map<string, SendResult[]>();
  for (const r of results) {
    if (!bySection.has(r.section)) bySection.set(r.section, []);
    bySection.get(r.section)!.push(r);
  }
  const sectionOrder = [...bySection.keys()].sort((a, b) => sectionRank(a) - sectionRank(b));
  const failures = results.filter(r => !r.success);

  const lines: string[] = [
    `【 翌日（${fmtMD(tmrw)}）出勤リマインドレポート】`,
    "",
    `合計 ${results.length}名`,
    ...sectionOrder.map(sec => `${sec} ${bySection.get(sec)!.length}名`),
  ];

  if (failures.length > 0) {
    lines.push("");
    lines.push(`⚠️ 送信失敗 ${failures.length}名`);
    for (const r of failures) {
      lines.push(`・${r.accountNumber} ${r.name}`);
      lines.push(`　→ ${r.failReason}`);
    }
  }

  lines.push("");
  lines.push("----------");

  for (let i = 0; i < sectionOrder.length; i++) {
    if (i > 0) lines.push("");
    const sec = sectionOrder[i];
    lines.push(`【${sec}】`);
    for (const r of bySection.get(sec)!) {
      const suffix = [r.star ? "※前日欠勤" : "", !r.success ? "✗未送信" : ""].filter(Boolean).join(" ");
      lines.push(`・${r.accountNumber} ${r.name}${suffix ? " " + suffix : ""}`);
    }
  }

  try {
    await pushLine(groupId, lines.join("\n"));
  } catch {
    return { ok: false, message: "グループへの送信に失敗しました" };
  }

  return { ok: true, message: `送信完了：${results.length}名分のレポートをグループに送信しました` };
}
