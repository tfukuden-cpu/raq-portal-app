/**
 * タスク管理ページ
 * LINEグループから自動抽出されたタスクを管理する
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import TasksClient from "./TasksClient";
import type { GroupTask, TaskGroup, StaffOption } from "./TasksClient";

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId  = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  // アクセス制御 — プロジェクトメンバーなら全員OK
  const [{ data: membership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);
  if (!membership) redirect("/dashboard"); // 非メンバーは弾く

  const isAdmin =
    membership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";

  const admin = createAdminClient();

  const [
    { data: rawTasks },
    { data: rawGroups },
    { data: members },
    { data: knownGroups },
    { data: rawMappings },
  ] = await Promise.all([
    supabase
      .from("group_tasks")
      .select("id, title, description, assignee_staff_id, assignee_raw, due_text, due_date, status, group_id, created_at, completed_at, source_messages")
      .eq("project_id", projectId)
      .in("status", ["pending", "done"])
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("task_extraction_groups")
      .select("id, group_id, group_label, enabled")
      .eq("project_id", projectId)
      .order("created_at"),
    admin
      .from("project_members")
      .select("staff_id, staffs(name, display_name)")
      .eq("project_id", projectId)
      .order("staff_id"),
    admin
      .from("line_groups")
      .select("group_id, joined_at")
      .order("joined_at", { ascending: false }),
    admin
      .from("line_name_mappings")
      .select("id, raw_name, staff_id")
      .eq("project_id", projectId)
      .order("raw_name"),
  ]);

  // タスクの担当者名を解決
  const staffNameMap = new Map<string, string>();
  for (const m of members ?? []) {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null } | null;
    staffNameMap.set(m.staff_id, s?.display_name ?? s?.name ?? m.staff_id);
  }

  // group_id → group_label マップ
  const groupLabelMap = new Map<string, string | null>();
  for (const g of rawGroups ?? []) {
    groupLabelMap.set(g.group_id, g.group_label ?? null);
  }

  const tasks: GroupTask[] = (rawTasks ?? []).map(t => ({
    id:                t.id,
    title:             t.title,
    description:       t.description,
    assignee_staff_id: t.assignee_staff_id,
    assignee_raw:      t.assignee_raw,
    due_text:          t.due_text,
    due_date:          t.due_date,
    status:            t.status,
    group_id:          t.group_id,
    group_label:       groupLabelMap.get(t.group_id) ?? null,
    created_at:        t.created_at,
    completed_at:      t.completed_at,
    assignee_name:     t.assignee_staff_id ? (staffNameMap.get(t.assignee_staff_id) ?? null) : null,
    source_messages:   (t.source_messages as { sent_at: string; user_id: string; text: string }[] | null) ?? null,
  }));

  const taskGroups: TaskGroup[] = (rawGroups ?? []).map(g => ({
    id:          g.id,
    group_id:    g.group_id,
    group_label: g.group_label,
    enabled:     g.enabled,
  }));

  const staffOptions: StaffOption[] = (members ?? []).map(m => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null } | null;
    return {
      staffId: m.staff_id,
      name:    s?.display_name ?? s?.name ?? m.staff_id,
    };
  });

  // すでに登録済みのグループIDセット
  const registeredGroupIds = new Set((rawGroups ?? []).map(g => g.group_id));

  // Botが参加中で未登録のグループ（設定画面で1クリック登録できるもの）
  const discoveredGroups = (knownGroups ?? [])
    .filter(g => !registeredGroupIds.has(g.group_id))
    .map(g => ({ group_id: g.group_id }));

  const nameMappings = (rawMappings ?? []).map(m => ({
    id:       m.id,
    rawName:  m.raw_name,
    staffId:  m.staff_id,
    staffName: staffNameMap.get(m.staff_id) ?? m.staff_id,
  }));

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 pb-24">
        <TasksClient
          tasks={tasks}
          taskGroups={taskGroups}
          staffOptions={staffOptions}
          projectId={projectId}
          discoveredGroups={discoveredGroups}
          isAdmin={isAdmin}
          myStaffId={staffId}
          nameMappings={nameMappings}
        />
      </div>
    </main>
  );
}
