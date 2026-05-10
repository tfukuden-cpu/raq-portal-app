/**
 * Next.js のグローバルプロキシ（旧: middleware）
 * すべてのリクエスト前に実行される
 * Next.js 16 から middleware → proxy にリネーム
 */
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 以下を除くすべてのパスにマッチ:
     * - _next/static (静的ファイル)
     * - _next/image (画像最適化)
     * - favicon.ico, *.png, *.jpg, *.svg 等の静的アセット
     * - manifest.webmanifest (PWA マニフェスト)
     * - sw.js (Service Worker)
     * - icons/ (PWAアイコン)
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|icons/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
