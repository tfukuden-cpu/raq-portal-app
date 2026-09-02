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
  if (!projectId) redirect("/login");

  const { data: inquiries } = await supabase
    .from("inquiries")
    .select("id, title, body, status, reply, replied_at, created_at")
    .eq("project_id", projectId)
    .eq("staff_id", staffId)
    .order("created_at", { ascending: false });

  return <InquiryClient inquiries={inquiries ?? []} />;
}

