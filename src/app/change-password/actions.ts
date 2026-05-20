/**
 * パスワード変更処理
 */
"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type ChangePasswordResult = {
  success: boolean;
  message?: string;
};

export async function changePasswordAction(
  formData: FormData
): Promise<ChangePasswordResult> {
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!newPassword || !confirmPassword) {
    return { success: false, message: "新しいパスワードを入力してください" };
  }

  if (newPassword.length < 6) {
    return { success: false, message: "パスワードは6文字以上にしてください" };
  }

  if (newPassword !== confirmPassword) {
    return { success: false, message: "確認用パスワードが一致しません" };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Supabase Auth でパスワード更新
  const { error: pwError } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (pwError) {
    return {
      success: false,
      message: "パスワード変更に失敗しました：" + pwError.message,
    };
  }

  // staffs.must_change_password を false に
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { error: updErr } = await supabase
    .from("staffs")
    .update({ must_change_password: false })
    .eq("id", staffId);

  if (updErr) {
    return {
      success: false,
      message: "ユーザー情報の更新に失敗しました：" + updErr.message,
    };
  }

  redirect("/dashboard");
}
