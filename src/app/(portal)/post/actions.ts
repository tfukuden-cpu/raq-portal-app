"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";

export type PostResult = { success: boolean; message?: string };

export async function createPostAction(formData: FormData): Promise<PostResult> {
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { success: false, message: "本文を入力してください" };
  if (body.length > 2000) return { success: false, message: "2000文字以内で入力してください" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  const { error } = await supabase.from("posts").insert({
    project_id: projectId,
    staff_id: staffId,
    body,
  });

  if (error) return { success: false, message: "投稿失敗：" + error.message };
  revalidatePath("/post");
  return { success: true };
}

export async function deletePostAction(formData: FormData): Promise<PostResult> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();
  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) return { success: false, message: "削除失敗：" + error.message };

  revalidatePath("/post");
  return { success: true };
}
