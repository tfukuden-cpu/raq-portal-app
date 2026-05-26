/**
 * POST /api/cron/extract-tasks
 * LINEグループメッセージからキーワードベースでタスクを自動抽出する
 * Vercel Cron: 5分おきに実行
 */

import { NextRequest, NextResponse } from "next/server";
import { runExtractTasks } from "@/lib/extract-tasks";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runExtractTasks();
  return NextResponse.json(result);
}
