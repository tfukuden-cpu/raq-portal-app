/**
 * POST /api/line/webhook
 * LINE Messaging API のWebhookエンドポイント
 * ボットがグループに追加/退出したときにgroup_idを記録する
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET ?? "";
  const hash = crypto
    .createHmac("SHA256", secret)
    .update(body)
    .digest("base64");
  return hash === signature;
}

type LineEvent = {
  type: string;
  source?: {
    type: string;
    userId?: string;
    groupId?: string;
  };
  postback?: {
    data: string;
  };
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as { events: LineEvent[] };
  const admin = createAdminClient();

  for (const event of body.events ?? []) {
    const userId  = event.source?.userId;
    const groupId = event.source?.groupId;

    // ── 通知テスト受信確認ボタン（postback） ──
    if (event.type === "postback" && userId && event.postback?.data?.startsWith("line_test_confirm:")) {
      const projectId = event.postback.data.slice("line_test_confirm:".length);
      if (projectId) {
        // line_user_id → staff_id を検索
        const { data: staff } = await admin
          .from("staffs")
          .select("id")
          .eq("line_user_id", userId)
          .maybeSingle();
        if (staff?.id) {
          await admin
            .from("line_test_confirmations")
            .upsert(
              { project_id: projectId, staff_id: staff.id, confirmed_at: new Date().toISOString() },
              { onConflict: "project_id,staff_id" },
            );
        }
      }
    }

    // ── ブロック/フォロー解除 → line_blocked フラグ管理 ──
    if (event.type === "unfollow" && userId) {
      await admin
        .from("staffs")
        .update({ line_blocked: true })
        .eq("line_user_id", userId);
    }

    if (event.type === "follow" && userId) {
      await admin
        .from("staffs")
        .update({ line_blocked: false })
        .eq("line_user_id", userId);
    }

    // ── グループ参加/退出 ──
    if (!groupId || event.source?.type !== "group") continue;

    if (event.type === "join") {
      await admin.from("line_groups").upsert(
        { group_id: groupId, joined_at: new Date().toISOString() },
        { onConflict: "group_id" }
      );
    } else if (event.type === "leave") {
      await admin.from("line_groups").delete().eq("group_id", groupId);
    }
  }

  return NextResponse.json({ ok: true });
}
