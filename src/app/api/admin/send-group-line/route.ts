import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { secret, message } = await req.json();
  if (secret !== "tmp-raq-send-2026") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = "Cdf3acf147c89a94fd7582515b0b83234";
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: groupId, messages: [{ type: "text", text: message }] }),
  });
  const body = await res.text();
  return NextResponse.json({ status: res.status, body });
}
