/**
 * スケジュール通知 cron エンドポイント
 *
 * 5分ごとに呼び出す想定。
 * Vercel Cron: vercel.json の crons 設定を参照。
 * 外部サービスからの呼び出し: Authorization: Bearer <CRON_SECRET> ヘッダーが必要。
 *
 * 処理する通知:
 *   - rest_day_remind          … 翌日出勤アナウンス（設定時刻に1回）
 *   - absence_followup_remind  … 欠勤者経過報告リマインド（設定時刻に1回）
 *   - holiday_open_notify      … 希望休申請受付開始通知（毎月open_day）
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushLine, pushLineWithButton } from "@/lib/line";
import { logNotify, resolveMessage } from "@/lib/notify";
import {
  buildDefaultNotificationSettings,
  DEFAULT_NOTIFY_MESSAGES,
} from "@/app/(portal)/admin/[projectId]/settings/notify-config";

// ── 時刻ユーティリティ ───────────────────────────────────────────────────────

/** JST現在時刻の「0時からの経過分」（UTC+9 で計算） */
function nowMinuteJST(): number {
  const jstMs = Date.now() + 9 * 60 * 60 * 1000;
  const jst   = new Date(jstMs);
  return jst.getUTCHours() * 60 + jst.getUTCMinutes();
}

