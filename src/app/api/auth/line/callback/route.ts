/**
 * GET /api/auth/line/callback
 * LINE OAuthコールバック処理
 * mode=login → line_user_id でスタッフ検索 → magic linkでセッション生成
 * mode=link  → ログイン中のスタッフに line_user_id を紐付け
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchLineProfile } from "@/lib/line";

function adminClient() {
  return createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function loginErrRedirect(req: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
}
function linkErrRedirect(req: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`/link-line?error=${code}`, req.url));
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state");

  // キャンセルまたはエラー
  if (searchParams.get("error") || !code || !state) {
    return loginErrRedirect(req, "line_cancelled");
  }

  // state 検証（CSRF対策）
  const storedState = req.cookies.get("line_oauth_state")?.value;
  if (!storedState || storedState !== state) {
    return loginErrRedirect(req, "line_state_mismatch");
  }

  // state をパース
  let parsedState: { nonce: string; mode: string };
  try {
    parsedState = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    return loginErrRedirect(req, "line_state_invalid");
  }

  const clearState = (res: NextResponse) => {
    res.cookies.delete("line_oauth_state");
    return res;
  };

  // LINEプロフィール取得
  const profile = await fetchLineProfile(code);
  if (!profile) {
    // mode=link のエラーは /link-line に戻す（ログイン画面ではなく）
    if (parsedState.mode === "link") {
      return clearState(linkErrRedirect(req, "line_failed"));
    }
    return loginErrRedirect(req, "line_failed");
  }

  // ── 連携モード（ログイン済みユーザーが LINE を紐付け）────
  if (parsedState.mode === "link") {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    // セッション切れ → 再ログイン後に /link-line へ
    if (!user) {
      return clearState(NextResponse.redirect(new URL("/login?next=/link-line", req.url)));
    }

    const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
    const admin   = adminClient();

    // 他スタッフに既に紐付いていないか確認
    const { data: conflict } = await admin
      .from("staffs")
      .select("id")
      .eq("line_user_id", profile.userId)
      .neq("id", staffId)
      .maybeSingle();

    if (conflict) {
      return clearState(linkErrRedirect(req, "line_already_used"));
    }

    await admin
      .from("staffs")
      .update({ line_user_id: profile.userId, line_friend: true })
      .eq("id", staffId);

    // LINE連携完了後はパスワードをランダム値に変更（なりすまし防止）
    await admin.auth.admin.updateUserById(user.id, {
      password: crypto.randomUUID() + crypto.randomUUID(),
    });

    return clearState(NextResponse.redirect(new URL("/dashboard", req.url)));
  }

  // ── ログインモード（LINE ID でスタッフ検索 → magic link）──
  const admin = adminClient();

  const { data: staff } = await admin
    .from("staffs")
    .select("id")
    .eq("line_user_id", profile.userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!staff) {
    return clearState(loginErrRedirect(req, "line_not_registered"));
  }

  // magic link 生成（パスワード不要でセッションを確立）
  const email = `${staff.id.toLowerCase()}@raq.internal`;
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type:        "magiclink",
    email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app"}/auth/confirm`,
    },
  });

  if (linkError || !linkData?.properties?.action_link) {
    console.error("magic link error:", linkError);
    return clearState(loginErrRedirect(req, "line_auth_failed"));
  }

  return clearState(NextResponse.redirect(linkData.properties.action_link));
}
