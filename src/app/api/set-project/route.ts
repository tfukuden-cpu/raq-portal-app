/**
 * プロジェクト選択クッキーをセットして指定先にリダイレクトする Route Handler
 * Server Component 内では cookies().set() が使えないため、この Route を経由する
 *
 * GET /api/set-project?id=P001&next=/dashboard
 */
import { NextRequest, NextResponse } from "next/server";
import { setCurrentProjectId } from "@/lib/project-context";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id   = searchParams.get("id");
  const next = searchParams.get("next") ?? "/dashboard";

  if (id) {
    await setCurrentProjectId(id);
  }

  // 同オリジンへのリダイレクトのみ許可（オープンリダイレクト対策）
  const safeNext = next.startsWith("/") ? next : "/dashboard";
  return NextResponse.redirect(new URL(safeNext, req.url));
}
