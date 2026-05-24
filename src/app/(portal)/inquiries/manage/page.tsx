import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { InquiryManageClient } from "./InquiryManageClient";

export default async function InquiryManagePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: staff } = await supabase
    .from("staffs").select("global_role").eq("id", staffId).maybeSingle();

  const isExecutive = staff?.global_role === "executive" || staff?.global_role === "admin";
  const projectId   = await getCurrentProjectId();

  // 案件未選択かつ運営者でもない場合はプロジェクト選択へ
  if (!projectId && !isExecutive) redirect("/select-project");

  // 案件管理者チェック（案件が選択されている場合のみ）
  if (projectId && !isExecutive) {
    const { data: membership } = await supabase
      .from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
    if (membership?.role !== "project_admin") redirect("/dashboard");
  }

  const admin = createAdminClient();
  const SEL = "id, title, body, status, reply, replied_by, replied_at, created_at, staff_id, project_id";
  const { data: inquiries, error: qErr } = projectId
    ? await admin.from("inquiries").select(SEL).eq("project_id", projectId).order("created_at", { ascending: false })
    : await admin.from("inquiries").select(SEL).order("created_at", { ascending: false });
  if (qErr) console.error("[inquiries/manage] query error:", qErr);

  // staff名を別途取得
  const staffIds = [...new Set((inquiries ?? []).map(i => i.staff_id))];
  const { data: staffRows } = staffIds.length > 0
    ? await admin.from("staffs").select("id, display_name, name").in("id", staffIds)
    : { data: [] };
  const staffMap = new Map((staffRows ?? []).map(s => [s.id, s.display_name ?? s.name ?? s.id]));

  const list = (inquiries ?? []).map(inq => ({
    id:         inq.id,
    staffName:  staffMap.get(inq.staff_id) ?? inq.staff_id,
    title:      inq.title,
    body:       inq.body,
    status:     inq.status,
    reply:      inq.reply ?? null,
    replied_at: inq.replied_at ?? null,
    created_at: inq.created_at,
  }));

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-black">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-24">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-6">問い合わせ管理</h1>
        {!projectId && isExecutive && (
          <p className="text-xs text-zinc-400 mb-4">全案件の問い合わせを表示しています</p>
        )}
        <InquiryManageClient inquiries={list} />
      </div>
    </main>
  );
}

