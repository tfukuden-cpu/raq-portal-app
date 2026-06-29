/**
 * 「管理者ビューを出すか」をレイアウトの viewMode 決定ロジックと完全に揃えて判定する。
 *
 * - executive / global admin … 視点切替を持たない＝常に管理者ビュー
 * - project_admin            … Cookie `rqp-view-mode`（既定 admin）に従う。staff のときだけ非管理
 * - それ以外（一般スタッフ）  … 常に非管理
 *
 * /messages（受信箱）と /messages/manage（管理）で同じ判定を使い、
 * 相互リダイレクトのループを防ぐ。
 */
import { cookies } from "next/headers";
import type { createClient } from "@/lib/supabase/server";

export async function isAdminView(
  supabase: Awaited<ReturnType<typeof createClient>>,
  staffId: string,
  projectId: string,
): Promise<boolean> {
  const [{ data: staff }, { data: member }] = await Promise.all([
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
    supabase.from("project_members").select("role")
      .eq("project_id", projectId).eq("staff_id", staffId).maybeSingle(),
  ]);

  const isExecutive   = staff?.global_role === "executive";
  const isGlobalAdmin = staff?.global_role === "admin";
  const isProjectAdmin = member?.role === "project_admin";

  // 運営者・全社管理者は視点切替が無く常に管理者ビュー
  if (isExecutive || isGlobalAdmin) return true;

  // 案件管理者は Cookie に従う（既定 admin。staff のときだけ受信箱）
  if (isProjectAdmin) {
    const vm = (await cookies()).get("rqp-view-mode")?.value;
    return vm !== "staff";
  }

  return false;
}
