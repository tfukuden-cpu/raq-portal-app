/**
 * タスク管理ページ（管理者専用）
 * project_tasks のチームタスクボード＋LINE抽出タスク（group_tasks）の取込み
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import TasksClient from "./TasksClient";
import type { GroupTask, StaffOption, ProjectTask } from "./TasksClient";

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/select-project");

  // アクセス制御: project_admin または global admin / executive のみ
  const [{ data: membership }, { data: myStaff }] = await Promise.all([
    supabase.from("project_members").select("role")
      .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle(),
    supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle(),
  ]);
  const isAdmin =
    membership?.role === "project_admin" ||
    myStaff?.global_role === "admin" ||
    myStaff?.global_role === "executive";
  if (!isAdmin) redirect("/dashboard");

  const admin = createAdminClient();

  const [
    { data: project },
    { data: rawTasks },
    { data: rawCandidates },
    { data: rawGroups },
    { data: members },
  ] = await Promise.all([
    admin.from("projects").select("name").eq("id", projectId).maybeSingle(),
    admin.from("project_tasks")
      .select("id, title, description, assignee_staff_id, start_date, due_date, progress, status, priority, created_at, completed_at")
      .eq("project_id", projectId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("group_tasks")
      .select("id, title, description, assignee_staff_id, assignee_raw, due_text, due_date, status, group_id, created_at, completed_at, source_messages")
      .eq("project_id", projectId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(100),
    admin.from("task_extraction_groups")
      .select("group_id, group_label")
      .eq("project_id", projectId),
    admin.from("project_members")
      .select("staff_id, staffs(name, display_name)")
      .eq("project_id", projectId)
      .is("end_date", null)
      .order("staff_id"),
  ]);

  if (!project) redirect("/dashboard");

  const staffNameMap = new Map<string, string>();
  for (const m of members ?? []) {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null } | null;
    staffNameMap.set(m.staff_id, s?.display_name ?? s?.name ?? m.staff_id);
  }

  const groupLabelMap = new Map<string, string | null>();
  for (const g of rawGroups ?? []) groupLabelMap.set(g.group_id, g.group_label ?? null);

  const tasks: ProjectTask[] = (rawTasks ?? []).map(t => ({
    id:              t.id,
    title:           t.title,
    description:     t.description,
    assigneeStaffId: t.assignee_staff_id,
    assigneeName:    t.assignee_staff_id ? (staffNameMap.get(t.assignee_staff_id) ?? t.assignee_staff_id) : null,
    startDate:       t.start_date,
    dueDate:         t.due_date,
    progress:        t.progress ?? 0,
    status:          (t.status ?? "todo") as ProjectTask["status"],
    priority:        (t.priority ?? "normal") as ProjectTask["priority"],
    createdAt:       t.created_at,
    completedAt:     t.completed_at,
  }));

  const candidates: GroupTask[] = (rawCandidates ?? []).map(t => ({
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

  const staffOptions: StaffOption[] = (members ?? []).map(m => {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null } | null;
    return { staffId: m.staff_id, name: s?.display_name ?? s?.name ?? m.staff_id };
  });

  // 当日(JST)はサーバーで算出してpropsで渡す（クライアントで new Date しない・地雷対策）
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      <div className="max-w-4xl mx-auto px-4 pb-24">
        <TasksClient
          projectId={projectId}
          projectName={project.name}
          today={today}
          tasks={tasks}
          candidates={candidates}
          staffOptions={staffOptions}
        />
      </div>
    </main>
  );
}
