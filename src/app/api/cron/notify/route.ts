/**
 * スケジュール通知 cron エンドポイント
 *
 * 5分ごとに呼び出す想定。
 * Vercel Cron: vercel.json の crons 設定を参照。
 * 外部サービスからの呼び出し: Authorization: Bearer <CRON_SECRET> ヘッダーが必要。
 *
 * 処理する通知:
 *   - shift_start_remind  … 出勤N分前リマインド
 *   - shift_end_remind    … 退勤N分後：打刻忘れリマインド
 *   - rest_day_remind     … 翌日出勤アナウンス（設定時刻に1回）
 *   - daily_summary       … 当日出勤状況サマリー（設定時刻に1回）
 *   - holiday_reminder    … 未実装（締切日設定が必要）
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { multicastLine, pushLine } from "@/lib/line";
import { getAdminLineIds, resolveMessage } from "@/lib/notify";
import {
  buildDefaultNotificationSettings,
  DEFAULT_NOTIFY_MESSAGES,
} from "@/app/(portal)/admin/[projectId]/settings/notify-config";

// ── 時刻ユーティリティ ───────────────────────────────────────────────────────

/** JST現在時刻の「0時からの経過分」 */
function nowMinuteJST(): number {
  const jst = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })
  );
  return jst.getHours() * 60 + jst.getMinutes();
}

/** JST今日の日付 YYYY-MM-DD */
function todayJST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** JST翌日の日付 YYYY-MM-DD */
function tomorrowJST(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
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
  id:           string;
  display_name: string | null;
  name:         string | null;
  line_user_id: string | null;
};

