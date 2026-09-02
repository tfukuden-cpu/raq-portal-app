/**
 * タスク管理ページ（管理者専用）
 * project_tasks のチームタスクボード＋LINE抽出タスク（group_tasks）の取込み
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { redirect } from "next/navigation";
import TasksClient from "./TasksClient";
import type { StaffOption, ProjectTask, TaskNote } from "./TasksClient";

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";
  const projectId = await getCurrentProjectId();
  if (!projectId) redirect("/login");

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
    { data: members },
    { data: rawNotes },
  ] = await Promise.all([
    admin.from("projects").select("name").eq("id", projectId).maybeSingle(),
    admin.from("project_tasks")
      .select("id, title, description, category, assignee_staff_id, start_date, due_date, progress, status, priority, created_at, completed_at")
      .eq("project_id", projectId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("project_members")
      .select("staff_id, section, sections, staffs(name, display_name)")
      .eq("project_id", projectId)
      .is("end_date", null)
      .order("staff_id"),
    admin.from("project_task_notes")
      .select("id, task_id, author_staff_id, body, progress, mark_done, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(2000),
  ]);

  if (!project) redirect("/dashboard");

  const staffNameMap = new Map<string, string>();
  for (const m of members ?? []) {
    const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
      { name: string | null; display_name: string | null } | null;
    staffNameMap.set(m.staff_id, s?.display_name ?? s?.name ?? m.staff_id);
  }

  // メモ著者名の解決（運営者などメンバー外のこともあるので staffs から直接引く）
  const noteRows = (rawNotes ?? []) as {
    id: string; task_id: string; author_staff_id: string;
    body: string; progress: number | null; mark_done: boolean; created_at: string;
  }[];
  const authorIds = [...new Set(noteRows.map(n => n.author_staff_id))]
    .filter(id => !staffNameMap.has(id));
  if (authorIds.length > 0) {
    const { data: authors } = await admin
      .from("staffs").select("id, name, display_name").in("id", authorIds);
    for (const a of authors ?? []) {
      staffNameMap.set(a.id, (a as { display_name: string | null }).display_name ?? (a as { name: string | null }).name ?? a.id);
    }
  }
  const notesByTask = new Map<string, TaskNote[]>();
  for (const n of noteRows) {
    if (!notesByTask.has(n.task_id)) notesByTask.set(n.task_id, []);
    notesByTask.get(n.task_id)!.push({
      id:         n.id,
      body:       n.body,
      progress:   n.progress,
      markDone:   n.mark_done,
      authorName: staffNameMap.get(n.author_staff_id) ?? n.author_staff_id,
      createdAt:  n.created_at,
    });
  }

  const tasks: ProjectTask[] = (rawTasks ?? []).map(t => ({
    id:              t.id,
    title:           t.title,
    description:     t.description,
    category:        t.category ?? null,
    assigneeStaffId: t.assignee_staff_id,
    assigneeName:    t.assignee_staff_id ? (staffNameMap.get(t.assignee_staff_id) ?? t.assignee_staff_id) : null,
    startDate:       t.start_date,
    dueDate:         t.due_date,
    progress:        t.progress ?? 0,
    status:          (t.status ?? "todo") as ProjectTask["status"],
    priority:        (t.priority ?? "normal") as ProjectTask["priority"],
    createdAt:       t.created_at,
    completedAt:     t.completed_at,
    notes:           notesByTask.get(t.id) ?? [],
  }));

  // 担当者の選択肢はSVのみ（メインセクション or スキルにSVを持つ現役メンバー）
  const staffOptions: StaffOption[] = (members ?? [])
    .filter(m => {
      const secs = ((m as { sections?: string[] | null }).sections ?? []).filter(Boolean);
      return m.section === "SV" || secs.includes("SV");
    })
    .map(m => {
      const s = (Array.isArray(m.staffs) ? m.staffs[0] : m.staffs) as
        { name: string | null; display_name: string | null } | null;
      return { staffId: m.staff_id, name: s?.display_name ?? s?.name ?? m.staff_id };
    });

  // 当日(JST)はサーバーで算出してpropsで渡す（クライアントで new Date しない・地雷対策）
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4 md:px-6 pb-24">
        <TasksClient
          projectId={projectId}
          projectName={project.name}
          today={today}
          tasks={tasks}
          staffOptions={staffOptions}
        />
      </div>
    </main>
  );
}
