/**
 * 統合メッセージ（管理者専用・送信＋全受信者スレッド管理）
 * スタッフ自身の受信箱は /messages。
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { isAdminView } from "@/lib/admin-view";
import MessagesClient from "../MessagesClient";
import type {
  AdminMessage, AdminThread, MessageReply, AudienceType,
} from "@/lib/messages";

const EPOCH = "1970-01-01T00:00:00Z";

type StaffName = { id: string; display_name?: string | null; name?: string | null };
function nameOf(map: Map<string, StaffName>, id: string): string {
  const s = map.get(id);
  return s?.display_name ?? s?.name ?? id;
}

export default async function MessagesManagePage({
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

  // 管理者ガード（staff モード中・一般スタッフは受信箱へ）
  if (!(await isAdminView(supabase, staffId, projectId))) {
    redirect("/messages");
  }

  const admin = createAdminClient();

  const [{ data: rawMsgs }, { data: rawMembers }] = await Promise.all([
    admin.from("messages")
      .select("id, title, body, audience_type, audience_sections, is_pinned, allow_reply, attachment_url, attachment_name, sender_staff_id, created_at")
      .eq("project_id", projectId)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false }),
    admin.from("project_members")
      .select("staff_id, section, sections, staffs(display_name, name)")
      .eq("project_id", projectId)
      .is("end_date", null),
  ]);

  const msgs = rawMsgs ?? [];
  const msgIds = msgs.map(m => m.id as string);

  const [tRes, rRes] = msgIds.length
    ? await Promise.all([
        admin.from("message_targets")
          .select("message_id, staff_id, staff_read_at, admin_read_at")
          .in("message_id", msgIds),
        admin.from("message_replies")
          .select("id, message_id, thread_staff_id, author_staff_id, body, created_at")
          .in("message_id", msgIds)
          .order("created_at", { ascending: true }),
      ])
    : [{ data: [] }, { data: [] }];

  const targets = (tRes.data ?? []) as {
    message_id: string; staff_id: string;
    staff_read_at: string | null; admin_read_at: string | null;
  }[];
  const replies = (rRes.data ?? []) as {
    id: string; message_id: string; thread_staff_id: string;
    author_staff_id: string; body: string; created_at: string;
  }[];

  // 名前マップ
  const nameMap = new Map<string, StaffName>();
  for (const m of rawMembers ?? []) {
    const s = Array.isArray(m.staffs) ? m.staffs[0] : m.staffs;
    nameMap.set(m.staff_id as string, (s ?? {}) as StaffName);
  }
  const extraIds = new Set<string>();
  for (const m of msgs) extraIds.add(m.sender_staff_id as string);
  for (const t of targets) extraIds.add(t.staff_id);
  for (const r of replies) { extraIds.add(r.author_staff_id); extraIds.add(r.thread_staff_id); }
  const missing = [...extraIds].filter(id => !nameMap.has(id));
  if (missing.length) {
    const { data: extra } = await admin.from("staffs")
      .select("id, display_name, name").in("id", missing);
    for (const s of extra ?? []) nameMap.set(s.id as string, s as StaffName);
  }

  // 返信を (messageId, threadStaffId) でグループ化
  const repliesByThread = new Map<string, MessageReply[]>();
  for (const r of replies) {
    const key = `${r.message_id}|${r.thread_staff_id}`;
    const arr = repliesByThread.get(key) ?? [];
    arr.push({
      id: r.id,
      authorStaffId: r.author_staff_id,
      authorName: nameOf(nameMap, r.author_staff_id),
      body: r.body,
      createdAt: r.created_at,
    });
    repliesByThread.set(key, arr);
  }

  // ターゲットを messageId でグループ化
  const targetsByMsg = new Map<string, typeof targets>();
  for (const t of targets) {
    const arr = targetsByMsg.get(t.message_id) ?? [];
    arr.push(t);
    targetsByMsg.set(t.message_id, arr);
  }

  const adminMessages: AdminMessage[] = msgs.map(m => {
    const id = m.id as string;
    const audienceType = m.audience_type as AudienceType;
    const senderId = m.sender_staff_id as string;
    const ts = (targetsByMsg.get(id) ?? []).map((t): AdminThread => {
      const tStaff = t.staff_id;
      const thRies = repliesByThread.get(`${id}|${tStaff}`) ?? [];
      const adminReadAt = t.admin_read_at;
      const adminFloor = adminReadAt ?? EPOCH;
      const staffReply = thRies.some(r => r.authorStaffId === tStaff && r.createdAt > adminFloor);
      const unreadInbound = audienceType === "admins" && adminReadAt === null;
      return {
        staffId: tStaff,
        staffName: nameOf(nameMap, tStaff),
        staffReadAt: t.staff_read_at,
        adminReadAt,
        replies: thRies,
        needsAttention: staffReply || unreadInbound,
      };
    }).sort((a, b) => a.staffName.localeCompare(b.staffName, "ja"));

    return {
      id,
      title: (m.title ?? null) as string | null,
      body: m.body as string,
      audienceType,
      audienceSections: (m.audience_sections ?? null) as string[] | null,
      isPinned: m.is_pinned as boolean,
      allowReply: m.allow_reply as boolean,
      attachmentUrl: (m.attachment_url ?? null) as string | null,
      attachmentName: (m.attachment_name ?? null) as string | null,
      senderStaffId: senderId,
      senderName: nameOf(nameMap, senderId),
      createdAt: m.created_at as string,
      threads: ts,
    };
  });

  // 送信先選択用メンバー＋セクション一覧
  const members = (rawMembers ?? []).map(m => {
    const s = Array.isArray(m.staffs) ? m.staffs[0] : m.staffs;
    return { id: m.staff_id as string, name: (s as StaffName | null)?.display_name ?? (s as StaffName | null)?.name ?? (m.staff_id as string) };
  }).sort((a, b) => a.name.localeCompare(b.name, "ja"));

  const sectionSet = new Set<string>();
  for (const m of rawMembers ?? []) {
    if (m.section) sectionSet.add(m.section as string);
    for (const s of (m.sections as string[] | null) ?? []) sectionSet.add(s);
  }
  const sections = [...sectionSet].sort((a, b) => a.localeCompare(b, "ja"));

  return (
    <MessagesClient
      isAdmin
      myStaffId={staffId}
      adminMessages={adminMessages}
      staffMessages={[]}
      members={members}
      sections={sections}
      initialOpenId={open ?? null}
    />
  );
}
