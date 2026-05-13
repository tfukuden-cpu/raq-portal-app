/**
 * 運用者用：案件コンテキストを切り替えてリダイレクト
 * GET /admin/ops/switch/{projectId}?redirect=/shifts/manage
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setCurrentProjectId } from "@/lib/project-context";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { data: staff } = await supabase
    .from("staffs").select("global_role").eq("id", staffId).maybeSingle();

  // 運用者 (executive) のみ許可
  if (staff?.global_role !== "executive") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  await setCurrentProjectId(projectId);

  const redirectTo = request.nextUrl.searchParams.get("redirect") ?? "/shifts/manage";
  return NextResponse.redirect(new URL(redirectTo, request.url));
}
