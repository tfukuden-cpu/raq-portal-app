"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";
import type { AudienceType } from "@/lib/messages";

export type MessageResult = { success: boolean; message?: string; messageId?: string };

const MSG_BUCKET = "message-attachments";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ── 共通ヘルパー ──────────────────────────────────────────

/** ログイン中の社員IDを返す（未ログインは null） */
async function getAuthStaffId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return user.email?.split("@")[0]?.toUpperCase() ?? null;
}

/** 案件管理者かどうか（global admin/executive または project_admin） */
async function isProjectAdmin(staffId: string, projectId: string): Promise<boolean> {
  const admin = createAdminClient();
  const [{ data: staff }, { data: member }] = await Promise.all([
    admin.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
    admin.from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
  ]);
  return (
    staff?.global_role === "admin" ||
    staff?.global_role === "executive" ||
    member?.role === "project_admin"
  );
}

async function ensureBucket() {
  const admin = createAdminClient();
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.find(b => b.name === MSG_BUCKET)) {
    await admin.storage.createBucket(MSG_BUCKET, {
      public: true,
      fileSizeLimit: MAX_FILE_SIZE,
    });
  }
}

async function uploadAttachment(
  file: File, projectId: string, staffId: string,
): Promise<{ url: string | null; name: string | null }> {
  if (!file || file.size === 0) return { url: null, name: null };
  try {
    await ensureBucket();
    const admin = createAdminClient();
    const safeName = file.name.replace(/[^\w.\-]/g, "_");
    const path = `${projectId}/${staffId}_${Date.now()}_${safeName}`;
    const buf = await file.arrayBuffer();
    const { error } = await admin.storage.from(MSG_BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: false });
    if (error) { console.error("[messages] upload error:", error); return { url: null, name: null }; }
    const { data } = admin.storage.from(MSG_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, name: file.name };
  } catch (e) {
    console.error("[messages] upload exception:", e);
    return { url: null, name: null };
  }
}

/** 案件のアクティブメンバー（end_date null）を section 付きで取得 */
async function fetchActiveMembers(projectId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("project_members")
    .select("staff_id, section, sections")
    .eq("project_id", projectId)
    .is("end_date", null);
  return (data ?? []).map(m => ({
    staffId: m.staff_id as string,
    section: (m.section ?? null) as string | null,
    sections: (m.sections ?? null) as string[] | null,
  }));
}

// ── 管理者：メッセージ送信（全員 / セクション / 個別） ──────

export async function sendMessageAction(formData: FormData): Promise<MessageResult> {
  try {
    return await _sendMessageAction(formData);
  } catch (e) {
    console.error("[sendMessageAction] unhandled:", e);
    return { success: false, message: "サーバーエラー: " + String(e) };
  }
}

