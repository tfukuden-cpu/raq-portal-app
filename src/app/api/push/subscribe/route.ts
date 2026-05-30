/**
 * Web Push 購読登録・解除 API
 * POST  /api/push/subscribe  → 購読を登録
 * DELETE /api/push/subscribe → 購読を削除（endpoint で特定）
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const body = await req.json() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent?: string;
  };

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({
      staff_id:   staffId,
      endpoint:   body.endpoint,
      p256dh:     body.keys.p256dh,
      auth_key:   body.keys.auth,
      user_agent: body.userAgent ?? null,
    }, { onConflict: "staff_id,endpoint" });

  if (error) {
    console.error("[push/subscribe] upsert error:", error);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const { endpoint } = await req.json() as { endpoint: string };

  if (!endpoint) return NextResponse.json({ error: "missing endpoint" }, { status: 400 });

  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("staff_id", staffId)
    .eq("endpoint", endpoint);

  return NextResponse.json({ ok: true });
}
