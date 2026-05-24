import { createClient } from "@/lib/supabase/server";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import { InquiryClient } from "./InquiryClient";

export default async function InquiriesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId   = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  const { data: inquiries } = await supabase
    .from("inquiries")
    .select("id, title, body, status, reply, replied_at, created_at")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-black">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-24">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-6">問い合わせ</h1>
        <InquiryClient inquiries={inquiries ?? []} />
      </div>
    </main>
  );
}

