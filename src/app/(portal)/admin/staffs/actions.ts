"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function adminSupa() {
  return createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function assertExecutive() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: s } = await supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  if (s?.global_role !== "executive") redirect("/dashboard");
}

export async function toggleStaffActiveAction(
  fd: FormData
): Promise<{ success: boolean; message?: string }> {
  const id       = String(fd.get("id")        ?? "").trim().toUpperCase();
  const isActive = fd.get("is_active") === "true";

  await assertExecutive();

  const { error } = await adminSupa()
    .from("staffs")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) return { success: false, message: error.message };

  revalidatePath("/admin/staffs");
  return { success: true };
}

export async function updateStaffInfoAction(
  fd: FormData
): Promise<{ success: boolean; message?: string }> {
  const id          = String(fd.get("id")           ?? "").trim().toUpperCase();
  const name        = String(fd.get("name")         ?? "").trim();
  const companyName = String(fd.get("company_name") ?? "").trim() || null;

  await assertExecutive();

  const { error } = await adminSupa()
    .from("staffs")
    .update({ name, display_name: name, company_name: companyName })
    .eq("id", id);

  if (error) return { success: false, message: error.message };

  revalidatePath("/admin/staffs");
  return { success: true, message: "更新しました" };
}

export async function resetStaffPasswordAction(
  fd: FormData
): Promise<{ success: boolean; message?: string }> {
  const id = String(fd.get("id") ?? "").trim().toUpperCase();

  await assertExecutive();

  const admin = adminSupa();
  const { data: staff } = await admin
    .from("staffs")
    .select("auth_user_id")
    .eq("id", id)
    .maybeSingle();

  if (!staff?.auth_user_id) return { success: false, message: "ユーザーが見つかりません" };

  const { error } = await admin.auth.admin.updateUserById(staff.auth_user_id, {
    password: "1234",
  });
  if (error) return { success: false, message: error.message };

  await admin.from("staffs").update({ must_change_password: true }).eq("id", id);

  revalidatePath("/admin/staffs");
  return { success: true, message: "PW を 1234 にリセットしました" };
}
