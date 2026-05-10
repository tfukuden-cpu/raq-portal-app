/**
 * ログイン処理（サーバーアクション）
 * 社員IDとパスワードを受け取り、Supabase Authでサインイン
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { clearCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";

const EMAIL_DOMAIN = "raq.internal";

export type LoginResult = {
  success: boolean;
  message?: string;
};

export async function loginAction(formData: FormData): Promise<LoginResult> {
  const staffId = String(formData.get("staffId") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!staffId || !password) {
    return { success: false, message: "社員IDとパスワードを入力してください" };
  }

  // 社員ID → 内部メアドへ変換（小文字化必須）
  const email = `${staffId.toLowerCase()}@${EMAIL_DOMAIN}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return {
      success: false,
      message: "社員IDまたはパスワードが違います",
    };
  }

  // 社員マスタの存在確認
  const { data: staff } = await supabase
    .from("staffs")
    .select("id, is_active")
    .eq("id", staffId.toUpperCase())
    .maybeSingle();

  if (!staff || !staff.is_active) {
    await supabase.auth.signOut();
    return {
      success: false,
      message: "社員マスタに登録がない、または無効化されています",
    };
  }

  // LINE未連携なら連携フローへ
  const { data: staffDetail } = await supabase
    .from("staffs")
    .select("line_user_id")
    .eq("id", staffId.toUpperCase())
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
