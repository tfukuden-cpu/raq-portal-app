"use client";

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

export default function AdminHomeWrapper(props: AdminHomeWrapperProps) {
  const {
    tasks, taskGroups, staffOptions, projectId,
    discoveredGroups, myStaffId, nameMappings,
    ...homeProps
  } = props;

  // 今日が期限 or 今日作成の自分担当 pending タスク
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const myTodayTasks = tasks.filter(
    t => t.assignee_staff_id === myStaffId
      && t.status === "pending"
      && (t.due_date === todayStr || (!t.due_date && t.created_at.startsWith(todayStr)))
  );

  return (
    <HomeClient
      {...homeProps}
      tasksWidget={<MyTasksWidget tasks={myTodayTasks} />}
    />
  );
}
