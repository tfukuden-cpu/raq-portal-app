/**
 * POST /api/cron/extract-tasks
 * LINEグループメッセージからClaude APIでタスクを自動抽出する
 * Vercel Cron: 5分おきに実行
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  // Cron認証
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    // 有効な対象グループを取得
    const { data: groups } = await admin
      .from("task_extraction_groups")
      .select("group_id, project_id, group_label")
      .eq("enabled", true);

    if (!groups || groups.length === 0) {
      return NextResponse.json({ ok: true, message: "no enabled groups" });
    }

    let totalExtracted = 0;

    for (const group of groups) {
      // 未処理メッセージを取得（最大50件）
      const { data: messages } = await admin
        .from("line_group_messages")
        .select("id, user_id, message_text, sent_at")
        .eq("group_id", group.group_id)
        .eq("processed", false)
        .order("sent_at", { ascending: true })
        .limit(50);

      if (!messages || messages.length === 0) continue;

      // LINE user_id → スタッフ名のマッピングを取得
      const userIds = [...new Set(messages.map(m => m.user_id))];
      const { data: staffRows } = await admin
        .from("staffs")
        .select("id, name, display_name, line_user_id")
        .in("line_user_id", userIds);

      const staffMap = new Map<string, { staffId: string; name: string }>();
      for (const s of staffRows ?? []) {
        if (s.line_user_id) {
          staffMap.set(s.line_user_id, {
            staffId: s.id,
            name: s.display_name ?? s.name ?? s.id,
          });
        }
      }

      // メッセージをテキスト化（名前付き）
      const chatLog = messages
        .map(m => {
          const staff = staffMap.get(m.user_id);
          const name = staff?.name ?? `ユーザー(${m.user_id.slice(-4)})`;
          const time = new Date(m.sent_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
          return `[${time}] ${name}: ${m.message_text}`;
        })
        .join("\n");

      // Claude APIでタスク抽出
      const response = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `以下はLINEグループのやり取りです。タスク・依頼・確認事項を抽出してください。

【ルール】
- 明確な依頼・タスク・やることのみ抽出する（雑談・挨拶は無視）
- 担当者が特定できる場合は「assignee_raw」に名前を入れる
- 期限・日時が読み取れる場合は「due_text」に入れる（例：「明日」「5月28日」）
- タスクがなければ空配列を返す

【グループ名】${group.group_label ?? group.group_id}

【やり取り】
${chatLog}

【出力形式】JSON配列のみ返してください（他のテキスト不要）：
[
  {
    "title": "タスクのタイトル（簡潔に）",
    "description": "詳細・文脈（任意）",
    "assignee_raw": "担当者名（不明なら null）",
    "due_text": "期限テキスト（不明なら null）"
  }
]`,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") continue;

      let tasks: {
        title: string;
        description?: string;
        assignee_raw?: string | null;
        due_text?: string | null;
      }[] = [];

      try {
        const jsonText = content.text.trim().replace(/^```json\n?|```$/g, "");
        tasks = JSON.parse(jsonText);
        if (!Array.isArray(tasks)) tasks = [];
      } catch {
        console.error("[extract-tasks] JSON parse failed:", content.text.slice(0, 200));
      }

      // タスクをDBに保存
      for (const task of tasks) {
        if (!task.title) continue;

        // assignee_raw からスタッフIDを逆引き
        let assigneeStaffId: string | null = null;
        if (task.assignee_raw) {
          for (const [, s] of staffMap) {
            if (s.name.includes(task.assignee_raw) || task.assignee_raw.includes(s.name)) {
              assigneeStaffId = s.staffId;
              break;
            }
          }
        }

        await admin.from("group_tasks").insert({
          project_id:        group.project_id,
          group_id:          group.group_id,
          title:             task.title,
          description:       task.description ?? null,
          assignee_staff_id: assigneeStaffId,
          assignee_raw:      task.assignee_raw ?? null,
          due_text:          task.due_text ?? null,
          status:            "pending",
          source_messages:   messages.map(m => ({
            sent_at: m.sent_at,
            user_id: m.user_id,
            text:    m.message_text,
          })),
        });
        totalExtracted++;
      }

      // メッセージを処理済みにする
      const messageIds = messages.map(m => m.id);
      await admin
        .from("line_group_messages")
        .update({ processed: true })
        .in("id", messageIds);
    }

    return NextResponse.json({ ok: true, extracted: totalExtracted });
  } catch (err) {
    console.error("[extract-tasks] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
