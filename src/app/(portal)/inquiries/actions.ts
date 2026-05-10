"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";
import { sendEventNotify } from "@/lib/notify";

export type InquiryResult = { success: boolean; message?: string };

export async function submitInquiryAction(fd: FormData): Promise<InquiryResult> {
  const title = String(fd.get("title") ?? "").trim();
  const body  = String(fd.get("body")  ?? "").trim();
  if (!title || !body) return { success: false, message: "件名と内容は必須です" };

  const supabase  = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const { data: staff } = await supabase
    .from("staffs").select("display_name, name").eq("id", staffId).maybeSingle();
  const name = staff?.display_name ?? staff?.name ?? staffId;

  const { error } = await supabase.from("inquiries").insert({
    project_id: projectId,
    staff_id:   staffId,
    title,
    body,
  });
  if (error) return { success: false, message: "送信失敗：" + error.message };

  revalidatePath("/inquiries");

  await sendEventNotify(projectId, "inquiry", {
    名前: name,
    件名: title,
    内容: body.length > 80 ? body.slice(0, 80) + "…" : body,
  });

  return { success: true, message: "送信しました" };
}

export async function replyInquiryAction(fd: FormData): Promise<InquiryResult> {
  const id    = String(fd.get("id")    ?? "").trim();
  const reply = String(fd.get("reply") ?? "").trim();
  if (!id || !reply) return { success: false, message: "返信内容は必須です" };

  const supabase  = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: inquiry, error: fetchErr } = await supabase
    .from("inquiries")
    .select("project_id, staff_id, title, staffs(display_name, name)")
    .eq("id", id).maybeSingle();
  if (fetchErr || !inquiry) return { success: false, message: "問い合わせが見つかりません" };
  const s = (Array.isArray(inquiry.staffs) ? inquiry.staffs[0] : inquiry.staffs) as
    { display_name: string | null; name: string | null } | null;
  const staffName = s?.display_name ?? s?.name ?? inquiry.staff_id;

  const { error } = await supabase.from("inquiries").update({
    reply,
    replied_by: staffId,
    replied_at: new Date().toISOString(),
    status: "closed",
  }).eq("id", id);
  if (error) return { success: false, message: "返信失敗：" + error.message };

  revalidatePath("/inquiries");
  revalidatePath("/inquiries/manage");

  await sendEventNotify(inquiry.project_id, "inquiry_reply", {
    名前: staffName,
    件名: inquiry.title,
    返信: reply.length > 80 ? reply.slice(0, 80) + "…" : reply,
  }, inquiry.staff_id);

  return { success: true, message: "返信しました" };
}

export async function closeInquiryAction(fd: FormData): Promise<InquiryResult> {
  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();
  const { error } = await supabase.from("inquiries")
    .update({ status: "closed" }).eq("id", id);
  if (error) return { success: false, message: error.message };

  revalidatePath("/inquiries/manage");
  return { success: true };
}
