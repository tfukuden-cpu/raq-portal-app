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
  message?: {
    type: string;
    text?: string;
  };
  timestamp?: number;
};

export async function POST(req: NextRequest) {
  let rawBody = "";
  try {
    rawBody = await req.text();
    const signature = req.headers.get("x-line-signature") ?? "";

    // LINE_CHANNEL_SECRET が設定されている場合のみ署名検証（未設定は開発環境想定でスキップ）
    if (process.env.LINE_CHANNEL_SECRET && !verifySignature(rawBody, signature)) {
      console.error("[webhook] signature verification failed");
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(rawBody) as { events: LineEvent[] };
    const admin = createAdminClient();

    for (const event of body.events ?? []) {
      try {
        const userId  = event.source?.userId;
        const groupId = event.source?.groupId;

        // ── 通知テスト受信確認ボタン（postback） ──
        if (event.type === "postback" && userId && event.postback?.data?.startsWith("line_test_confirm:")) {
          const projectId = event.postback.data.slice("line_test_confirm:".length);
          console.log(`[webhook] line_test_confirm: projectId=${projectId} userId=${userId}`);

          if (projectId) {
            // line_user_id → staff_id を検索
            const { data: staff, error: staffErr } = await admin
              .from("staffs")
              .select("id")
              .eq("line_user_id", userId)
              .maybeSingle();

            if (staffErr) {
              console.error(`[webhook] staffs lookup error: ${staffErr.message}`);
            } else if (!staff?.id) {
              console.warn(`[webhook] staff not found for line_user_id=${userId}`);
            } else {
              console.log(`[webhook] confirming staff=${staff.id} for project=${projectId}`);
              const { error: upsertErr } = await admin
                .from("line_test_confirmations")
                .upsert(
                  { project_id: projectId, staff_id: staff.id, confirmed_at: new Date().toISOString() },
                  { onConflict: "project_id,staff_id" },
                );
              if (upsertErr) {
                console.error(`[webhook] upsert error: ${upsertErr.message}`);
              } else {
                console.log(`[webhook] confirmed: staff=${staff.id} project=${projectId}`);
              }
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

        // ── グループテキストメッセージ → タスク抽出用に保存 ──
        // Botが参加しているグループ（line_groups）のメッセージはすべて保存する
        if (
          event.type === "message" &&
          event.message?.type === "text" &&
          event.message.text &&
          groupId &&
          event.source?.type === "group" &&
          userId
        ) {
          const { data: knownGroup } = await admin
            .from("line_groups")
            .select("group_id")
            .eq("group_id", groupId)
            .maybeSingle();

          if (knownGroup) {
            await admin.from("line_group_messages").insert({
              group_id:     groupId,
              user_id:      userId,
              message_text: event.message.text,
              sent_at:      event.timestamp
                ? new Date(event.timestamp).toISOString()
                : new Date().toISOString(),
              processed:    false,
            });
          }
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
      } catch (eventErr) {
        // 1イベントの失敗が他のイベント処理を止めないようにする
        console.error("[webhook] event processing error:", eventErr);
      }
    }
  } catch (err) {
    console.error("[webhook] fatal error:", err, "body:", rawBody.slice(0, 500));
  }

  // LINEには常に200を返す（エラーでも再送させない）
  return NextResponse.json({ ok: true });
}
