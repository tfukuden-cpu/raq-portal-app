"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

/** ユーザーが友達追加を確認したときに line_friend=true をセットする */
export async function confirmLineFriendAction(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const admin = createAdminClient();

  await admin
    .from("staffs")
    .update({ line_friend: true })
    .eq("id", staffId);

  revalidatePath("/", "layout");
}
