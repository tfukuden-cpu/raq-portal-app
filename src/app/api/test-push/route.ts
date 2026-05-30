/**
 * テスト通知送信 API（動作確認後に削除）
 * GET /api/test-push?staffId=S002
 * Authorization: Bearer <CRON_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushLine } from "@/lib/line";
import { pushWebToStaff } from "@/lib/webpush";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const staffId = req.nextUrl.searchParams.get("staffId") ?? "S002";
  const admin = createAdminClient();

  const { data: staff } = await admin
    .from("staffs")
    .select("id, name, display_name, line_user_id")
    .eq("id", staffId)
    .maybeSingle();

  if (!staff) return NextResponse.json({ error: "staff not found" }, { status: 404 });

  const name = staff.display_name ?? staff.name ?? staffId;
  const results: Record<string, string> = {};

  // LINE テスト送信
  if (staff.line_user_id) {
    try {
      await pushLine(staff.line_user_id, `【テスト通知】\n${name}さん、テスト送信です。LINEは正常に届いています。`);
      results.line = "OK";
    } catch (e) {
      results.line = String(e);
    }
  } else {
    results.line = "LINE ID なし";
  }

  // Web Push テスト送信
  try {
    await pushWebToStaff(staffId, {
      title: "テスト通知",
      body: `${name}さん、プッシュ通知のテストです。正常に届いています。`,
      url: "/dashboard",
    });
    results.webpush = "OK";
  } catch (e) {
    results.webpush = String(e);
  }

  return NextResponse.json({ staffId, name, results });
}
