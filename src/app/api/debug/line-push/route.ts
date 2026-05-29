/**
 * LINE push 疎通確認エンドポイント（開発・デバッグ用）
 *
 * GET /api/debug/line-push?staffId=S001
 *
 * - CRON_SECRET ヘッダーで保護
 * - staffs テーブルから line_user_id を引いて実際に push する
 * - レスポンスに詳細な診断情報を返す
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const LINE_API = "https://api.line.me";

export async function GET(req: NextRequest) {
  // 認証
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const staffId = req.nextUrl.searchParams.get("staffId");
  if (!staffId) {
    return NextResponse.json({ error: "staffId パラメータが必要です" }, { status: 400 });
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  // ── 診断情報を収集 ─────────────────────────────────────────
  const diag: Record<string, unknown> = {
    LINE_CHANNEL_ACCESS_TOKEN_set: !!token,
    LINE_CHANNEL_ACCESS_TOKEN_prefix: token ? token.slice(0, 10) + "..." : null,
  };

  if (!token) {
    return NextResponse.json({ ok: false, diag, error: "LINE_CHANNEL_ACCESS_TOKEN が未設定" });
  }

  // staffs テーブルから line_user_id を取得
  const admin = createAdminClient();
  const { data: staff, error: dbErr } = await admin
    .from("staffs")
    .select("id, name, display_name, line_user_id")
    .eq("id", staffId.toUpperCase())
    .maybeSingle();

  diag.staffFound = !!staff;
  diag.staffName  = staff?.display_name ?? staff?.name ?? null;
  diag.lineUserId = staff?.line_user_id
    ? staff.line_user_id.slice(0, 8) + "..."   // 先頭だけ表示（セキュリティ）
    : null;

  if (dbErr) {
    return NextResponse.json({ ok: false, diag, error: `DB エラー: ${dbErr.message}` });
  }
  if (!staff) {
    return NextResponse.json({ ok: false, diag, error: `スタッフ ${staffId} が見つかりません` });
  }
  if (!staff.line_user_id) {
    return NextResponse.json({ ok: false, diag, error: `${staffId} の line_user_id が未登録（LINE未連携）` });
  }

  // LINE push を実行
  const res = await fetch(`${LINE_API}/v2/bot/message/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: staff.line_user_id,
      messages: [{ type: "text", text: "【テスト】Raqポータルからの疎通確認メッセージです ✓" }],
    }),
  });

  const responseBody = await res.text().catch(() => "");

  diag.lineApiStatus = res.status;
  diag.lineApiBody   = responseBody;

  if (res.ok) {
    return NextResponse.json({
      ok: true,
      diag,
      message: `${staff.display_name ?? staff.name} さんに送信しました`,
    });
  } else {
    return NextResponse.json({
      ok: false,
      diag,
      error: `LINE API エラー: ${res.status} — ${responseBody}`,
    });
  }
}
