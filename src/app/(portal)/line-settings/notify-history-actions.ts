"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";

export type NotifyLog = {
  id: string;
  notifyType: string;
  recipientType: "staff" | "group" | "broadcast";
  recipientName: string | null;
  message: string;
  sentAt: string;
};

export async function fetchNotifyLogsAction(
  cursor?: string,
): Promise<{ logs: NotifyLog[]; nextCursor: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const projectId = await getCurrentProjectId();
  if (!projectId) return { logs: [], nextCursor: null };

  const admin = createAdminClient();
  const PAGE = 30;

  let q = admin
    .from("notification_logs")
    .select("id, notify_type, recipient_type, recipient_name, message, sent_at")
    .eq("project_id", projectId)
    .order("sent_at", { ascending: false })
    .limit(PAGE + 1);

  if (cursor) q = q.lt("sent_at", cursor);

  const { data } = await q;

  const rows = data ?? [];
  const hasMore = rows.length > PAGE;
  const items = hasMore ? rows.slice(0, PAGE) : rows;

  return {
    logs: items.map(r => ({
      id:            r.id as string,
      notifyType:    r.notify_type as string,
      recipientType: r.recipient_type as "staff" | "group" | "broadcast",
      recipientName: r.recipient_name as string | null,
      message:       r.message as string,
      sentAt:        r.sent_at as string,
    })),
    nextCursor: hasMore ? (items[items.length - 1].sent_at as string) : null,
  };
}
