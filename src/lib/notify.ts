/**
 * LINE通知共通ライブラリ
 * イベント通知・スケジュール通知の両方で使う共通関数をまとめる。
 * サーバーサイド専用（Service Role Key を使う）
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { multicastLine, pushLine } from "@/lib/line";
import {
  buildDefaultNotificationSettings,
  DEFAULT_NOTIFY_MESSAGES,
  type NotificationSettings,
  type NotifyItemConfig,
} from "@/app/(portal)/admin/[projectId]/settings/notify-config";

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

    if (item.recipient === "admin") {
      const ids = await getAdminLineIds(projectId);
      if (ids.length > 0) await multicastLine(ids, message);
    } else {
      if (targetStaffId) {
        // 特定の1人へ
        const lineId = await getStaffLineId(targetStaffId);
        if (lineId) await pushLine(lineId, message);
      } else {
        // 案件の全スタッフへ
        const ids = await getAllStaffLineIds(projectId);
        if (ids.length > 0) await multicastLine(ids, message);
      }
    }
  } catch (e) {
    console.error(`[notify] sendEventNotify(${type}) failed:`, e);
  }
}
