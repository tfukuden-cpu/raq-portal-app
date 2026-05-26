/**
 * キーワードベースのタスク抽出ロジック（共通）
 * Cron と Server Action の両方から呼び出す
 */
import { createAdminClient } from "@/lib/supabase/admin";

/** 東京時刻で n 日後の YYYY-MM-DD を返す */
function dateJST(offsetDays = 0): string {
  const d = new Date();
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** due_text から実際の due_date（YYYY-MM-DD）を算出。不明なら翌日 */
function dueDateFromText(dueText: string | null): string {
  if (!dueText)       return dateJST(1); // 未設定 → 翌日
  if (dueText === "今日")   return dateJST(0);
  if (dueText === "明日")   return dateJST(1);
  if (dueText === "明後日") return dateJST(2);
  if (dueText === "今週中") return dateJST(5);
  if (dueText === "来週中") return dateJST(12);
  // "M月D日" 形式
  const m = dueText.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (m) {
    const now  = new Date();
    const year = now.getFullYear();
    const target = new Date(year, parseInt(m[1]) - 1, parseInt(m[2]));
    if (target.getTime() < now.getTime()) target.setFullYear(year + 1);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(target);
  }
  return dateJST(1); // その他 → 翌日
}

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

// @田中 形式 or 田中さん形式の両方に対応
const ASSIGNEE_AT_PATTERN    = /@([^\s\n、。「」()（）]{1,10})/g;
const ASSIGNEE_SUFFIX_PATTERN = /([^\s\n、。「」()（）@]{1,10})(さん|くん|ちゃん|君)/g;

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
  // @田中 形式を優先
  const atMatches = [...text.matchAll(ASSIGNEE_AT_PATTERN)];
  if (atMatches.length > 0) return atMatches[0][1]; // "@" を除いた名前
  // 田中さん 形式
  const suffixMatches = [...text.matchAll(ASSIGNEE_SUFFIX_PATTERN)];
  if (suffixMatches.length > 0) return suffixMatches[0][1] + suffixMatches[0][2];
  return null;
}

