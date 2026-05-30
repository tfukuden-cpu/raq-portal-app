/**
 * テスト通知送信 API（動作確認後に削除）
 * GET /api/test-push?staffId=S002
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import webpush from "web-push";

export async function GET(req: NextRequest) {
  const staffId = req.nextUrl.searchParams.get("staffId") ?? "S002";
  const admin = createAdminClient();

  const results: Record<string, unknown> = {};

  // 環境変数チェック
  results.env = {
    LINE_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN ? `SET (${process.env.LINE_CHANNEL_ACCESS_TOKEN.slice(0, 10)}...)` : "MISSING",
    VAPID_PUBLIC: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ? `SET (${process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY.slice(0, 10)}...)` : "MISSING",
    VAPID_PRIVATE: process.env.VAPID_PRIVATE_KEY ? `SET (${process.env.VAPID_PRIVATE_KEY.slice(0, 10)}...)` : "MISSING",
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "SET" : "MISSING",
  };

  // スタッフ情報
  const { data: staff, error: staffErr } = await admin
    .from("staffs")
    .select("id, name, display_name, line_user_id")
    .eq("id", staffId)
    .maybeSingle();

  if (staffErr || !staff) {
    return NextResponse.json({ error: "staff not found", staffErr }, { status: 404 });
  }

  const name = staff.display_name ?? staff.name ?? staffId;
  results.staff = { id: staff.id, name, line_user_id: staff.line_user_id };

  // Push subscriptions
  const { data: subs, error: subsErr } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key, created_at")
    .eq("staff_id", staffId);
  results.push_subscriptions = { count: subs?.length ?? 0, error: subsErr, endpoints: subs?.map(s => s.endpoint.slice(0, 60) + "...") };

  // LINE テスト送信（生レスポンス取得）
  if (staff.line_user_id) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      results.line = { status: "ERROR", message: "LINE_CHANNEL_ACCESS_TOKEN が未設定" };
    } else {
      const res = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          to: staff.line_user_id,
          messages: [{ type: "text", text: `【テスト通知】\n${name}さん、テスト送信です。LINEは正常に届いています。` }],
        }),
      });
      const body = await res.text().catch(() => "");
      results.line = { status: res.status, statusText: res.statusText, body };
    }
  } else {
    results.line = { status: "SKIP", message: "LINE ID なし" };
  }

  // Web Push テスト送信（エラー詳細取得）
  if (!subs?.length) {
    results.webpush = { status: "SKIP", message: "購読なし" };
  } else {
    const sub = subs[0];
    try {
      webpush.setVapidDetails(
        "mailto:admin@raq.internal",
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
        process.env.VAPID_PRIVATE_KEY!
      );
      const pushRes = await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        JSON.stringify({ title: "テスト通知", body: `${name}さん、プッシュ通知のテストです。`, url: "/dashboard" })
      );
      results.webpush = { status: pushRes.statusCode, message: "OK" };
    } catch (err: unknown) {
      const e = err as { statusCode?: number; body?: string; message?: string };
      results.webpush = { status: "ERROR", statusCode: e.statusCode, body: e.body, message: e.message };
    }
  }

  return NextResponse.json({ staffId, name, results });
}
