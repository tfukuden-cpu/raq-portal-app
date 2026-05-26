"use client";

import { useState } from "react";
import HomeClient, { type HomeClientProps } from "./HomeClient";
import TasksClient, { type GroupTask, type TaskGroup, type StaffOption, type NameMapping } from "../tasks/TasksClient";
import MyTasksWidget from "./MyTasksWidget";

interface AdminHomeWrapperProps extends HomeClientProps {
  tasks: GroupTask[];
  taskGroups: TaskGroup[];
  staffOptions: StaffOption[];
  projectId: string;
  discoveredGroups: { group_id: string }[];
  myStaffId: string;
  nameMappings: NameMapping[];
  pendingTaskCount: number;
}

type Tab = "home" | "tasks";

export default function AdminHomeWrapper(props: AdminHomeWrapperProps) {
  const {
    tasks, taskGroups, staffOptions, projectId,
    discoveredGroups, myStaffId, nameMappings, pendingTaskCount,
    ...homeProps
  } = props;

  const [tab, setTab] = useState<Tab>("home");

  // 今日の自分のタスク（due_date が今日、または due_date なしで今日作成）
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const myTodayTasks = tasks.filter(
    t => t.assignee_staff_id === myStaffId
      && t.status === "pending"
      && (t.due_date === todayStr || (!t.due_date && t.created_at.startsWith(todayStr)))
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* タブ切り替えバー */}
      <div className="sticky top-0 z-20 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex max-w-5xl mx-auto px-2">
          <button
            type="button"
            onClick={() => setTab("home")}
            className={[
              "px-5 py-3 text-sm font-medium border-b-2 transition-colors",
              tab === "home"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
            ].join(" ")}
          >
            ホーム
          </button>
          <button
            type="button"
            onClick={() => setTab("tasks")}
            className={[
              "px-5 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5",
              tab === "tasks"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
            ].join(" ")}
          >
            タスク
            {pendingTaskCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold leading-none">
                {pendingTaskCount > 99 ? "99+" : pendingTaskCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* コンテンツ */}
      {tab === "home" ? (
        <>
          {/* ホームUI */}
          <HomeClient {...homeProps} />
          {/* 自分のタスクウィジェット */}
          <MyTasksWidget tasks={myTodayTasks} onSeeAll={() => setTab("tasks")} />
        </>
      ) : (
        <div className="max-w-5xl mx-auto px-4 pb-24">
          <TasksClient
            tasks={tasks}
            taskGroups={taskGroups}
            staffOptions={staffOptions}
            projectId={projectId}
            discoveredGroups={discoveredGroups}
            isAdmin={true}
            myStaffId={myStaffId}
            nameMappings={nameMappings}
          />
        </div>
      )}
    </div>
  );
}
