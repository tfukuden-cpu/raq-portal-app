/**
 * ログイン処理（サーバーアクション）
 * 氏名 + パスワードで認証（氏名からスタッフIDを逆引き）
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";

const EMAIL_DOMAIN = "raq.internal";

export type LoginResult = {
  success: boolean;
  message?: string;
};

export async function loginAction(formData: FormData): Promise<LoginResult> {
  const nameInput = String(formData.get("name") ?? "").trim();
  const password  = String(formData.get("password") ?? "");

  if (!nameInput || !password) {
    return { success: false, message: "氏名とパスワードを入力してください" };
  }

  // 氏名でスタッフを逆引き（display_name → name の順に一致を確認）
  const admin = createAdminClient();
  const [{ data: byDisplay }, { data: byName }] = await Promise.all([
    admin.from("staffs").select("id, is_active").eq("display_name", nameInput),
    admin.from("staffs").select("id, is_active").eq("name",         nameInput),
  ]);

  // 重複排除してアクティブなスタッフのみ抽出
  const merged = new Map([
    ...((byDisplay ?? []).map(s => [s.id, s]) as [string, { id: string; is_active: boolean }][]),
    ...((byName    ?? []).map(s => [s.id, s]) as [string, { id: string; is_active: boolean }][]),
  ]);
  const activeStaff = [...merged.values()].filter(s => s.is_active);

  if (activeStaff.length === 0) {
    return { success: false, message: "氏名に一致するアカウントが見つかりません" };
  }
  if (activeStaff.length > 1) {
    return { success: false, message: "同名のアカウントが複数存在します。管理者にお問い合わせください" };
  }

  const staffId = activeStaff[0].id;
  const email   = `${staffId.toLowerCase()}@${EMAIL_DOMAIN}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { success: false, message: "パスワードが違います" };
  }

  // LINE未連携なら連携フローへ
  const { data: staffDetail } = await supabase
    .from("staffs")
    .select("line_user_id")
    .eq("id", staffId)
    .maybeSingle();

  if (!staffDetail?.line_user_id) {
    redirect("/api/auth/line?mode=link");
  }

  redirect("/dashboard");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await clearCurrentProjectId();
  redirect("/login");
}
