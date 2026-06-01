/**
 * ヘルプページ
 */
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import HelpClient from "./HelpClient";

export default async function HelpPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <HelpClient />;
}
