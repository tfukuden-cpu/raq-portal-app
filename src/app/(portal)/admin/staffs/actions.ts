"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { syncMembersSheet, extractSpreadsheetId, isGSheetsConfigured } from "@/lib/gsheets";

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
  const globalRole  = String(fd.get("global_role")  ?? "staff");

  await assertExecutive();

  const admin = adminSupa();

  const { error } = await admin
    .from("staffs")
    .update({ name, display_name: name, company_name: companyName, global_role: globalRole })
    .eq("id", id);

  if (error) return { success: false, message: error.message };

  // スプシが設定されている場合、所属案件のメンバーシートを同期
  if (isGSheetsConfigured()) {
    try {
      // このスタッフが所属するアクティブ案件を取得
      const { data: memberships } = await admin
        .from("project_members")
        .select("project_id")
        .eq("staff_id", id);

      const projectIds = (memberships ?? []).map(m => m.project_id);

      for (const projectId of projectIds) {
        const { data: settings } = await admin
          .from("project_settings").select("sheet_url").eq("project_id", projectId).maybeSingle();
        if (!settings?.sheet_url) continue;

        // そのプロジェクトの全メンバーを取得
        const { data: members } = await admin
          .from("project_members")
          .select("staff_id, role, staffs(name, display_name, company_name)")
          .eq("project_id", projectId)
          .order("staff_id");

        const memberList = (members ?? []).map(m => {
          const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
            { name: string | null; display_name: string | null; company_name: string | null } | null;
          return {
            id:          m.staff_id,
            displayName: s?.display_name?.trim() || s?.name?.trim() || m.staff_id,
            companyName: (s?.company_name?.trim() || null) as string | null,
            role:        m.role ?? "staff",
          };
        });

        await syncMembersSheet(extractSpreadsheetId(settings.sheet_url), memberList);
      }
    } catch { /* スプシ同期失敗は無視 */ }
  }

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
