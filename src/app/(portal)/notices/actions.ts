"use server";

import { createClient } from "@/lib/supabase/server";
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

export async function createNoticeAction(
  formData: FormData
): Promise<NoticeResult> {
  const title          = String(formData.get("title")         ?? "").trim();
  const body           = String(formData.get("body")          ?? "").trim();
  const isPinned       = formData.get("isPinned")             === "true";
  const sendLine       = formData.get("sendLine")             === "true";
  const targetStaffId  = String(formData.get("targetStaffId") ?? "").trim() || null;
  // "YYYY-MM-DDTHH:MM" (datetime-local の値、JST) または空文字
  const customDateRaw  = String(formData.get("customDate")    ?? "").trim();

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

  const { error } = await supabase.from("notices").insert({
    project_id:      projectId,
    title,
    body,
    is_pinned:       isPinned,
    posted_by:       staffId,
    target_staff_id: targetStaffId,
    created_at:      createdAt,
  });

  if (error) return { success: false, message: "投稿失敗：" + error.message };

  revalidatePath("/notices");
  revalidatePath("/notices/manage");
  revalidatePath("/dashboard");

  // LINE通知（sendLine=trueの場合のみ）
  if (sendLine) {
    const appUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app";
    void sendEventNotify(
      projectId,
      "announcement",
      { "タイトル": title, "本文": body },
      targetStaffId ?? undefined,
      { label: "周知事項を見る", url: `${appUrl}/notices` },
    );
  }

  return { success: true };
}

export async function updateNoticeAction(
  formData: FormData
): Promise<NoticeResult> {
  const id = String(formData.get("id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
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
  const { error } = await supabase.from("notices").delete().eq("id", id);
  if (error) return { success: false, message: "削除失敗：" + error.message };

  revalidatePath("/notices");
  revalidatePath("/notices/manage");
  revalidatePath("/dashboard");
  return { success: true };
}
