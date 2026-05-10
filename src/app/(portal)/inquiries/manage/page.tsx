import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { InquiryManageClient } from "./InquiryManageClient";

export default async function InquiryManagePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const { data: membership } = await supabase
    .from("project_members").select("role")
    .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
  const { data: staff } = await supabase
    .from("staffs").select("global_role").eq("id", staffId).maybeSingle();

  const isAdmin = membership?.role === "project_admin"
    || staff?.global_role === "admin"
    || staff?.global_role === "executive";
  if (!isAdmin) redirect("/dashboard");

  const { data: inquiries } = await createAdminClient()
    .from("inquiries")
    .select("id, title, body, status, reply, replied_by, replied_at, created_at, staff_id, staffs(display_name, name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const list = (inquiries ?? []).map(inq => {
    const s = (Array.isArray(inq.staffs) ? inq.staffs[0] : inq.staffs) as
      { display_name: string | null; name: string | null } | null;
    return {
      id:          inq.id,
      staffName:   s?.display_name ?? s?.name ?? inq.staff_id,
      title:       inq.title,
      body:        inq.body,
      status:      inq.status,
      reply:       inq.reply ?? null,
      replied_at:  inq.replied_at ?? null,
      created_at:  inq.created_at,
    };
  });

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-black">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-24">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-6">問い合わせ管理</h1>
        <InquiryManageClient inquiries={list} />
      </div>
    </main>
  );
}
