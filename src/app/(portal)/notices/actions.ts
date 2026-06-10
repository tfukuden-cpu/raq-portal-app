"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";
import { sendEventNotify } from "@/lib/notify";

/** お知らせを「確認済」にする */
export async function markNoticeReadAction(noticeId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  await supabase.from("notice_reads").upsert(
    { notice_id: noticeId, staff_id: staffId, read_at: new Date().toISOString() },
    { onConflict: "notice_id,staff_id" }
  );
  revalidatePath("/notices");
}

export type NoticeResult = {
  success: boolean;
  message?: string;
};

const NOTICE_BUCKET = "notice-attachments";

async function ensureNoticeBucket() {
  const admin = createAdminClient();
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.find(b => b.name === NOTICE_BUCKET)) {
    await admin.storage.createBucket(NOTICE_BUCKET, {
      public: true,
      fileSizeLimit: 20 * 1024 * 1024,
    });
  }
}

export async function createNoticeAction(
  formData: FormData
): Promise<NoticeResult> {
  const title          = String(formData.get("title")         ?? "").trim();
  const body           = String(formData.get("body")          ?? "").trim();
  const isPinned       = formData.get("isPinned")             === "true";
  const sendLine       = formData.get("sendLine")             === "true";
  const targetStaffId  = String(formData.get("targetStaffId") ?? "").trim() || null;
  const customDateRaw  = String(formData.get("customDate")    ?? "").trim();
  const attachmentFile = formData.get("attachment") as File | null;

  if (!title || !body) {
    return { success: false, message: "タイトルと本文は必須です" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  // 過去日時指定：datetime-local の値（JST）を +09:00 ISO 文字列に変換
  const createdAt = customDateRaw
    ? `${customDateRaw}:00+09:00`
    : new Date().toISOString();

  // 添付ファイルアップロード
  let attachmentUrl: string | null = null;
  let attachmentName: string | null = null;
  if (attachmentFile && attachmentFile.size > 0) {
    try {
      await ensureNoticeBucket();
      const admin = createAdminClient();
      const safeName = attachmentFile.name.replace(/[^\w.\-]/g, "_");
      const path = `${projectId}/${staffId}_${Date.now()}_${safeName}`;
      const buf  = await attachmentFile.arrayBuffer();
      const { error: uploadError } = await admin.storage
        .from(NOTICE_BUCKET)
        .upload(path, buf, { contentType: attachmentFile.type, upsert: false });
      if (!uploadError) {
        const { data } = admin.storage.from(NOTICE_BUCKET).getPublicUrl(path);
        attachmentUrl  = data.publicUrl;
        attachmentName = attachmentFile.name;
      } else {
        console.error("[notice] upload error:", uploadError);
      }
    } catch (e) {
      console.error("[notice] upload exception:", e);
    }
  }

  const { data: newNotice, error } = await supabase
    .from("notices")
    .insert({
      project_id:      projectId,
      title,
      body,
      is_pinned:       isPinned,
      posted_by:       staffId,
      target_staff_id: targetStaffId,
      created_at:      createdAt,
      attachment_url:  attachmentUrl,
      attachment_name: attachmentName,
    })
    .select("id")
    .single();

  if (error) return { success: false, message: "投稿失敗：" + error.message };

  revalidatePath("/notices");
  revalidatePath("/notices/manage");
  revalidatePath("/dashboard");

  // LINE通知（sendLine=trueの場合のみ）
  if (sendLine && newNotice?.id) {
    const appUrl    = process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app";
    const noticeUrl = `${appUrl}/notices?open=${newNotice.id}`;

    const { data: senderData } = await supabase
      .from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
    const senderName = senderData?.display_name ?? senderData?.name ?? staffId;

    let recipientLabel = "全スタッフ";
    if (targetStaffId) {
      const { data: recipientData } = await supabase
        .from("staffs").select("display_name, name").eq("id", targetStaffId).maybeSingle();
      const recipientName = recipientData?.display_name ?? recipientData?.name ?? targetStaffId;
      recipientLabel = `${recipientName}さん`;
    }

    const sep = "─────────────────";
    const staffMessage  = `【お知らせ】\n宛先：${recipientLabel}\n送信者：${senderName}\n${sep}\n${title}\n\n${body}\n${sep}`;
    const groupPrefix   = `📢 周知事項送信\n送信者：${senderName}\n送信先：${recipientLabel}`;

    void sendEventNotify(
      projectId,
      "announcement",
      { "タイトル": title, "本文": body },
      targetStaffId ?? undefined,
      { label: "内容を見る", url: noticeUrl },
      groupPrefix,
      staffMessage,
    );
  }

  return { success: true };
}

export async function updateNoticeAction(
  formData: FormData
): Promise<NoticeResult> {
  const id      = String(formData.get("id")      ?? "").trim();
  const title   = String(formData.get("title")   ?? "").trim();
  const body    = String(formData.get("body")     ?? "").trim();
  const isPinned = formData.get("isPinned") === "true";

  if (!id || !title || !body) {
    return { success: false, message: "IDとタイトルと本文は必須です" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("notices")
    .update({ title, body, is_pinned: isPinned, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { success: false, message: "更新失敗：" + error.message };

  revalidatePath("/notices");
  revalidatePath("/notices/manage");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteNoticeAction(
  formData: FormData
): Promise<NoticeResult> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();

  // 添付ファイルも削除
  const { data: notice } = await supabase
    .from("notices")
    .select("attachment_url")
    .eq("id", id)
    .maybeSingle();
  if (notice?.attachment_url) {
    try {
      const admin = createAdminClient();
      const url   = new URL(notice.attachment_url);
      const path  = url.pathname.split(`/${NOTICE_BUCKET}/`)[1];
      if (path) await admin.storage.from(NOTICE_BUCKET).remove([path]);
    } catch { /* ignore */ }
  }

  const { error } = await supabase.from("notices").delete().eq("id", id);
  if (error) return { success: false, message: "削除失敗：" + error.message };

  revalidatePath("/notices");
  revalidatePath("/notices/manage");
  revalidatePath("/dashboard");
  return { success: true };
}
