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
    <main className="min-h-screen bg-white dark:bg-zinc-950">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">問い合わせ</h1>
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-24">
        <InquiryClient inquiries={inquiries ?? []} />
      </div>
    </main>
  );
}

