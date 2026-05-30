/**
 * Web Push 通知ライブラリ
 * サーバーサイド専用（webpush ライブラリ使用）
 */

import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

webpush.setVapidDetails(
  "mailto:admin@raq.internal",
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  icon?: string;
};

/** 特定スタッフの全端末に Web Push を送信 */
export async function pushWebToStaff(
  staffId: string,
  payload: WebPushPayload
): Promise<void> {
  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key")
    .eq("staff_id", staffId);

  if (!subs?.length) return;

  const data = JSON.stringify({
    title: payload.title,
    body:  payload.body,
    url:   payload.url  ?? "/dashboard",
    icon:  payload.icon ?? "/icons/icon-192.png",
  });

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          data
        );
      } catch (err: unknown) {
        const e = err as { statusCode?: number };
        // 410 = Gone / 404 = Not Found → 期限切れ購読を削除
        if (e.statusCode === 410 || e.statusCode === 404) {
          await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    })
  );
}

/** 複数スタッフに Web Push を一括送信 */
export async function pushWebToStaffs(
  staffIds: string[],
  payload: WebPushPayload
): Promise<void> {
  if (!staffIds.length) return;
  await Promise.allSettled(staffIds.map(id => pushWebToStaff(id, payload)));
}

/** 案件の全メンバーに Web Push を送信 */
export async function pushWebToProject(
  projectId: string,
  payload: WebPushPayload
): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("project_members")
    .select("staff_id")
    .eq("project_id", projectId);
  const ids = (data ?? []).map(m => m.staff_id as string);
  await pushWebToStaffs(ids, payload);
}

/** 案件の管理者（project_admin）に Web Push を送信 */
export async function pushWebToAdmins(
  projectId: string,
  payload: WebPushPayload
): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("project_members")
    .select("staff_id")
    .eq("project_id", projectId)
    .eq("role", "project_admin");
  const ids = (data ?? []).map(m => m.staff_id as string);
  await pushWebToStaffs(ids, payload);
}