async function _sendMessageAction(formData: FormData): Promise<MessageResult> {
  const title       = String(formData.get("title") ?? "").trim() || null;
  const body        = String(formData.get("body")  ?? "").trim();
  const audienceTypeRaw = String(formData.get("audienceType") ?? "").trim();
  const isPinned    = formData.get("isPinned")  === "true";
  const allowReply  = formData.get("allowReply") !== "false"; // 既定 true
  const sectionsRaw = String(formData.get("sections") ?? "[]");
  const staffIdsRaw = String(formData.get("staffIds") ?? "[]");
  const attachFile  = formData.get("attachment") as File | null;

  if (!body) return { success: false, message: "本文は必須です" };
  if (!["all", "section", "staff"].includes(audienceTypeRaw)) {
    return { success: false, message: "宛先の指定が不正です" };
  }
  const audienceType = audienceTypeRaw as AudienceType;

  const supabase = await createClient();
  const staffId = await getAuthStaffId(supabase);
  if (!staffId) return { success: false, message: "ログインしてください" };
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  if (!(await isProjectAdmin(staffId, projectId))) {
    return { success: false, message: "送信権限がありません" };
  }

  if (attachFile && attachFile.size > MAX_FILE_SIZE) {
    return { success: false, message: "ファイルが大きすぎます（最大10MB）" };
  }

  // 宛先解決
  const members = await fetchActiveMembers(projectId);
  let sections: string[] = [];
  let staffIds: string[] = [];
  try { sections = JSON.parse(sectionsRaw); } catch { sections = []; }
  try { staffIds = JSON.parse(staffIdsRaw); } catch { staffIds = []; }

  let recipientIds: string[] = [];
  if (audienceType === "all") {
    recipientIds = members.map(m => m.staffId);
  } else if (audienceType === "section") {
    if (sections.length === 0) return { success: false, message: "セクションを選択してください" };
    const sel = new Set(sections);
    recipientIds = members
      .filter(m =>
        (m.section && sel.has(m.section)) ||
        (m.sections ?? []).some(s => sel.has(s))
      )
      .map(m => m.staffId);
  } else { // staff
    if (staffIds.length === 0) return { success: false, message: "宛先のスタッフを選択してください" };
    const memberSet = new Set(members.map(m => m.staffId));
    recipientIds = staffIds.filter(id => memberSet.has(id));
  }
  recipientIds = [...new Set(recipientIds)];
  if (recipientIds.length === 0) {
    return { success: false, message: "宛先に該当するスタッフがいません" };
  }

  // 添付
  const { url: attachmentUrl, name: attachmentName } =
    attachFile ? await uploadAttachment(attachFile, projectId, staffId) : { url: null, name: null };

  // メッセージ本体（admin クライアントで挿入し ID 取得）
  const admin = createAdminClient();
  const { data: inserted, error: insErr } = await admin.from("messages")
    .insert({
      project_id:        projectId,
      sender_staff_id:   staffId,
      title,
      body,
      audience_type:     audienceType,
      audience_sections: audienceType === "section" ? sections : null,
      is_pinned:         isPinned,
      allow_reply:       allowReply,
      attachment_url:    attachmentUrl,
      attachment_name:   attachmentName,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return { success: false, message: "送信失敗: " + (insErr?.message ?? "不明") };
  }
  const messageId = inserted.id as string;

  // 受信者を展開（他人の行を作るため admin クライアント）
  const targetRows = recipientIds.map(rid => ({
    message_id: messageId,
    project_id: projectId,
    staff_id:   rid,
  }));
  const { error: tErr } = await admin.from("message_targets").insert(targetRows);
  if (tErr) {
    console.error("[sendMessageAction] target insert error:", tErr);
    return { success: false, message: "受信者の登録に失敗: " + tErr.message };
  }

  revalidatePath("/messages");
  revalidatePath("/messages/manage");
  revalidatePath("/dashboard");
  return { success: true, messageId };
}

// ── スタッフ：管理者へメッセージ（旧・問い合わせ） ──────────

export async function staffStartMessageAction(formData: FormData): Promise<MessageResult> {
  try {
    return await _staffStartMessageAction(formData);
  } catch (e) {
    console.error("[staffStartMessageAction] unhandled:", e);
    return { success: false, message: "サーバーエラー: " + String(e) };
  }
}

async function _staffStartMessageAction(formData: FormData): Promise<MessageResult> {
  const title = String(formData.get("title") ?? "").trim() || null;
  const body  = String(formData.get("body")  ?? "").trim();
  if (!body) return { success: false, message: "内容を入力してください" };

  const supabase = await createClient();
  const staffId = await getAuthStaffId(supabase);
  if (!staffId) return { success: false, message: "ログインしてください" };
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const admin = createAdminClient();
  const { data: inserted, error: insErr } = await admin.from("messages")
    .insert({
      project_id:      projectId,
      sender_staff_id: staffId,
      title,
      body,
      audience_type:   "admins",
      is_pinned:       false,
      allow_reply:     true,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return { success: false, message: "送信失敗: " + (insErr?.message ?? "不明") };
  }
  const messageId = inserted.id as string;

  // 管理者宛は「発信スタッフ本人」を受信者行（スレッド）にする
  const { error: tErr } = await admin.from("message_targets").insert({
    message_id: messageId,
    project_id: projectId,
    staff_id:   staffId,
  });
  if (tErr) {
    console.error("[staffStartMessageAction] target insert error:", tErr);
    return { success: false, message: "登録に失敗: " + tErr.message };
  }

  revalidatePath("/messages");
  revalidatePath("/messages/manage");
  return { success: true, messageId };
}

// ── スレッドへの返信（双方向） ──────────────────────────────

export async function replyMessageAction(formData: FormData): Promise<MessageResult> {
  try {
    return await _replyMessageAction(formData);
  } catch (e) {
    console.error("[replyMessageAction] unhandled:", e);
    return { success: false, message: "サーバーエラー: " + String(e) };
  }
}

async function _replyMessageAction(formData: FormData): Promise<MessageResult> {
  const messageId     = String(formData.get("messageId") ?? "").trim();
  const threadStaffId = String(formData.get("threadStaffId") ?? "").trim();
  const body          = String(formData.get("body") ?? "").trim();
  if (!messageId || !threadStaffId || !body) {
    return { success: false, message: "返信内容を入力してください" };
  }

  const supabase = await createClient();
  const staffId = await getAuthStaffId(supabase);
  if (!staffId) return { success: false, message: "ログインしてください" };
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const admin = await isProjectAdmin(staffId, projectId);
  // スタッフは自分のスレッドのみ返信可
  if (!admin && threadStaffId !== staffId) {
    return { success: false, message: "このスレッドには返信できません" };
  }

  // RLS: insert_message_replies（author=自分 かつ 自分のスレッド or 管理者）
  const { error } = await supabase.from("message_replies").insert({
    message_id:      messageId,
    project_id:      projectId,
    thread_staff_id: threadStaffId,
    author_staff_id: staffId,
    body,
  });
  if (error) return { success: false, message: "返信失敗: " + error.message };

  // 既読時刻を更新（返信した側は読んだとみなす）
  const nowIso = new Date().toISOString();
  const patch = admin ? { admin_read_at: nowIso } : { staff_read_at: nowIso };
  await supabase.from("message_targets").update(patch)
    .eq("message_id", messageId).eq("staff_id", threadStaffId);

  revalidatePath("/messages");
  revalidatePath("/messages/manage");
  revalidatePath("/dashboard");
  return { success: true };
}

// ── スレッド既読化 ────────────────────────────────────────

export async function markThreadReadAction(
  messageId: string, threadStaffId: string,
): Promise<void> {
  const supabase = await createClient();
  const staffId = await getAuthStaffId(supabase);
  if (!staffId) return;
  const projectId = await getCurrentProjectId();
  if (!projectId) return;

  const admin = await isProjectAdmin(staffId, projectId);
  const nowIso = new Date().toISOString();
  // スタッフは自分のスレッドのみ。管理者は任意スレッド。
  const targetStaff = admin ? threadStaffId : staffId;
  const patch = admin ? { admin_read_at: nowIso } : { staff_read_at: nowIso };
  await supabase.from("message_targets").update(patch)
    .eq("message_id", messageId).eq("staff_id", targetStaff);

  revalidatePath("/messages");
  revalidatePath("/messages/manage");
  revalidatePath("/dashboard");
}

// ── 管理者：スタッフ別チャットルームでの個別トーク送信 ──────
// 1スタッフにつき is_direct=true のメッセージ（アンカー）を1本だけ作り、
// 以降の管理者発言はそのスレッドへの返信として積む。送信履歴には出さない。

export async function sendDirectMessageAction(formData: FormData): Promise<MessageResult> {
  try {
    return await _sendDirectMessageAction(formData);
  } catch (e) {
    console.error("[sendDirectMessageAction] unhandled:", e);
    return { success: false, message: "サーバーエラー: " + String(e) };
  }
}

async function _sendDirectMessageAction(formData: FormData): Promise<MessageResult> {
  const targetStaffId = String(formData.get("staffId") ?? "").trim();
  const body          = String(formData.get("body") ?? "").trim();
  if (!targetStaffId || !body) return { success: false, message: "送信内容を入力してください" };

  const supabase = await createClient();
  const staffId = await getAuthStaffId(supabase);
  if (!staffId) return { success: false, message: "ログインしてください" };
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };
  if (!(await isProjectAdmin(staffId, projectId))) {
    return { success: false, message: "送信権限がありません" };
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // 既存の個別トーク（アンカー）を探す
  const { data: anchorRows } = await admin
    .from("message_targets")
    .select("message_id, messages!inner(id, is_direct)")
    .eq("project_id", projectId)
    .eq("staff_id", targetStaffId);
  let anchorId: string | null = null;
  for (const row of anchorRows ?? []) {
    const m = Array.isArray(row.messages) ? row.messages[0] : row.messages;
    if (m && (m as { is_direct?: boolean }).is_direct) { anchorId = (m as { id: string }).id; break; }
  }

  if (!anchorId) {
    // 初回：アンカーとなる個別メッセージを作成（本文＝最初の発言）
    const { data: inserted, error: insErr } = await admin.from("messages")
      .insert({
        project_id:      projectId,
        sender_staff_id: staffId,
        title:           null,
        body,
        audience_type:   "staff",
        is_direct:       true,
        is_pinned:       false,
        allow_reply:     true,
      })
      .select("id")
      .single();
    if (insErr || !inserted) return { success: false, message: "送信失敗: " + (insErr?.message ?? "不明") };
    const { error: tErr } = await admin.from("message_targets").insert({
      message_id: inserted.id, project_id: projectId, staff_id: targetStaffId,
      admin_read_at: nowIso,
    });
    if (tErr) return { success: false, message: "登録に失敗: " + tErr.message };
  } else {
    // 2回目以降：アンカースレッドへ返信として積む
    const { error: rErr } = await admin.from("message_replies").insert({
      message_id: anchorId, project_id: projectId,
      thread_staff_id: targetStaffId, author_staff_id: staffId, body,
    });
    if (rErr) return { success: false, message: "送信失敗: " + rErr.message };
    await admin.from("message_targets").update({ admin_read_at: nowIso })
      .eq("message_id", anchorId).eq("staff_id", targetStaffId);
  }

  revalidatePath("/messages");
  revalidatePath("/messages/manage");
  revalidatePath("/dashboard");
  return { success: true };
}

/** 管理者：あるスタッフのルーム（全スレッド）を既読にする */
export async function markStaffRoomReadAction(targetStaffId: string): Promise<void> {
  const supabase = await createClient();
  const staffId = await getAuthStaffId(supabase);
  if (!staffId) return;
  const projectId = await getCurrentProjectId();
  if (!projectId) return;
  if (!(await isProjectAdmin(staffId, projectId))) return;

  const admin = createAdminClient();
  await admin.from("message_targets")
    .update({ admin_read_at: new Date().toISOString() })
    .eq("project_id", projectId).eq("staff_id", targetStaffId);

  revalidatePath("/messages/manage");
  revalidatePath("/dashboard");
}

// ── 削除（発信者 or 管理者） ──────────────────────────────

export async function deleteMessageAction(formData: FormData): Promise<MessageResult> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();
  // RLS: delete_messages（発信者 or 管理者）。targets/replies は cascade
  const { error } = await supabase.from("messages").delete().eq("id", id);
  if (error) return { success: false, message: "削除失敗: " + error.message };

  revalidatePath("/messages");
  revalidatePath("/messages/manage");
  revalidatePath("/dashboard");
  return { success: true };
}
