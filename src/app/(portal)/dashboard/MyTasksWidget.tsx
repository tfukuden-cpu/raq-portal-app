"use client";

import { useState, useTransition } from "react";
import { updateTaskStatusAction } from "../tasks/actions";
import type { GroupTask } from "../tasks/TasksClient";
import { SquareIcon, ChevronRightIcon } from "@/components/icons";

interface MyTasksWidgetProps {
  tasks: GroupTask[];          // 自分に割り当てられた pending タスク
  onSeeAll: () => void;        // タスクタブへ切り替えるコールバック
}

export default function MyTasksWidget({ tasks, onSeeAll }: MyTasksWidgetProps) {
  const [done, setDone]       = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const visible = tasks.filter(t => !done.has(t.id)).slice(0, 5);

  function complete(id: string) {
    setDone(prev => new Set(prev).add(id));
    startTransition(async () => {
      await updateTaskStatusAction(id, "done");
    });
  }

  return (
    <div className="mx-4 mb-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">今日のタスク</p>
        <button
          type="button"
          onClick={onSeeAll}
          className="flex items-center gap-0.5 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
        >
          すべて見る
          <ChevronRightIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* タスク一覧 */}
      {visible.length === 0 ? (
        <p className="px-4 py-5 text-sm text-zinc-400 text-center">今日のタスクはありません</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {visible.map(task => (
            <li key={task.id} className="flex items-start gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => complete(task.id)}
                disabled={isPending}
                className="mt-0.5 flex-shrink-0 text-zinc-400 hover:text-blue-600 transition-colors"
              >
                <SquareIcon className="w-4 h-4" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-800 dark:text-zinc-100 leading-snug">{task.title}</p>
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

      {/* 残件数 */}
      {tasks.filter(t => !done.has(t.id)).length > 5 && (
        <button
          type="button"
          onClick={onSeeAll}
          className="w-full py-2.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border-t border-zinc-100 dark:border-zinc-800 transition-colors"
        >
          他 {tasks.filter(t => !done.has(t.id)).length - 5} 件を見る
        </button>
      )}
    </div>
  );
}