/** JST今日の日付 YYYY-MM-DD */
function todayJST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** JST翌日の日付 YYYY-MM-DD（UTC環境でも正しく計算） */
function tomorrowJST(): string {
  const today = todayJST();
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1))
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** JST昨日の日付 YYYY-MM-DD */
function yesterdayJST(): string {
  const today = todayJST();
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1))
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** YYYY-MM-DD → M/D */
function fmtMD(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

/** "HH:MM" または "HH:MM:SS" → 分 */
function parseHHMM(t: string): number {
  const parts = t.split(":");
  return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
}

/**
 * 設定時刻と現在時刻が windowMin 分以内かどうか判定（深夜またぎ対応）
 * Cron が5分ごとなので window=3 で確実に1回だけ発火できる
 */
function isNearTime(configTime: string, windowMin = 3): boolean {
  const target = parseHHMM(configTime);
  const now    = nowMinuteJST();
  const diff   = Math.abs(target - now);
  return Math.min(diff, 1440 - diff) <= windowMin;
}

const SECTION_ORDER = ["SV", "査定", "販売", "MOTA", "ローン", "未アポ", "インフォ", "研修関連"];

function sectionRank(sec: string): number {
  const i = SECTION_ORDER.indexOf(sec);
  return i === -1 ? SECTION_ORDER.length : i;
}

/** シフト名と時刻を結合して表示用文字列を作る */
function formatShift(
  shiftName: string | null,
  start: string | null,
  end: string | null
): string {
  if (shiftName && start && end) return `${shiftName}（${start}〜${end}）`;
  if (start && end) return `${start}〜${end}`;
  return shiftName ?? "";
}

// ── 型定義 ──────────────────────────────────────────────────────────────────

type ShiftRow = {
  staff_id: string;
  shift_start: string | null;
  shift_end:   string | null;
  shift_name:  string | null;
  shift_date?: string;
};

type StaffRow = {
  id:             string;
  display_name:   string | null;
  name:           string | null;
  line_user_id:   string | null;
  account_number: string | null;
};

// ── ハンドラー ───────────────────────────────────────────────────────────────

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

  // ?test_staff_id=S001 を指定すると全条件スキップ・そのスタッフにpingを1通送って即返す
  const testStaffId = req.nextUrl.searchParams.get("test_staff_id")?.toUpperCase() ?? null;

  const admin  = createAdminClient();

  if (testStaffId) {
    const { data: staff } = await admin
      .from("staffs")
      .select("line_user_id, display_name, name")
      .eq("id", testStaffId)
      .maybeSingle();
    if (!staff?.line_user_id) {
      return NextResponse.json({ ok: false, error: "LINE未登録またはスタッフ不在" });
    }
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
    await pushLine(staff.line_user_id, `[cronテスト] ${hhmm} JST に正常発火しました`);
    return NextResponse.json({ ok: true, sent: 1, test: true, to: testStaffId });
  }
  const today  = todayJST();
  const tmrw   = tomorrowJST();
  let sent     = 0;

  // 全案件の通知設定を一括取得
  const { data: projectSettings } = await admin
    .from("project_settings")
    .select("project_id, notification_settings, line_group_id");

  if (!projectSettings?.length) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  for (const ps of projectSettings) {
    const projectId = ps.project_id as string;
    const groupId   = ps.line_group_id as string | null;
    const settings  = buildDefaultNotificationSettings(
      (ps.notification_settings as Record<string, unknown>) ?? {}
    );

    // ── rest_day_remind：翌日出勤アナウンス（設定時刻に1回） ─────────────────
    if (settings.rest_day_remind.enabled) {
      const cfg  = settings.rest_day_remind;
      const yday = yesterdayJST();
      // windowMin=5 で確実に発火。重複防止のため当日送信済みチェック
      const alreadySent = await (async () => {
        const { data } = await admin
          .from("notification_logs")
          .select("id")
          .eq("project_id", projectId)
          .eq("notify_type", "rest_day_remind")
          .gte("sent_at", `${today}T00:00:00+09:00`)
          .limit(1)
          .maybeSingle();
        return !!data;
      })();
      if ((testStaffId || isNearTime(cfg.time ?? "19:00", 5)) && !alreadySent) {
        const shiftsQuery = admin
          .from("shifts")
          .select("staff_id, shift_start, shift_end, shift_name")
          .eq("project_id", projectId)
          .eq("shift_date", tmrw)
          .or("shift_start.not.is.null,shift_name.ilike.%研修%");
        if (testStaffId) shiftsQuery.eq("staff_id", testStaffId);
        const { data: tShifts } = await shiftsQuery as { data: ShiftRow[] | null };

        if ((tShifts ?? []).length > 0) {
          const staffIds = [...new Set(tShifts!.map(s => s.staff_id))];

          // スタッフ情報（アカウント番号含む）
          const { data: staffRows } = await admin
            .from("staffs")
            .select("id, display_name, name, line_user_id, account_number")
            .in("id", staffIds) as { data: StaffRow[] | null };
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

          // 個人送信 + 結果追跡
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

          for (const shift of tShifts!) {
            const staff   = staffMap[shift.staff_id] as StaffRow | undefined;
            const name    = staff?.display_name ?? staff?.name ?? shift.staff_id;
            const acct    = staff?.account_number ?? shift.staff_id;
            const baseSection = sectionMap[shift.staff_id] ?? "セクション設定なし";
            const section = (shift.shift_name ?? "").includes("研修") ? "研修関連" : baseSection;
            const star    = absentYday.has(shift.staff_id);

            if (!staff?.line_user_id) {
              results.push({ staffId: shift.staff_id, name, accountNumber: acct, section, star, success: false, failReason: "LINE未登録" });
              continue;
            }

            const message = resolveMessage(
              cfg.message ?? DEFAULT_NOTIFY_MESSAGES.rest_day_remind,
              {
                "名前":  name,
                "翌日":  tmrw,
                "シフト": formatShift(shift.shift_name, shift.shift_start, shift.shift_end),
              }
            );

            let success = true;
            let failReason: string | null = null;
            try {
              await pushLine(staff.line_user_id, message);
              void logNotify({ projectId, notifyType: "rest_day_remind", recipientType: "staff", recipientId: shift.staff_id, recipientName: name, message });
              sent++;
            } catch {
              success = false;
              failReason = "送信エラー";
            }
            results.push({ staffId: shift.staff_id, name, accountNumber: acct, section, star, success, failReason });
          }

          // グループへまとめレポート1通（テスト時はスキップ）
          if (!testStaffId && groupId && results.length > 0) {
            const bySection = new Map<string, SendResult[]>();
            for (const r of results) {
              if (!bySection.has(r.section)) bySection.set(r.section, []);
              bySection.get(r.section)!.push(r);
            }
            const sectionOrder = [...bySection.keys()].sort((a, b) => sectionRank(a) - sectionRank(b));
            const failures = results.filter(r => !r.success);
            const dateFmt  = fmtMD(tmrw);

            const lines: string[] = [
              `【 翌日（${dateFmt}）出勤リマインドレポート】`,
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
                const suffix = [
                  r.star    ? "※前日欠勤" : "",
                  !r.success ? "✗未送信"   : "",
                ].filter(Boolean).join(" ");
                lines.push(`・${r.accountNumber} ${r.name}${suffix ? " " + suffix : ""}`);
              }
            }

            await pushLine(groupId, lines.join("\n"));
            sent++;
          }
        }
      }
    }

    // ── absence_followup_remind：欠勤者への17時経過報告リマインド ─────────────
    if (settings.absence_followup_remind.enabled) {
      const cfg = settings.absence_followup_remind;
      const followupAlreadySent = await (async () => {
        const { data } = await admin
          .from("notification_logs")
          .select("id")
          .eq("project_id", projectId)
          .eq("notify_type", "absence_followup_remind")
          .gte("sent_at", `${today}T00:00:00+09:00`)
          .limit(1)
          .maybeSingle();
        return !!data;
      })();
      if ((testStaffId || isNearTime(cfg.time ?? "17:00")) && !followupAlreadySent) {
        // 当日欠勤スタッフを取得
        const absencesQuery = admin
          .from("absence_reports")
          .select("staff_id")
          .eq("project_id", projectId)
          .eq("absence_date", today);
        if (testStaffId) absencesQuery.eq("staff_id", testStaffId);
        const { data: absences } = await absencesQuery;

        const absentIds = [...new Set((absences ?? []).map(a => a.staff_id as string))];

        if (absentIds.length > 0) {
          // 翌日シフトがある欠勤者を絞り込む
          const { data: tmrwShifts } = await admin
            .from("shifts")
            .select("staff_id")
            .eq("project_id", projectId)
            .eq("shift_date", tmrw)
            .in("staff_id", absentIds)
            .not("shift_start", "is", null);

          const toNotify = [...new Set((tmrwShifts ?? []).map(s => s.staff_id as string))];

          if (toNotify.length > 0) {
            const { data: staffRows } = await admin
              .from("staffs")
              .select("id, display_name, name, line_user_id")
              .in("id", toNotify) as { data: StaffRow[] | null };

            const appUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app";

            let followupCount = 0;
            const followupSentNames: string[] = [];
            const followupFailedNames: string[] = [];
            for (const staff of staffRows ?? []) {
              const name = staff.display_name ?? staff.name ?? staff.id;
              if (!staff.line_user_id) {
                followupFailedNames.push(`${name}（LINE未登録）`);
                continue;
              }
              const message = resolveMessage(
                cfg.message ?? DEFAULT_NOTIFY_MESSAGES.absence_followup_remind,
                { "名前": name, "翌日": tmrw }
              );
              await pushLineWithButton(
                staff.line_user_id,
                message,
                "経過報告を入力する",
                `${appUrl}/absence-followup`,
              );
              void logNotify({ projectId, notifyType: "absence_followup_remind", recipientType: "staff", recipientId: staff.id, recipientName: name, message });
              sent++;
              followupCount++;
              followupSentNames.push(name);
            }
            if (!testStaffId && groupId && followupCount > 0) {
              const lines = [
                `【経過報告リマインド】${fmtMD(tmrw)}出勤予定の欠勤者 ${followupCount}名に送信しました。`,
                "",
                ...followupSentNames.map(n => `・${n}`),
              ];
              if (followupFailedNames.length > 0) {
                lines.push("");
                lines.push(`⚠️ 送信失敗 ${followupFailedNames.length}名`);
                followupFailedNames.forEach(n => lines.push(`・${n}`));
              }
              await pushLine(groupId, lines.join("\n"));
              sent++;
            }
          }
        }
      }
    }

    // ── holiday_open_notify：受付開始日（open_day）の希望休受付開始通知 ──────────
    if (settings.holiday_open_notify.enabled) {
      const cfg    = settings.holiday_open_notify;
      const jstDay = parseInt(today.split("-")[2], 10);

      // open_day・deadline_day を取得してトリガー判定
      const { data: openRules } = await admin
        .from("holiday_rules")
        .select("rule_type, value")
        .eq("project_id", projectId);
      const openDay    = (openRules ?? []).find(r => r.rule_type === "open_day")?.value as number | null;
      const deadlineDay = (openRules ?? []).find(r => r.rule_type === "deadline_day")?.value as number | null;

      if (openDay && jstDay === openDay && isNearTime(cfg.time ?? "09:00")) {
        // 翌月（申請対象月）を計算
        const [y, m] = today.split("-").map(Number);
        const targetY = m === 12 ? y + 1 : y;
        const targetM = m === 12 ? 1 : m + 1;
        const targetMonth = `${targetY}/${String(targetM).padStart(2, "0")}`;

        // 締切日は今月の deadline_day
        const deadlineStr = deadlineDay
          ? `${y}-${String(m).padStart(2, "0")}-${String(deadlineDay).padStart(2, "0")}`
          : "（設定なし）";

        // 全プロジェクトメンバーのLINE IDを取得（セクションも取得してレポート用に使う）
        const { data: members } = await admin
          .from("project_members")
          .select("staff_id, section")
          .eq("project_id", projectId);
        const memberIds = (members ?? []).map(m => m.staff_id as string);
        const sectionMap2: Record<string, string> = {};
        for (const m of members ?? []) {
          sectionMap2[m.staff_id as string] = (m.section as string | null) ?? "セクション設定なし";
        }

        if (memberIds.length > 0) {
          const { data: staffRows } = await admin
            .from("staffs")
            .select("id, display_name, name, account_number, line_user_id")
            .in("id", memberIds) as { data: StaffRow[] | null };

          // 個別通知 → 結果を集計し、管理者グループへはまとめレポート1通
          type OpenResult = { name: string; accountNumber: string; section: string; success: boolean; failReason: string | null };
          const openResults: OpenResult[] = [];

          for (const staff of staffRows ?? []) {
            const name    = staff.display_name ?? staff.name ?? staff.id;
            const acct    = staff.account_number ?? staff.id;
            const section = sectionMap2[staff.id] ?? "セクション設定なし";

            if (!staff.line_user_id) {
              openResults.push({ name, accountNumber: acct, section, success: false, failReason: "LINE未登録" });
              continue;
            }

            const message = resolveMessage(
              cfg.message ?? DEFAULT_NOTIFY_MESSAGES.holiday_open_notify,
              { "名前": name, "対象月": targetMonth, "締切日": deadlineStr }
            );

            let success = true;
            let failReason: string | null = null;
            try {
              await pushLine(staff.line_user_id, message);
              void logNotify({ projectId, notifyType: "holiday_open_notify", recipientType: "staff", recipientId: staff.id, recipientName: name, message });
              sent++;
            } catch {
              success = false;
              failReason = "送信エラー";
            }
            openResults.push({ name, accountNumber: acct, section, success, failReason });
          }

          // ── 管理者グループへまとめレポート1通 ──────────────────
          if (groupId && openResults.length > 0) {
            const bySection = new Map<string, OpenResult[]>();
            for (const r of openResults) {
              if (!bySection.has(r.section)) bySection.set(r.section, []);
              bySection.get(r.section)!.push(r);
            }
            const sectionOrder = [...bySection.keys()].sort((a, b) => sectionRank(a) - sectionRank(b));
            const successCount = openResults.filter(r => r.success).length;
            const failures = openResults.filter(r => !r.success);

            const lines: string[] = [
              `【希望休 受付開始レポート（${targetMonth}）】`,
              "",
              `締切日：${deadlineStr}`,
              `通知 ${successCount}名 / 対象 ${openResults.length}名`,
            ];

            if (failures.length > 0) {
              lines.push("");
              lines.push(`⚠️ 未通知 ${failures.length}名`);
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
                lines.push(`・${r.accountNumber} ${r.name}${r.success ? "" : " ✗未通知"}`);
              }
            }

            await pushLine(groupId, lines.join("\n"));
            void logNotify({ projectId, notifyType: "holiday_open_notify", recipientType: "group", message: lines.join("\n") });
            sent++;
          }
        }
      }
    }

  }

  return NextResponse.json({ ok: true, sent });
}