function isTaskMessage(text: string): boolean {
  return TASK_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * @メンションのみの行をスキップして最初の有意義な行をタイトルにする
 * 例: "@田中\n発注書を確認してください" → "発注書を確認してください"
 */
function buildTitle(text: string): string {
  const lines = text.split(/[\n\r]/).map(l => l.trim()).filter(Boolean);
  // @XXX だけの行（宛先指定行）をスキップ
  const contentLine = lines.find(l => !/^@[\S]{1,20}$/.test(l)) ?? lines[0] ?? "";
  return contentLine.length > 60 ? contentLine.slice(0, 57) + "…" : contentLine;
}

/**
 * LINEメッセージから内容プレビュー（タイトル行以外の最初の行）を取得
 */
export function buildPreview(text: string, title: string): string | null {
  const lines = text.split(/[\n\r]/).map(l => l.trim()).filter(Boolean);
  // タイトルと@メンション行以外で最初の行を返す
  const preview = lines.find(l => l !== title && !/^@[\S]{1,20}$/.test(l));
  if (!preview) return null;
  return preview.length > 80 ? preview.slice(0, 77) + "…" : preview;
}

export async function runExtractTasks(): Promise<{ ok: boolean; extracted: number; savedMessages?: number; error?: string }> {
  const admin = createAdminClient();

  try {
    const { data: groups } = await admin
      .from("task_extraction_groups")
      .select("group_id, project_id, group_label")
      .eq("enabled", true);

    if (!groups || groups.length === 0) return { ok: true, extracted: 0, savedMessages: 0 };

    let totalExtracted = 0;
    let totalSaved     = 0;

    for (const group of groups) {
      const { data: messages, count } = await admin
        .from("line_group_messages")
        .select("id, user_id, message_text, sent_at", { count: "exact" })
        .eq("group_id", group.group_id)
        .eq("processed", false)
        .order("sent_at", { ascending: true })
        .limit(100);

      totalSaved += count ?? 0;
      if (!messages || messages.length === 0) continue;

      // ── 送信者マップ（line_user_id → スタッフ情報）─────────────────
      const userIds = [...new Set(messages.map(m => m.user_id))];
      const { data: senderStaffs } = await admin
        .from("staffs")
        .select("id, name, display_name, line_user_id")
        .in("line_user_id", userIds);

      const staffMap = new Map<string, { staffId: string; name: string }>();
      for (const s of senderStaffs ?? []) {
        if (s.line_user_id) {
          staffMap.set(s.line_user_id, {
            staffId: s.id,
            name: s.display_name ?? s.name ?? s.id,
          });
        }
      }

      // ── 手動紐づけマップ（優先）──────────────────────────────────
      const { data: mappingRows } = await admin
        .from("line_name_mappings")
        .select("raw_name, staff_id")
        .eq("project_id", group.project_id);

      const nameMappings = new Map<string, string>(); // raw_name → staff_id
      for (const row of mappingRows ?? []) {
        nameMappings.set(row.raw_name, row.staff_id);
      }

      // ── 担当者解決マップ（プロジェクト全メンバー対象）─────────────
      // @田中 のような @メンションからスタッフIDを引くため全メンバーを取得
      const { data: memberRows } = await admin
        .from("project_members")
        .select("staff_id, staffs(id, name, display_name)")
        .eq("project_id", group.project_id);

      // staffId → 名前 のマップ
      const memberNameMap = new Map<string, { staffId: string; name: string }>();
      for (const m of memberRows ?? []) {
        const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
          { id: string; name: string | null; display_name: string | null } | null;
        if (s) {
          memberNameMap.set(s.id, {
            staffId: s.id,
            name: s.display_name ?? s.name ?? s.id,
          });
        }
      }

      for (const msg of messages) {
        if (!isTaskMessage(msg.message_text)) continue;

        const assigneeRaw = extractAssigneeRaw(msg.message_text);
        const dueText     = extractDueText(msg.message_text);
        const dueDate     = dueDateFromText(dueText); // 期日未指定なら翌日
        const title       = buildTitle(msg.message_text);
        const preview     = buildPreview(msg.message_text, title);

        // 担当者解決：① 手動マッピング優先 → ② 名前の部分一致
        let assigneeStaffId: string | null = null;
        if (assigneeRaw) {
          const rawName = assigneeRaw.replace(/(さん|くん|ちゃん|君)$/, "");
          // ① 手動紐づけテーブルを優先チェック
          if (nameMappings.has(rawName)) {
            assigneeStaffId = nameMappings.get(rawName)!;
          } else {
            // ② プロジェクト全メンバーの名前から部分一致で解決
            for (const [, s] of memberNameMap) {
              const sName = s.name.replace(/\s/g, "");
              if (sName.includes(rawName) || rawName.includes(sName)) {
                assigneeStaffId = s.staffId;
                break;
              }
            }
          }
        }

        const sender = staffMap.get(msg.user_id)?.name ?? null;

        await admin.from("group_tasks").insert({
          project_id:        group.project_id,
          group_id:          group.group_id,
          title,
          description:       preview ?? (sender ? `${sender} より` : null),
          assignee_staff_id: assigneeStaffId,
          assignee_raw:      assigneeRaw,
          due_text:          dueText ?? "翌日",
          due_date:          dueDate,
          status:            "pending",
          source_messages:   [{
            sent_at:  msg.sent_at,
            user_id:  msg.user_id,
            sender:   sender,
            text:     msg.message_text,
          }],
        });
        totalExtracted++;
      }

      await admin
        .from("line_group_messages")
        .update({ processed: true })
        .in("id", messages.map(m => m.id));
    }

    return { ok: true, extracted: totalExtracted, savedMessages: totalSaved };
  } catch (err) {
    console.error("[extract-tasks] error:", err);
    return { ok: false, extracted: 0, error: String(err) };
  }
}
