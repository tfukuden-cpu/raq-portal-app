"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

const INITIAL_PASSWORD = "1234";
const EMAIL_DOMAIN = "raq.internal";

export type OperatorResult = { success: boolean; message?: string };

/** 次の運用者IDを生成（O001, O002, ...） */
async function generateOperatorId(): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("staffs")
    .select("id")
    .eq("global_role", "executive")
    .order("id", { ascending: false });

  const nums = (data ?? [])
    .map((s) => parseInt(s.id.replace(/^O/, ""), 10))
    .filter((n) => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `O${String(next).padStart(3, "0")}`;
}

/** 権限チェック */
async function requireExecutive() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: s } = await supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  if (s?.global_role !== "executive") return null;
  return { supabase, staffId };
}

/** 運用者アカウント作成 */
export async function createOperatorAction(fd: FormData): Promise<OperatorResult> {
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { success: false, message: "氏名を入力してください" };

  const ctx = await requireExecutive();
  if (!ctx) return { success: false, message: "権限がありません" };

  const id = await generateOperatorId();
  const email = `${id.toLowerCase()}@${EMAIL_DOMAIN}`;
  const admin = createAdminClient();

  // Auth ユーザー作成
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: INITIAL_PASSWORD,
    email_confirm: true,
  });
  if (authError || !authData.user) {
    return { success: false, message: "認証ユーザーの作成に失敗しました: " + authError?.message };
  }

  // staffs テーブルに登録
  const { error } = await admin.from("staffs").insert({
    id,
    auth_user_id: authData.user.id,
    name,
    display_name: name,
    global_role: "executive",
    must_change_password: true,
    is_active: true,
  });
  if (error) {
    await admin.auth.admin.deleteUser(authData.user.id);
    return { success: false, message: "登録失敗: " + error.message };
  }

  revalidatePath("/admin/operators");
  return { success: true, message: `${id} を作成しました` };
}

/** 氏名変更 */
export async function updateOperatorNameAction(fd: FormData): Promise<OperatorResult> {
  const id = String(fd.get("id") ?? "").trim();
  const name = String(fd.get("name") ?? "").trim();
  if (!id || !name) return { success: false, message: "入力が不正です" };

  const ctx = await requireExecutive();
  if (!ctx) return { success: false, message: "権限がありません" };

  const admin = createAdminClient();
  const { error } = await admin.from("staffs").update({ name, display_name: name }).eq("id", id);
  if (error) return { success: false, message: "更新失敗: " + error.message };

  revalidatePath("/admin/operators");
  return { success: true, message: "更新しました" };
}

/** 有効/無効切替 */
export async function toggleOperatorActiveAction(fd: FormData): Promise<OperatorResult> {
  const id = String(fd.get("id") ?? "").trim();
  const isActive = fd.get("is_active") === "true";

  const ctx = await requireExecutive();
  if (!ctx) return { success: false, message: "権限がありません" };

  // 自分自身は無効化できない
  if (id === ctx.staffId) return { success: false, message: "自分自身は無効化できません" };

  const admin = createAdminClient();
  const { error } = await admin.from("staffs").update({ is_active: isActive }).eq("id", id);
  if (error) return { success: false, message: "更新失敗: " + error.message };

  revalidatePath("/admin/operators");
  return { success: true };
}

/** パスワードリセット（初期パスワードに戻す） */
export async function resetOperatorPasswordAction(fd: FormData): Promise<OperatorResult> {
  const id = String(fd.get("id") ?? "").trim();

  const ctx = await requireExecutive();
  if (!ctx) return { success: false, message: "権限がありません" };

  const admin = createAdminClient();
  const { data: staff } = await admin.from("staffs").select("auth_user_id").eq("id", id).maybeSingle();
  if (!staff?.auth_user_id) return { success: false, message: "ユーザーが見つかりません" };

  const { error } = await admin.auth.admin.updateUserById(staff.auth_user_id, {
    password: INITIAL_PASSWORD,
  });
  if (error) return { success: false, message: "リセット失敗: " + error.message };

  await admin.from("staffs").update({ must_change_password: true }).eq("id", id);
  revalidatePath("/admin/operators");
  return { success: true, message: "パスワードをリセットしました" };
}
