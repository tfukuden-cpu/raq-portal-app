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
  /** サーバーで算出した当日(JST, YYYY-MM-DD)。クライアントで new Date() するとhydration不一致(#418)になるため必ずpropsで受ける */
  todayStr: string;
}

export default function AdminHomeWrapper(props: AdminHomeWrapperProps) {
  const {
    tasks, taskGroups, staffOptions, projectId,
    discoveredGroups, myStaffId, nameMappings, todayStr,
    ...homeProps
  } = props;

  // 今日が期限 or 今日作成の自分担当 pending タスク（todayStr はサーバー算出値）
  const myTodayTasks = tasks.filter(
    t => t.assignee_staff_id === myStaffId
      && t.status === "pending"
      && (t.due_date === todayStr || (!t.due_date && t.created_at.startsWith(todayStr)))
  );

  return (
    <HomeClient
      {...homeProps}
      myStaffId={myStaffId}
      projectId={projectId}
      tasksWidget={<MyTasksWidget tasks={myTodayTasks} />}
    />
  );
}
