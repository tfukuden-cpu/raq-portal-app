/**
 * 統合メッセージ（スタッフ用・自分宛の受信箱）
 * 管理者も一スタッフとして「自分が受信したメッセージ」をここで見る。
 * 送信・全受信者スレッド管理は /messages/manage（管理者専用）。
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import MessagesClient from "./MessagesClient";
import type { StaffMessage, MessageReply, AudienceType } from "@/lib/messages";

const EPOCH = "1970-01-01T00:00:00Z";

type StaffName = { id: string; display_name?: string | null; name?: string | null };
function nameOf(map: Map<string, StaffName>, id: string): string {
  const s = map.get(id);
  return s?.display_name ?? s?.name ?? id;
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { open } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  // 自分宛のスレッド（RLS で自分のぶんのみ取得される）
  const { data: rawTargets } = await supabase
    .from("message_targets")
    .select("message_id, staff_read_at")
    .eq("staff_id", staffId);
  const myMsgIds = (rawTargets ?? []).map(t => t.message_id as string);
  const readMap = new Map<string, string | null>(
    (rawTargets ?? []).map(t => [t.message_id as string, (t.staff_read_at ?? null) as string | null])
  );

  let staffMessages: StaffMessage[] = [];
  if (myMsgIds.length) {
    const [{ data: rawMsgs }, { data: rawReplies }] = await Promise.all([
      supabase.from("messages")
        .select("id, title, body, audience_type, is_pinned, allow_reply, attachment_url, attachment_name, sender_staff_id, created_at")
        .in("id", myMsgIds)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("message_replies")
        .select("id, message_id, thread_staff_id, author_staff_id, body, created_at")
        .in("message_id", myMsgIds)
        .eq("thread_staff_id", staffId)
        .order("created_at", { ascending: true }),
    ]);

    const msgs = rawMsgs ?? [];
    const replies = rawReplies ?? [];

    // 名前解決
    const ids = new Set<string>();
    for (const m of msgs) ids.add(m.sender_staff_id as string);
    for (const r of replies) ids.add(r.author_staff_id as string);
    const { data: staffRows } = ids.size
      ? await supabase.from("staffs").select("id, display_name, name").in("id", [...ids])
      : { data: [] as StaffName[] };
    const nameMap = new Map<string, StaffName>((staffRows ?? []).map(s => [s.id as string, s as StaffName]));

    const repliesByMsg = new Map<string, MessageReply[]>();
    for (const r of replies) {
      const arr = repliesByMsg.get(r.message_id as string) ?? [];
      arr.push({
        id: r.id as string,
        authorStaffId: r.author_staff_id as string,
        authorName: nameOf(nameMap, r.author_staff_id as string),
        body: r.body as string,
        createdAt: r.created_at as string,
      });
      repliesByMsg.set(r.message_id as string, arr);
    }

    staffMessages = msgs.map(m => {
      const id = m.id as string;
      const iAmSender = (m.sender_staff_id as string) === staffId;
      const readAt = readMap.get(id) ?? null;
      const floor = readAt ?? EPOCH;
      const thRies = repliesByMsg.get(id) ?? [];
      const otherReply = thRies.some(r => r.authorStaffId !== staffId && r.createdAt > floor);
      const unreadBody = !iAmSender && readAt === null;
      return {
        messageId: id,
        title: (m.title ?? null) as string | null,
        body: m.body as string,
        audienceType: m.audience_type as AudienceType,
        isPinned: m.is_pinned as boolean,
        allowReply: m.allow_reply as boolean,
        attachmentUrl: (m.attachment_url ?? null) as string | null,
        attachmentName: (m.attachment_name ?? null) as string | null,
        senderStaffId: m.sender_staff_id as string,
        senderName: nameOf(nameMap, m.sender_staff_id as string),
        createdAt: m.created_at as string,
        replies: thRies,
        iAmSender,
        hasUnread: otherReply || unreadBody,
      };
    });
  }

  return (
    <MessagesClient
      isAdmin={false}
      myStaffId={staffId}
      adminMessages={[]}
      staffMessages={staffMessages}
      members={[]}
      sections={[]}
      initialOpenId={open ?? null}
    />
  );
}
