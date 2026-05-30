/**
 * 運用者管理ページ
 * 運用者（executive）アカウントの一覧・追加・編集
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import OperatorsClient from "./OperatorsClient";

export default async function OperatorsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: myStaff } = await supabase
    .from("staffs").select("global_role").eq("id", staffId).maybeSingle();

  if (myStaff?.global_role !== "executive") redirect("/dashboard");

  const admin = createAdminClient();
  const { data: operators } = await admin
    .from("staffs")
    .select("id, name, display_name, is_active, must_change_password")
    .eq("global_role", "executive")
    .order("id");

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">運用者管理</h1>
          <p className="text-sm font-semibold text-zinc-400 mt-0.5">代表・役員アカウントの管理</p>
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-10">
        <OperatorsClient
          operators={operators ?? []}
          currentStaffId={staffId}
        />
      </div>
    </main>
  );
}

