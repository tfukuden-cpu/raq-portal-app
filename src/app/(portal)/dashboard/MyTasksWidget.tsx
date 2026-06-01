"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { updateTaskStatusAction } from "../tasks/actions";
import type { GroupTask } from "../tasks/TasksClient";
import { SquareIcon, ChevronRightIcon } from "@/components/icons";

interface MyTasksWidgetProps {
  tasks: GroupTask[];
}

export default function MyTasksWidget({ tasks }: MyTasksWidgetProps) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const remaining = tasks.filter(t => !done.has(t.id));
  const visible   = remaining.slice(0, 5);

  function complete(id: string) {
    setDone(prev => new Set(prev).add(id));
    startTransition(async () => {
      await updateTaskStatusAction(id, "done");
    });
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">今日のタスク</p>
          {remaining.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-[#0d1b35] text-white text-[10px] font-bold tabular-nums">
              {remaining.length}
            </span>
          )}
        </div>
        <Link
          href="/tasks"
          className="flex items-center gap-0.5 text-[12px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
        >
          すべて見る
          <ChevronRightIcon className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* タスク一覧 */}
      {visible.length === 0 ? (
        <p className="px-6 py-5 text-[13px] text-zinc-400">今日のタスクはありません</p>
      ) : (
        <ul className="divide-y divide-zinc-50 dark:divide-zinc-800">
          {visible.map(task => (
            <li key={task.id} className="flex items-start gap-3 px-6 py-3.5">
              <button
                type="button"
                onClick={() => complete(task.id)}
                disabled={isPending}
                className="mt-0.5 flex-shrink-0 text-zinc-300 hover:text-[#0d1b35] dark:hover:text-blue-400 transition-colors"
              >
                <SquareIcon className="w-4 h-4" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-zinc-700 dark:text-zinc-200 leading-snug">{task.title}</p>
                {(task.due_text || task.due_date) && (
                  <p className="text-[11px] text-zinc-400 mt-0.5 tabular-nums">
                    {task.due_text ?? task.due_date}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* +N件 */}
      {remaining.length > 5 && (
        <Link
          href="/tasks"
          className="flex items-center justify-center w-full py-2.5 text-[12px] font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 border-t border-zinc-50 dark:border-zinc-800 transition-colors"
        >
          他 {remaining.length - 5} 件を見る
        </Link>
      )}
    </div>
  );
}
