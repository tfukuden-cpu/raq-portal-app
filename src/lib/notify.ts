/**
 * LINE通知共通ライブラリ
 * イベント通知・スケジュール通知の両方で使う共通関数をまとめる。
 * サーバーサイド専用（Service Role Key を使う）
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { multicastLine, pushLine } from "@/lib/line";
import {
  pushWebToStaff,
  pushWebToStaffs,
  pushWebToAdmins,
  pushWebToProject,
} from "@/lib/webpush";
import {
  buildDefaultNotificationSettings,
  DEFAULT_NOTIFY_MESSAGES,
  type NotificationSettings,
  type NotifyItemConfig,
} from "@/app/(portal)/admin/[projectId]/settings/notify-config";

// ── 通知ログ ─────────────────────────────────────────────────────────────────

/** 通知ログをDBに記録（失敗しても無視） */
export async function logNotify(entry: {
  projectId:     string;
  notifyType:    string;
  recipientType: "staff" | "group" | "broadcast";
  recipientId?:  string;
  recipientName?: string;
  message:       string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("notification_logs").insert({
      project_id:     entry.projectId,
      notify_type:    entry.notifyType,
      recipient_type: entry.recipientType,
      recipient_id:   entry.recipientId ?? null,
      recipient_name: entry.recipientName ?? null,
      message:        entry.message,
    });
  } catch (e) {
    console.error("[notify] logNotify failed:", e);
  }
}

// ── テンプレート処理 ─────────────────────────────────────────────────────────

/** {変数名} プレースホルダーを実際の値に置換する */
export function resolveMessage(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) =>
    key in vars ? vars[key] : `{${key}}`
  );
}

// ── LINE ID 取得ヘルパー ─────────────────────────────────────────────────────

/** 案件に紐付いたLINEグループIDを取得 */
async function getProjectGroupId(projectId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("project_settings")
    .select("line_group_id")
    .eq("project_id", projectId)
    .maybeSingle();
  return (data?.line_group_id as string | null) ?? null;
}

/** 案件の管理者（project_admin）の LINE ID 一覧を取得 */
export async function getAdminLineIds(projectId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("project_members")
    .select("staffs(line_user_id)")
    .eq("project_id", projectId)
    .eq("role", "project_admin");
  return (data ?? [])
    .map(m => (m.staffs as unknown as { line_user_id: string | null } | null)?.line_user_id)
    .filter((id): id is string => !!id);
}

/** 特定スタッフの LINE ID を取得 */
async function getStaffLineId(staffId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("staffs")
    .select("line_user_id")
    .eq("id", staffId)
    .maybeSingle();
  return (data?.line_user_id as string | null) ?? null;
}

/** 案件の全メンバーの LINE ID を取得 */
async function getAllStaffLineIds(projectId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("project_members")
    .select("staffs(line_user_id)")
    .eq("project_id", projectId);
  return (data ?? [])
    .map(m => (m.staffs as unknown as { line_user_id: string | null } | null)?.line_user_id)
    .filter((id): id is string => !!id);
}

// ── 設定取得 ─────────────────────────────────────────────────────────────────

/** 案件の通知設定を取得（未設定の項目はデフォルト値で補完） */
async function getProjectNotifySettings(projectId: string): Promise<NotificationSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("project_settings")
    .select("notification_settings")
    .eq("project_id", projectId)
    .maybeSingle();
  return buildDefaultNotificationSettings(
    (data?.notification_settings as Record<string, unknown>) ?? {}
  );
}

// ── イベント通知（メイン） ───────────────────────────────────────────────────

/**
 * イベント通知を送信する
 *
 * @param projectId     案件ID
 * @param type          通知種別（notification_settings のキー）
 * @param vars          {変数名} → 実際の値のマップ
 * @param targetStaffId recipient="staff" で特定の1人に送る場合に指定
 *                      省略時は案件の全スタッフ宛
 */
export async function sendEventNotify(
  projectId: string,
  type: keyof NotificationSettings,
  vars: Record<string, string>,
  targetStaffId?: string
): Promise<void> {
  try {
    const settings = await getProjectNotifySettings(projectId);
    const item: NotifyItemConfig = settings[type];
    if (!item.enabled) return;

    const template = item.message ?? DEFAULT_NOTIFY_MESSAGES[type] ?? "";
    const message  = resolveMessage(template, vars);

    const groupId = await getProjectGroupId(projectId);

    const send = async (fn: () => Promise<void>) => {
      try { await fn(); } catch (e) { console.error(`[notify] send failed:`, e); }
    };

    // 通知タイトル（最初の改行前 or 全文の先頭30文字）
    const webTitle = message.split("\n")[0].slice(0, 40) || "Raq ポータル";
    const webBody  = message.split("\n").slice(1).join("\n").trim() || message.slice(0, 80);

    if (item.recipient === "admin") {
      const ids = await getAdminLineIds(projectId);
      if (ids.length > 0) await send(() => multicastLine(ids, message));
      // Web Push: 案件管理者
      await send(() => pushWebToAdmins(projectId, { title: webTitle, body: webBody }));
    } else {
      if (targetStaffId) {
        const lineId = await getStaffLineId(targetStaffId);
        if (lineId) await send(() => pushLine(lineId, message));
        // Web Push: 特定スタッフ
        await send(() => pushWebToStaff(targetStaffId, { title: webTitle, body: webBody }));
      } else {
        const ids = await getAllStaffLineIds(projectId);
        if (ids.length > 0) await send(() => multicastLine(ids, message));
        // Web Push: 全スタッフ
        await send(() => pushWebToProject(projectId, { title: webTitle, body: webBody }));
      }
    }

    // グループにも送信（個別送信の失敗に関わらず必ず試みる）
    if (groupId) await send(() => pushLine(groupId, message));

    // ログ記録
    const recipientName = vars["名前"] ?? undefined;
    if (item.recipient === "admin") {
      void logNotify({ projectId, notifyType: type, recipientType: "group", message });
    } else if (targetStaffId) {
      void logNotify({ projectId, notifyType: type, recipientType: "staff", recipientId: targetStaffId, recipientName, message });
    } else {
      void logNotify({ projectId, notifyType: type, recipientType: "broadcast", message });
    }
  } catch (e) {
    console.error(`[notify] sendEventNotify(${type}) failed:`, e);
  }
}
