"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function assertAdmin(projectId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const [{ data: membership }, { data: staff }] = await Promise.all([
    supabase.from("project_members").select("role").eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);
  const isAdmin =
    membership?.role === "project_admin" ||
    staff?.global_role === "admin" ||
    staff?.global_role === "executive";
  if (!isAdmin) throw new Error("Forbidden");
}

export type MotaAssignment = {
  id: string;
  accountNumber: string;   // ポジションキー（行の番号）
  staffName: string;       // 配置されたスタッフの表示名
  assignedAccount: string | null; // 配置スタッフのアカウント番号（座席表連携用）
  slot: string;
  isFixed: boolean;
};

export async function fetchMotaAssignmentsAction(
  projectId: string,
  date: string,
): Promise<MotaAssignment[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("mota_slot_assignments")
    .select("id, account_number, slot, is_fixed, staff_name, assigned_account")
    .eq("project_id", projectId)
    .eq("assignment_date", date);
  return (data ?? []).map(r => ({
    id: r.id as string,
    accountNumber: r.account_number as string,
    staffName: (r.staff_name as string) ?? "",
    assignedAccount: (r.assigned_account as string | null) ?? null,
    slot: r.slot as string,
    isFixed: (r.is_fixed as boolean) ?? false,
  }));
}

export async function addMotaAssignmentAction(
  projectId: string,
  date: string,
  accountNumber: string,
  slot: string,
  isFixed: boolean,
  staffName: string,
  assignedAccount: string | null,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    await assertAdmin(projectId);
    const admin = createAdminClient();

    // 既存エントリを削除してから再挿入（同一スロットへの上書きを許容）
    await admin
      .from("mota_slot_assignments")
      .delete()
      .eq("project_id", projectId)
      .eq("assignment_date", date)
      .eq("account_number", accountNumber)
      .eq("slot", slot);

    const { data, error } = await admin
      .from("mota_slot_assignments")
      .insert({
        project_id: projectId,
        assignment_date: date,
        account_number: accountNumber,
        slot,
        is_fixed: isFixed,
        staff_name: staffName,
        assigned_account: assignedAccount,
      })
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id as string };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function removeMotaAssignmentAction(
  projectId: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertAdmin(projectId);
    const admin = createAdminClient();
    const { error } = await admin
      .from("mota_slot_assignments")
      .delete()
      .eq("id", id)
      .eq("project_id", projectId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
