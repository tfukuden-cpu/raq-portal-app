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
    groupId?: string;
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
    const groupId = event.source?.groupId;
    if (!groupId || event.source?.type !== "group") continue;

    if (event.type === "join") {
      // グループに追加された → 記録
      await admin.from("line_groups").upsert(
        { group_id: groupId, joined_at: new Date().toISOString() },
        { onConflict: "group_id" }
      );
    } else if (event.type === "leave") {
      // グループから退出された → 削除
      await admin.from("line_groups").delete().eq("group_id", groupId);
    }
  }

  return NextResponse.json({ ok: true });
}
