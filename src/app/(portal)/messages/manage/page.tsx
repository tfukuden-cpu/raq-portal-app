/**
 * 統合メッセージ（管理者専用）
 * - スタッフ別チャットルーム（LINE風・配信も個別トークも時系列で蓄積）
 * - 送信履歴（新規配信＝全員/セクション/個別のみ）
 * スタッフ自身の受信箱は /messages。
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { isAdminView } from "@/lib/admin-view";
import MessagesClient from "../MessagesClient";
import type {
  AdminMessage, AdminThread, MessageReply, AudienceType, StaffRoom, RoomItem,
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

  if (!(await isAdminView(supabase, staffId, projectId))) {
    redirect("/messages");
  }

  const admin = createAdminClient();

  const [{ data: rawMsgs }, { data: rawMembers }] = await Promise.all([
    admin.from("messages")
      .select("id, title, body, audience_type, audience_sections, is_pinned, allow_reply, is_direct, attachment_url, attachment_name, sender_staff_id, created_at")
      .eq("project_id", projectId)
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

  // メッセージ index
  type Msg = (typeof msgs)[number];
  const msgById = new Map<string, Msg>();
  for (const m of msgs) msgById.set(m.id as string, m);

  // 返信を (messageId|threadStaffId) でグループ化
  const repliesByThread = new Map<string, MessageReply[]>();
  for (const r of replies) {
    const key = `${r.message_id}|${r.thread_staff_id}`;
    const arr = repliesByThread.get(key) ?? [];
    arr.push({
      id: r.id, authorStaffId: r.author_staff_id,
      authorName: nameOf(nameMap, r.author_staff_id),
      body: r.body, createdAt: r.created_at,
    });
    repliesByThread.set(key, arr);
  }

  // ── 送信履歴（新規配信のみ＝is_direct=false かつ audience≠admins） ──
  const targetsByMsg = new Map<string, typeof targets>();
  for (const t of targets) {
    const arr = targetsByMsg.get(t.message_id) ?? [];
    arr.push(t);
    targetsByMsg.set(t.message_id, arr);
  }

  const historyMsgs = msgs.filter(m => !m.is_direct && (m.audience_type as string) !== "admins");
  const adminMessages: AdminMessage[] = historyMsgs.map(m => {
    const id = m.id as string;
    const audienceType = m.audience_type as AudienceType;
    const ts = (targetsByMsg.get(id) ?? []).map((t): AdminThread => {
      const tStaff = t.staff_id;
      const thRies = repliesByThread.get(`${id}|${tStaff}`) ?? [];
      const adminFloor = t.admin_read_at ?? EPOCH;
      const staffReply = thRies.some(r => r.authorStaffId === tStaff && r.createdAt > adminFloor);
      return {
        staffId: tStaff,
        staffName: nameOf(nameMap, tStaff),
        staffReadAt: t.staff_read_at,
        adminReadAt: t.admin_read_at,
        replies: thRies,
        needsAttention: staffReply,
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
      senderStaffId: m.sender_staff_id as string,
      senderName: nameOf(nameMap, m.sender_staff_id as string),
      createdAt: m.created_at as string,
      threads: ts,
    };
  }).sort((a, b) =>
    (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt)
  );

  // ── スタッフ別チャットルーム（全現役メンバー） ──
  // staffId -> その人が受信者になっている target 群
  const targetsByStaff = new Map<string, typeof targets>();
  for (const t of targets) {
    const arr = targetsByStaff.get(t.staff_id) ?? [];
    arr.push(t);
    targetsByStaff.set(t.staff_id, arr);
  }

  const memberIds = (rawMembers ?? []).map(m => m.staff_id as string);
  const staffRooms: StaffRoom[] = memberIds.map(sid => {
    const items: RoomItem[] = [];
    let unread = 0;
    for (const t of targetsByStaff.get(sid) ?? []) {
      const m = msgById.get(t.message_id);
      if (!m) continue;
      const adminRead = t.admin_read_at;
      const audience = m.audience_type as string;
      const senderIsStaff = (m.sender_staff_id as string) === sid; // 問い合わせ等
      // メッセージ本文の吹き出し
      items.push({
        id: `m${m.id}`,
        side: senderIsStaff ? "staff" : "admin",
        authorName: senderIsStaff ? nameOf(nameMap, sid) : nameOf(nameMap, m.sender_staff_id as string),
        body: m.body as string,
        createdAt: m.created_at as string,
        isBroadcast: audience === "all" || audience === "section",
        attachmentUrl: (m.attachment_url ?? null) as string | null,
        attachmentName: (m.attachment_name ?? null) as string | null,
      });
      if (senderIsStaff && !adminRead) unread++;
      // スレッド内の返信
      for (const r of repliesByThread.get(`${m.id}|${sid}`) ?? []) {
        const staffSide = r.authorStaffId === sid;
        items.push({
          id: `r${r.id}`,
          side: staffSide ? "staff" : "admin",
          authorName: r.authorName,
          body: r.body,
          createdAt: r.createdAt,
          isBroadcast: false,
          attachmentUrl: null, attachmentName: null,
        });
        if (staffSide && (!adminRead || r.createdAt > adminRead)) unread++;
      }
    }
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = items[items.length - 1] ?? null;
    return {
      staffId: sid,
      staffName: nameOf(nameMap, sid),
      items,
      lastActivityAt: last?.createdAt ?? null,
      lastSnippet: last ? last.body.slice(0, 30) : "",
      unreadCount: unread,
    };
  }).sort((a, b) => {
    // 未読優先 → 最終活動が新しい順 → 名前順
    if ((b.unreadCount > 0 ? 1 : 0) !== (a.unreadCount > 0 ? 1 : 0)) {
      return (b.unreadCount > 0 ? 1 : 0) - (a.unreadCount > 0 ? 1 : 0);
    }
    if (a.lastActivityAt && b.lastActivityAt) return b.lastActivityAt.localeCompare(a.lastActivityAt);
    if (a.lastActivityAt) return -1;
    if (b.lastActivityAt) return 1;
    return a.staffName.localeCompare(b.staffName, "ja");
  });

  // 新規配信フォーム用
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
      staffRooms={staffRooms}
      members={members}
      sections={sections}
      initialOpenId={open ?? null}
    />
  );
}
