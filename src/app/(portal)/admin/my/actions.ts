"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AvatarConfig } from "./avatar-types";

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const VALID_BG         = ["sky","mint","rose","lemon","lavender","peach","coral","slate"] as const;
const VALID_HAIR_COLOR = ["black","brown","camel","blonde","red","orange","pink","silver","blue","purple","white","green"] as const;

export async function updateAvatarConfigAction(fd: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  let config: AvatarConfig;
  try {
    config = JSON.parse(String(fd.get("config") ?? "{}")) as AvatarConfig;
  } catch {
    return;
  }

  // Validate every field before writing to DB
  if (
    !VALID_BG.includes(config.bg as typeof VALID_BG[number]) ||
    typeof config.skin       !== "number" || config.skin       < 0 || config.skin       > 4 ||
    typeof config.hair_style !== "number" || config.hair_style < 0 || config.hair_style > 4 ||
    !VALID_HAIR_COLOR.includes(config.hair_color as typeof VALID_HAIR_COLOR[number]) ||
    typeof config.eyes       !== "number" || config.eyes       < 0 || config.eyes       > 4 ||
    typeof config.mouth      !== "number" || config.mouth      < 0 || config.mouth      > 3 ||
    typeof config.cheeks     !== "boolean"
  ) return;

  await admin().from("staffs").update({ avatar_config: config }).eq("id", staffId);
  revalidatePath("/admin/my");
}
