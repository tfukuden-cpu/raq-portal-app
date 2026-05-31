import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import RankingsClient from "./RankingsClient";

export default async function RankingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  // 管理者チェック
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("staff_id", staffId)
    .eq("project_id", projectId)
    .maybeSingle();
  const { data: staff } = await supabase
    .from("staffs")
    .select("global_role")
    .eq("id", staffId)
    .maybeSingle();
  const isAdmin = membership?.role === "project_admin" ||
    staff?.global_role === "admin" || staff?.global_role === "executive";
  if (!isAdmin) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: rankings } = await admin
    .from("member_rankings")
    .select("rank_label, rank_order, staff_name, category, imported_at")
    .eq("project_id", projectId)
    .order("rank_order", { ascending: true });

  const sateiRankings  = (rankings ?? []).filter(r => r.category === "査定");
  const hanbaiRankings = (rankings ?? []).filter(r => r.category === "販売");
  const importedAt = rankings?.[0]?.imported_at ?? null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-2">
      <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">番付管理</h1>
      <p className="text-xs text-zinc-400 mb-4">ASS査定・ASS販売の番付をExcelからインポートします。</p>
      <RankingsClient
        sateiRankings={sateiRankings}
        hanbaiRankings={hanbaiRankings}
        importedAt={importedAt}
      />
    </div>
  );
}