// ── ハンドラー ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ─ 認証 ─
  const authHeader = req.headers.get("authorization");
  const secret     = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin  = createAdminClient();
  const today  = todayJST();
  const tmrw   = tomorrowJST();
  const nowMin = nowMinuteJST();
  let sent     = 0;

  // 全案件の通知設定を一括取得
  const { data: projectSettings } = await admin
    .from("project_settings")
    .select("project_id, notification_settings");

  if (!projectSettings?.length) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  for (const ps of projectSettings) {
    const projectId = ps.project_id as string;
    const settings  = buildDefaultNotificationSettings(
      (ps.notification_settings as Record<string, unknown>) ?? {}
    );

    // ── shift_start_remind：出勤N分前リマインド ───────────────────────────
    if (settings.shift_start_remind.enabled) {
      const cfg    = settings.shift_start_remind;
      const mbefore = cfg.minutes_before ?? 60;

      const { data: shifts } = await admin
        .from("shifts")
        .select("staff_id, shift_start, shift_end, shift_name")
        .eq("project_id", projectId)
        .eq("shift_date", today)
        .not("shift_start", "is", null) as { data: ShiftRow[] | null };

      const toNotify = (shifts ?? []).filter(s => {
        const sStartMin = parseHHMM(s.shift_start!);
        return Math.abs(sStartMin - mbefore - nowMin) <= 3;
      });

      if (toNotify.length > 0) {
        const staffIds = [...new Set(toNotify.map(s => s.staff_id))];
        const { data: staffRows } = await admin
          .from("staffs")
          .select("id, display_name, name, line_user_id")
          .in("id", staffIds) as { data: StaffRow[] | null };
        const staffMap: Record<string, StaffRow> = Object.fromEntries(
          (staffRows ?? []).map(s => [s.id, s])
        );

        for (const shift of toNotify) {
          const staff = staffMap[shift.staff_id];
          if (!staff?.line_user_id) continue;
          const name    = staff.display_name ?? staff.name ?? shift.staff_id;
          const message = resolveMessage(
            cfg.message ?? DEFAULT_NOTIFY_MESSAGES.shift_start_remind,
            { "名前": name, "シフト": formatShift(shift.shift_name, shift.shift_start, shift.shift_end) }
          );
          await pushLine(staff.line_user_id, message);
          sent++;
        }
      }
    }

    // ── shift_end_remind：退勤N分後の打刻忘れリマインド ─────────────────────
    if (settings.shift_end_remind.enabled) {
      const cfg   = settings.shift_end_remind;
      const mafter = cfg.minutes_after ?? 15;

      const { data: shifts } = await admin
        .from("shifts")
        .select("staff_id, shift_start, shift_end, shift_name")
        .eq("project_id", projectId)
        .eq("shift_date", today)
        .not("shift_end", "is", null) as { data: ShiftRow[] | null };

      const toCheck = (shifts ?? []).filter(s => {
        const sEndMin = parseHHMM(s.shift_end!);
        return Math.abs(sEndMin + mafter - nowMin) <= 3;
      });

      if (toCheck.length > 0) {
        const staffIds = [...new Set(toCheck.map(s => s.staff_id))];

        // 退勤打刻済みスタッフを取得
        const { data: clockOuts } = await admin
          .from("punch_logs")
          .select("staff_id")
          .eq("project_id", projectId)
          .eq("punch_type", "clock_out")
          .gte("recorded_at", `${today}T00:00:00+09:00`)
          .lte("recorded_at", `${today}T23:59:59+09:00`);
        const clockedOutSet = new Set(
          (clockOuts ?? []).map(c => c.staff_id as string)
        );

        const { data: staffRows } = await admin
          .from("staffs")
          .select("id, display_name, name, line_user_id")
          .in("id", staffIds) as { data: StaffRow[] | null };
        const staffMap: Record<string, StaffRow> = Object.fromEntries(
          (staffRows ?? []).map(s => [s.id, s])
        );

        for (const shift of toCheck) {
          if (clockedOutSet.has(shift.staff_id)) continue; // 退勤済みはスキップ

          const staff = staffMap[shift.staff_id];
          if (!staff?.line_user_id) continue;

          // 次回シフトを検索
          const { data: nextShifts } = await admin
            .from("shifts")
            .select("shift_date, shift_start, shift_end, shift_name")
            .eq("project_id", projectId)
            .eq("staff_id", shift.staff_id)
            .gt("shift_date", today)
            .not("shift_start", "is", null)
            .order("shift_date", { ascending: true })
            .limit(1) as { data: ShiftRow[] | null };

          const next = nextShifts?.[0];
          const name = staff.display_name ?? staff.name ?? shift.staff_id;
          const message = resolveMessage(
            cfg.message ?? DEFAULT_NOTIFY_MESSAGES.shift_end_remind,
            {
              "名前":      name,
              "次回出勤日": next?.shift_date ?? "（未定）",
              "シフト":    next
                ? formatShift(next.shift_name, next.shift_start, next.shift_end)
                : "（未定）",
            }
          );
          await pushLine(staff.line_user_id, message);
          sent++;
        }
      }
    }

    // ── rest_day_remind：翌日出勤アナウンス（設定時刻に1回） ─────────────────
    if (settings.rest_day_remind.enabled) {
      const cfg = settings.rest_day_remind;
      if (isNearTime(cfg.time ?? "20:00")) {
        const { data: tShifts } = await admin
          .from("shifts")
          .select("staff_id, shift_start, shift_end, shift_name")
          .eq("project_id", projectId)
          .eq("shift_date", tmrw)
          .not("shift_start", "is", null) as { data: ShiftRow[] | null };

        if ((tShifts ?? []).length > 0) {
          const staffIds = [...new Set(tShifts!.map(s => s.staff_id))];
          const { data: staffRows } = await admin
            .from("staffs")
            .select("id, display_name, name, line_user_id")
            .in("id", staffIds) as { data: StaffRow[] | null };
          const staffMap: Record<string, StaffRow> = Object.fromEntries(
            (staffRows ?? []).map(s => [s.id, s])
          );

          for (const shift of tShifts!) {
            const staff = staffMap[shift.staff_id];
            if (!staff?.line_user_id) continue;
            const name    = staff.display_name ?? staff.name ?? shift.staff_id;
            const message = resolveMessage(
              cfg.message ?? DEFAULT_NOTIFY_MESSAGES.rest_day_remind,
              {
                "名前": name,
                "翌日": tmrw,
                "シフト": formatShift(shift.shift_name, shift.shift_start, shift.shift_end),
              }
            );
            await pushLine(staff.line_user_id, message);
            sent++;
          }
        }
      }
    }

    // ── daily_summary：出勤状況サマリー（設定時刻に1回） ──────────────────────
    if (settings.daily_summary.enabled) {
      const cfg = settings.daily_summary;
      if (isNearTime(cfg.time ?? "08:00")) {
        const { data: todayShifts } = await admin
          .from("shifts")
          .select("staff_id, shift_start, shift_end, shift_name")
          .eq("project_id", projectId)
          .eq("shift_date", today)
          .not("shift_start", "is", null)
          .order("shift_start", { ascending: true }) as { data: ShiftRow[] | null };

        const { data: absences } = await admin
          .from("absence_reports")
          .select("staff_id")
          .eq("project_id", projectId)
          .eq("absence_date", today);

        const absentSet = new Set((absences ?? []).map(a => a.staff_id as string));
        const workers   = (todayShifts ?? []).filter(s => !absentSet.has(s.staff_id));

        const staffIds = [...new Set(workers.map(s => s.staff_id))];
        let staffMap: Record<string, StaffRow> = {};
        if (staffIds.length > 0) {
          const { data: staffRows } = await admin
            .from("staffs")
            .select("id, display_name, name")
            .in("id", staffIds) as { data: StaffRow[] | null };
          staffMap = Object.fromEntries((staffRows ?? []).map(s => [s.id, s]));
        }

        const listLines = workers.map(s => {
          const st   = staffMap[s.staff_id];
          const name = st?.display_name ?? st?.name ?? s.staff_id;
          return `・${name}　${formatShift(s.shift_name, s.shift_start, s.shift_end)}`;
        }).join("\n");

        const message = resolveMessage(
          cfg.message ?? DEFAULT_NOTIFY_MESSAGES.daily_summary,
          {
            "日付":   today,
            "出勤数": String(workers.length),
            "一覧":   listLines || "（本日出勤予定なし）",
          }
        );

        const adminIds = await getAdminLineIds(projectId);
        if (adminIds.length > 0) {
          await multicastLine(adminIds, message);
          sent++;
        }
      }
    }

    // ── absence_followup_remind：欠勤者への17時経過報告リマインド ─────────────
    if (settings.absence_followup_remind.enabled) {
      const cfg = settings.absence_followup_remind;
      if (isNearTime(cfg.time ?? "17:00")) {
        // 当日欠勤スタッフを取得
        const { data: absences } = await admin
          .from("absence_reports")
          .select("staff_id")
          .eq("project_id", projectId)
          .eq("absence_date", today);

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

            for (const staff of staffRows ?? []) {
              if (!staff.line_user_id) continue;
              const name    = staff.display_name ?? staff.name ?? staff.id;
              const message = resolveMessage(
                cfg.message ?? DEFAULT_NOTIFY_MESSAGES.absence_followup_remind,
                { "名前": name, "翌日": tmrw }
              );
              await pushLine(staff.line_user_id, message);
              sent++;
            }
          }
        }
      }
    }

    // ── holiday_open_notify：毎月1日の希望休受付開始通知 ─────────────────────
    if (settings.holiday_open_notify.enabled) {
      const cfg    = settings.holiday_open_notify;
      const jstDay = parseInt(today.split("-")[2], 10);
      if (jstDay === 1 && isNearTime(cfg.time ?? "09:00")) {
        // 翌月（申請対象月）を計算
        const [y, m] = today.split("-").map(Number);
        const targetY = m === 12 ? y + 1 : y;
        const targetM = m === 12 ? 1 : m + 1;
        const targetMonth = `${targetY}/${String(targetM).padStart(2, "0")}`;

        // 締切日を取得
        const { data: rules } = await admin
          .from("holiday_rules")
          .select("rule_type, value")
          .eq("project_id", projectId);
        const deadlineDay = (rules ?? []).find(r => r.rule_type === "deadline_day")?.value as number | null;
        const deadlineStr = deadlineDay
          ? `${y}-${String(m).padStart(2, "0")}-${String(deadlineDay).padStart(2, "0")}`
          : "（設定なし）";

        // 全プロジェクトメンバーのLINE IDを取得
        const { data: members } = await admin
          .from("project_members")
          .select("staff_id")
          .eq("project_id", projectId);
        const memberIds = (members ?? []).map(m => m.staff_id as string);

        if (memberIds.length > 0) {
          const { data: staffRows } = await admin
            .from("staffs")
            .select("id, display_name, name, line_user_id")
            .in("id", memberIds) as { data: StaffRow[] | null };

          for (const staff of staffRows ?? []) {
            if (!staff.line_user_id) continue;
            const name    = staff.display_name ?? staff.name ?? staff.id;
            const message = resolveMessage(
              cfg.message ?? DEFAULT_NOTIFY_MESSAGES.holiday_open_notify,
              { "名前": name, "対象月": targetMonth, "締切日": deadlineStr }
            );
            await pushLine(staff.line_user_id, message);
            sent++;
          }
        }
      }
    }

    // ── holiday_reminder：希望休締切3日前リマインド ───────────────────────────
    if (settings.holiday_reminder.enabled) {
      const cfg = settings.holiday_reminder;
      if (isNearTime(cfg.time ?? "09:00")) {
        const { data: rules } = await admin
          .from("holiday_rules")
          .select("rule_type, value")
          .eq("project_id", projectId);
        const deadlineDay = (rules ?? []).find(r => r.rule_type === "deadline_day")?.value as number | null;

        if (deadlineDay) {
          const [y, m] = today.split("-").map(Number);
          const deadlineDate = `${y}-${String(m).padStart(2, "0")}-${String(deadlineDay).padStart(2, "0")}`;
          const todayMs     = new Date(today).getTime();
          const deadlineMs  = new Date(deadlineDate).getTime();
          const daysUntil   = Math.round((deadlineMs - todayMs) / (1000 * 60 * 60 * 24));
          const daysBefore  = cfg.days_before ?? 3;

          if (daysUntil === daysBefore) {
            const { data: members } = await admin
              .from("project_members")
              .select("staff_id")
              .eq("project_id", projectId);
            const memberIds = (members ?? []).map(m => m.staff_id as string);

            if (memberIds.length > 0) {
              const { data: staffRows } = await admin
                .from("staffs")
                .select("id, display_name, name, line_user_id")
                .in("id", memberIds) as { data: StaffRow[] | null };
              const lineIds = (staffRows ?? [])
                .map(s => s.line_user_id)
                .filter(Boolean) as string[];

              if (lineIds.length > 0) {
                const message = resolveMessage(
                  cfg.message ?? DEFAULT_NOTIFY_MESSAGES.holiday_reminder,
                  { "残日数": String(daysUntil), "締切日": deadlineDate }
                );
                await multicastLine(lineIds, message);
                sent++;
              }
            }
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true, sent });
}
