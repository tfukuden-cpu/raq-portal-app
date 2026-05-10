/**
 * Next.js middleware から呼び出すSupabaseヘルパー
 * セッションのCookieを毎リクエストで更新する
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // ユーザー情報を取得（Cookieリフレッシュのトリガー）
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 未ログインで /login と / 以外にアクセスしたら /login にリダイレクト
  const pathname = request.nextUrl.pathname;
  const isPublic =
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/public") ||
    pathname.startsWith("/api/auth/line") ||
    pathname.startsWith("/auth/confirm") ||
    pathname.startsWith("/api/line/webhook") ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/sw.") ||
    pathname === "/favicon.ico";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // ops モードのユーザーが /dashboard にアクセスしたら /admin にリダイレクト
  // 運用アカウントに打刻画面は不要
  if (user && pathname === "/dashboard") {
    const viewMode = request.cookies.get("rqp-view-mode")?.value;
    if (viewMode === "ops") {
      const url = request.nextUrl.clone();
      url.pathname = "/admin";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
