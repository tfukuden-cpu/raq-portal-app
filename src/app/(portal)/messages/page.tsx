/**
 * 統合メッセージ（周知 + 個別連絡 + 問い合わせ）
 * 管理者: 送信フォーム＋宛先ごとのスレッド一覧
 * スタッフ: 受信箱（自分のスレッド）＋管理者への新規メッセージ
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import MessagesClient from "./MessagesClient";
import type {
  AdminMessage, AdminThread, StaffMessage, MessageReply, AudienceType,
} from "@/lib/messages";

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

  // 管理者判定（staff モード中は無効化）
  const viewMode = (await cookies()).get("rqp-view-mode")?.value ?? "staff";
  const [{ data: staffData }, { data: memberData }] = await Promise.all([
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
    supabase.from("project_members").select("role")
      .eq("project_id", projectId).eq("staff_id", staffId).maybeSingle(),
  ]);
  const isAdmin = viewMode !== "staff" && (
    staffData?.global_role === "admin" ||
    staffData?.global_role === "executive" ||
    memberData?.role === "project_admin"
  );

  if (isAdmin) {
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
    for (const t of targets) extraIds.add(t.staff_id as string);
    for (const r of replies) { extraIds.add(r.author_staff_id as string); extraIds.add(r.thread_staff_id as string); }
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
        id: r.id as string,
        authorStaffId: r.author_staff_id as string,
        authorName: nameOf(nameMap, r.author_staff_id as string),
        body: r.body as string,
        createdAt: r.created_at as string,
      });
      repliesByThread.set(key, arr);
    }

    // ターゲットを messageId でグループ化
    const targetsByMsg = new Map<string, typeof targets>();
    for (const t of targets) {
      const arr = targetsByMsg.get(t.message_id as string) ?? [];
      arr.push(t);
      targetsByMsg.set(t.message_id as string, arr);
    }

    const adminMessages: AdminMessage[] = msgs.map(m => {
      const id = m.id as string;
      const audienceType = m.audience_type as AudienceType;
      const senderId = m.sender_staff_id as string;
      const ts = (targetsByMsg.get(id) ?? []).map((t): AdminThread => {
        const tStaff = t.staff_id as string;
        const thRies = repliesByThread.get(`${id}|${tStaff}`) ?? [];
        const adminReadAt = (t.admin_read_at ?? null) as string | null;
        const adminFloor = adminReadAt ?? EPOCH;
        // 管理者が見るべき新着＝スタッフ(=thread本人)発の内容
        const staffReply = thRies.some(r => r.authorStaffId === tStaff && r.createdAt > adminFloor);
        const unreadInbound = audienceType === "admins" && adminReadAt === null; // 問い合わせ本文
        return {
          staffId: tStaff,
          staffName: nameOf(nameMap, tStaff),
          staffReadAt: (t.staff_read_at ?? null) as string | null,
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

  // ── スタッフビュー（RLS で自分のスレッドのみ取得される） ──
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
