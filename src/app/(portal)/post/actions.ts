"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";

export type PostResult = { success: boolean; message?: string };

const BUCKET = "post-images";

/** バケットが存在しなければ作成（初回のみ） */
async function ensureBucket() {
  const admin = createAdminClient();
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.find(b => b.name === BUCKET)) {
    await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 10 * 1024 * 1024 });
  }
}

export async function createPostAction(formData: FormData): Promise<PostResult> {
  const body      = String(formData.get("body") ?? "").trim();
  const imageFile = formData.get("image") as File | null;

  if (!body && (!imageFile || imageFile.size === 0))
    return { success: false, message: "本文か画像を入力してください" };

  const supabase  = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "ログインしてください" };

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件が選択されていません" };

  // 画像アップロード
  let imageUrl: string | null = null;
  if (imageFile && imageFile.size > 0) {
    try {
      await ensureBucket();
      const admin = createAdminClient();
      const ext   = imageFile.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path  = `${projectId}/${staffId}_${Date.now()}.${ext}`;
      const buf   = await imageFile.arrayBuffer();

      const { error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(path, buf, { contentType: imageFile.type, upsert: false });

      if (!uploadError) {
        const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
        imageUrl = data.publicUrl;
      } else {
        console.error("[post] image upload error:", uploadError);
      }
    } catch (e) {
      console.error("[post] image upload exception:", e);
    }
  }

  const { error } = await supabase.from("posts").insert({
    project_id: projectId,
    staff_id:   staffId,
    body:       body || null,
    image_url:  imageUrl,
  });

  if (error) return { success: false, message: "投稿失敗：" + error.message };
  revalidatePath("/post");
  return { success: true };
}

export async function deletePostAction(formData: FormData): Promise<PostResult> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { success: false, message: "IDが必要です" };

  const supabase = await createClient();

  // 画像も削除
  const { data: post } = await supabase.from("posts").select("image_url").eq("id", id).maybeSingle();
  if (post?.image_url) {
    try {
      const admin = createAdminClient();
      const url   = new URL(post.image_url);
      const path  = url.pathname.split(`/${BUCKET}/`)[1];
      if (path) await admin.storage.from(BUCKET).remove([path]);
    } catch { /* ignore */ }
  }

  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) return { success: false, message: "削除失敗：" + error.message };

  revalidatePath("/post");
  return { success: true };
}
