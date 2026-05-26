/**
 * キーワードベースのタスク抽出ロジック（共通）
 * Cron と Server Action の両方から呼び出す
 */
import { createAdminClient } from "@/lib/supabase/admin";

const TASK_KEYWORDS = [
  "お願い", "おねがい",
  "してください", "して下さい",
  "しておいて", "しといて",
  "確認してください", "確認お願い", "確認よろしく",
  "対応してください", "対応お願い",
  "やっておいて", "やっといて",
  "手配してください", "手配お願い",
  "発注してください", "発注お願い",
  "準備してください", "準備お願い",
  "連絡してください", "連絡お願い",
  "忘れずに", "忘れないで",
  "までに", "までお願い",
  "提出してください", "提出お願い",
  "報告してください", "報告お願い",
];

const ASSIGNEE_PATTERN = /([^\s、。「」()（）]{1,10})(さん|くん|ちゃん|君)/g;

const DUE_PATTERNS: { pattern: RegExp; label: (m: RegExpMatchArray) => string }[] = [
  { pattern: /今日中|今日まで|本日中|本日まで/,        label: () => "今日" },
  { pattern: /明日中|明日まで|明日までに/,             label: () => "明日" },
  { pattern: /明後日中|明後日まで|明後日/,             label: () => "明後日" },
  { pattern: /今週中|今週まで/,                        label: () => "今週中" },
  { pattern: /来週中|来週まで/,                        label: () => "来週中" },
  { pattern: /(\d{1,2})[\/月](\d{1,2})[日]?(まで|までに|中)?/, label: m => `${m[1]}月${m[2]}日` },
  { pattern: /(\d{1,2})日(まで|までに|中)/,            label: m => `${m[1]}日まで` },
  { pattern: /(月|火|水|木|金|土|日)曜(日)?(まで|までに|中)?/, label: m => `${m[1]}曜日` },
  { pattern: /午前中|午後|(\d{1,2})時まで|(\d{1,2})時までに/, label: m => m[0] },
];

function extractDueText(text: string): string | null {
  for (const { pattern, label } of DUE_PATTERNS) {
    const m = text.match(pattern);
    if (m) return label(m);
  }
  return null;
}

function extractAssigneeRaw(text: string): string | null {
  const matches = [...text.matchAll(ASSIGNEE_PATTERN)];
  if (matches.length > 0) return matches[0][1] + matches[0][2];
  return null;
}

function isTaskMessage(text: string): boolean {
  return TASK_KEYWORDS.some(kw => text.includes(kw));
}

function buildTitle(text: string): string {
  const firstLine = text.split(/[\n\r]/)[0].trim();
  return firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine;
}

export async function runExtractTasks(): Promise<{ ok: boolean; extracted: number; error?: string }> {
  const admin = createAdminClient();

  try {
    const { data: groups } = await admin
      .from("task_extraction_groups")
      .select("group_id, project_id, group_label")
      .eq("enabled", true);

    if (!groups || groups.length === 0) return { ok: true, extracted: 0 };

    let totalExtracted = 0;

    for (const group of groups) {
      const { data: messages } = await admin
        .from("line_group_messages")
        .select("id, user_id, message_text, sent_at")
        .eq("group_id", group.group_id)
        .eq("processed", false)
        .order("sent_at", { ascending: true })
        .limit(100);

      if (!messages || messages.length === 0) continue;

      const userIds = [...new Set(messages.map(m => m.user_id))];
      const { data: staffRows } = await admin
        .from("staffs")
        .select("id, name, display_name, line_user_id")
        .in("line_user_id", userIds);

      const staffMap = new Map<string, { staffId: string; name: string }>();
      for (const s of staffRows ?? []) {
        if (s.line_user_id) {
          staffMap.set(s.line_user_id, {
            staffId: s.id,
            name: s.display_name ?? s.name ?? s.id,
          });
        }
      }

      for (const msg of messages) {
        if (!isTaskMessage(msg.message_text)) continue;

        const assigneeRaw   = extractAssigneeRaw(msg.message_text);
        const dueText       = extractDueText(msg.message_text);

        let assigneeStaffId: string | null = null;
        if (assigneeRaw) {
          const rawName = assigneeRaw.replace(/(さん|くん|ちゃん|君)$/, "");
          for (const [, s] of staffMap) {
            if (s.name.includes(rawName) || rawName.includes(s.name)) {
              assigneeStaffId = s.staffId;
              break;
            }
          }
        }

        const sender = staffMap.get(msg.user_id)?.name ?? null;

        await admin.from("group_tasks").insert({
          project_id:        group.project_id,
          group_id:          group.group_id,
          title:             buildTitle(msg.message_text),
          description:       sender ? `${sender} より` : null,
          assignee_staff_id: assigneeStaffId,
          assignee_raw:      assigneeRaw,
          due_text:          dueText,
          status:            "pending",
          source_messages:   [{
            sent_at: msg.sent_at,
            user_id: msg.user_id,
            text:    msg.message_text,
          }],
        });
        totalExtracted++;
      }

      await admin
        .from("line_group_messages")
        .update({ processed: true })
        .in("id", messages.map(m => m.id));
    }

    return { ok: true, extracted: totalExtracted };
  } catch (err) {
    console.error("[extract-tasks] error:", err);
    return { ok: false, extracted: 0, error: String(err) };
  }
}
