/**
 * GET /api/auth/line?mode=login|link
 * LINE OAuthフローを開始する
 */
import { NextRequest, NextResponse } from "next/server";
import { getLineAuthUrl } from "@/lib/line";

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") ?? "login";

  // state = base64url({ nonce, mode })
  const nonce = crypto.randomUUID();
  const state = Buffer.from(JSON.stringify({ nonce, mode })).toString("base64url");

  const res = NextResponse.redirect(getLineAuthUrl(state));
  res.cookies.set("line_oauth_state", state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   600, // 10分
    path:     "/",
  });
  return res;
}
