"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProjectId } from "@/lib/project-context";
import { revalidatePath } from "next/cache";
import { pushLineWithButton } from "@/lib/line";
import { resolveMessage } from "@/lib/notify";
import {
  buildDefaultNotificationSettings,
  DEFAULT_NOTIFY_MESSAGES,
} from "@/app/(portal)/admin/[projectId]/settings/notify-config";

const APP_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://raq-portal-app.vercel.app";

/** タスク割り当て時にLINEプッシュを送る（失敗しても握りつぶす） */
async function notifyTaskAssigned(
  projectId: string,
  assigneeStaffId: string,
  taskTitle: string,
  dueDateStr: string | null
): Promise<void> {
  try {
    const admin = createAdminClient();

    // 通知設定を取得
    const { data: ps } = await admin
      .from("project_settings")
      .select("notification_settings")
      .eq("project_id", projectId)
      .maybeSingle();
    const settings = buildDefaultNotificationSettings(
      (ps?.notification_settings as Record<string, unknown>) ?? {}
    );
    if (!settings.task_assigned.enabled) return;

    // スタッフのLINE IDと名前を取得
    const { data: staff } = await admin
      .from("staffs")
      .select("line_user_id, display_name, name")
      .eq("id", assigneeStaffId)
      .maybeSingle();
    if (!staff?.line_user_id) return;

    const name    = staff.display_name ?? staff.name ?? assigneeStaffId;
    const dueText = dueDateStr ? `期限：${dueDateStr}` : "";
    const message = resolveMessage(
      settings.task_assigned.message ?? DEFAULT_NOTIFY_MESSAGES.task_assigned,
      {
        "名前":     name,
        "タイトル": taskTitle,
        "期限":     dueText,
      }
    );
    await pushLineWithButton(
      staff.line_user_id,
      message,
      "タスクを確認する",
      `${APP_URL}/tasks`,
    );
  } catch (e) {
    console.error("[notify] notifyTaskAssigned failed:", e);
  }
}

// タスクのステータス変更
export async function updateTaskStatusAction(taskId: string, status: "pending" | "done" | "dismissed") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  await supabase.from("group_tasks").update({
    status,
    completed_at:  status === "done" ? new Date().toISOString() : null,
    completed_by:  status === "done" ? staffId : null,
  }).eq("id", taskId);

  revalidatePath("/tasks");
  return { success: true };
}

// タスクの担当者・期限を更新
export async function updateTaskAction(fd: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const taskId           = String(fd.get("taskId") ?? "");
  const assigneeStaffId  = String(fd.get("assigneeStaffId") ?? "").trim() || null;
  const dueDateStr       = String(fd.get("dueDate") ?? "").trim() || null;

  // 変更前のタスクを取得して担当者が変わったか確認
  const admin = createAdminClient();
  const { data: oldTask } = await admin
    .from("group_tasks")
    .select("assignee_staff_id, title, project_id")
    .eq("id", taskId)
    .maybeSingle();

  await supabase.from("group_tasks").update({
    assignee_staff_id: assigneeStaffId,
    due_date:          dueDateStr,
  }).eq("id", taskId);

  // 担当者が新たに設定（または変更）された場合のみ通知
  if (
    assigneeStaffId &&
    assigneeStaffId !== oldTask?.assignee_staff_id &&
    oldTask?.project_id
  ) {
    await notifyTaskAssigned(
      oldTask.project_id,
      assigneeStaffId,
      oldTask.title ?? "",
      dueDateStr
    );
  }

  revalidatePath("/tasks");
  return { success: true };
}

// 対象グループを追加
export async function addTaskGroupAction(fd: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "未認証" };

  const projectId  = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件未選択" };

  const groupId    = String(fd.get("groupId") ?? "").trim();
  const groupLabel = String(fd.get("groupLabel") ?? "").trim() || null;

  if (!groupId) return { success: false, message: "グループIDを入力してください" };

  const { error } = await supabase.from("task_extraction_groups").insert({
    project_id:  projectId,
    group_id:    groupId,
    group_label: groupLabel,
    enabled:     true,
  });

  if (error) {
    if (error.code === "23505") return { success: false, message: "このグループはすでに登録されています" };
    return { success: false, message: error.message };
  }

  revalidatePath("/tasks");
  revalidatePath("/line-settings");
  return { success: true };
}

// 対象グループの有効/無効を切り替え
export async function toggleTaskGroupAction(id: string, enabled: boolean) {
  const supabase = await createClient();
  await supabase.from("task_extraction_groups").update({ enabled }).eq("id", id);
  revalidatePath("/tasks");
  revalidatePath("/line-settings");
  return { success: true };
}

// 対象グループを削除
export async function deleteTaskGroupAction(id: string) {
  const supabase = await createClient();
  await supabase.from("task_extraction_groups").delete().eq("id", id);
  revalidatePath("/tasks");
  revalidatePath("/line-settings");
  return { success: true };
}

// 手動でタスク抽出を実行
export async function triggerExtractTasksAction() {
  const { runExtractTasks } = await import("@/lib/extract-tasks");
  const result = await runExtractTasks();
  revalidatePath("/tasks");
  return { success: result.ok, extracted: result.extracted, savedMessages: result.savedMessages ?? 0, message: result.error };
}

// LINE名 → スタッフアカウントの紐づけを保存し、既存タスクも一括更新
export async function linkAssigneeAction(rawName: string, staffId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "未認証" };

  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false, message: "案件未選択" };

  const admin = createAdminClient();

  // マッピングを upsert（同じ raw_name があれば上書き）
  const { error: mapErr } = await admin
    .from("line_name_mappings")
    .upsert(
      { project_id: projectId, raw_name: rawName, staff_id: staffId },
      { onConflict: "project_id,raw_name" },
    );
  if (mapErr) return { success: false, message: mapErr.message };

  // 同じ raw_name の未解決タスクを一括で紐づけ
  await admin
    .from("group_tasks")
    .update({ assignee_staff_id: staffId })
    .eq("project_id", projectId)
    .eq("assignee_raw", rawName)
    .is("assignee_staff_id", null);

  revalidatePath("/tasks");
  return { success: true };
}

// 紐づけを削除
export async function unlinkAssigneeAction(mappingId: string) {
  const admin = createAdminClient();
  await admin.from("line_name_mappings").delete().eq("id", mappingId);
  revalidatePath("/tasks");
  return { success: true };
}

// 紐づけ一覧を取得（設定タブ用）
export async function getNameMappingsAction() {
  const supabase = await createClient();
  const projectId = await getCurrentProjectId();
  if (!projectId) return { data: [] };
  const { data } = await supabase
    .from("line_name_mappings")
    .select("id, raw_name, staff_id")
    .eq("project_id", projectId)
    .order("raw_name");
  return { data: data ?? [] };
}

// タスクを手動で追加
export async function addTaskManualAction(fd: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const projectId = await getCurrentProjectId();
  if (!projectId) return { success: false };

  const admin = createAdminClient();
  const title            = String(fd.get("title") ?? "").trim();
  const description      = String(fd.get("description") ?? "").trim() || null;
  const assigneeStaffId  = String(fd.get("assigneeStaffId") ?? "").trim() || null;
  const dueDateStr       = String(fd.get("dueDate") ?? "").trim() || null;

  if (!title) return { success: false, message: "タイトルを入力してください" };

  await admin.from("group_tasks").insert({
    project_id:        projectId,
    group_id:          "manual",
    title,
    description,
    assignee_staff_id: assigneeStaffId,
    due_date:          dueDateStr,
    status:            "pending",
  });

  // 担当者が設定されている場合はLINE通知
  if (assigneeStaffId) {
    await notifyTaskAssigned(projectId, assigneeStaffId, title, dueDateStr);
  }

  revalidatePath("/tasks");
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════
// 新タスク管理（project_tasks）: 管理者専用のチームタスクボード
// ═══════════════════════════════════════════════════════════════

/** 管理者チェック（project_admin / global admin / executive）。通過時は自分のstaffIdを返す */
async function assertTaskAdmin(projectId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const staffId = user.email?.split("@")[0]?.toUpperCase() ?? "";

  const { data: s } = await supabase.from("staffs").select("global_role").eq("id", staffId).maybeSingle();
  if (s?.global_role === "executive" || s?.global_role === "admin") return staffId;

  const { data: membership } = await supabase
    .from("project_members").select("role")
    .eq("staff_id", staffId).eq("project_id", projectId).maybeSingle();
  return membership?.role === "project_admin" ? staffId : null;
}

export type ProjectTaskInput = {
  projectId: string;
  id?: string | null;           // null=新規
  title: string;
  description?: string | null;
  assigneeStaffId?: string | null;
  startDate?: string | null;    // YYYY-MM-DD
  dueDate?: string | null;      // YYYY-MM-DD
  priority?: "high" | "normal" | "low";
  status?: "todo" | "in_progress" | "done";
  progress?: number;            // 0-100
  sourceGroupTaskId?: string | null;
};

/** タスクの作成・更新（管理者のみ） */
export async function saveProjectTaskAction(
  input: ProjectTaskInput,
): Promise<{ success: boolean; message?: string }> {
  try {
    const myStaffId = await assertTaskAdmin(input.projectId);
    if (!myStaffId) return { success: false, message: "権限がありません" };

    const title = (input.title ?? "").trim();
    if (!title) return { success: false, message: "タイトルを入力してください" };
    if (input.startDate && input.dueDate && input.startDate > input.dueDate) {
      return { success: false, message: "開始日が期日より後になっています" };
    }

    const admin = createAdminClient();

    // ステータス・進捗は作業メモ（addTaskNoteAction）から更新するのが基本。
    // 編集（update）では明示指定が無い限り既存値を保持する
    const payload: Record<string, unknown> = {
      title,
      description:       (input.description ?? "").trim() || null,
      assignee_staff_id: input.assigneeStaffId || null,
      start_date:        input.startDate || null,
      due_date:          input.dueDate || null,
      priority:          input.priority ?? "normal",
      updated_at:        new Date().toISOString(),
    };
    if (input.status !== undefined || !input.id) {
      const status   = input.status ?? "todo";
      const progress = Math.max(0, Math.min(100, Math.round(input.progress ?? 0)));
      payload.status       = status;
      payload.progress     = status === "done" ? 100 : progress;
      payload.completed_at = status === "done" ? new Date().toISOString() : null;
    }

    let prevAssignee: string | null = null;
    if (input.id) {
      const { data: prev } = await admin
        .from("project_tasks")
        .select("assignee_staff_id")
        .eq("id", input.id)
        .eq("project_id", input.projectId)
        .maybeSingle();
      prevAssignee = (prev as { assignee_staff_id?: string | null } | null)?.assignee_staff_id ?? null;

      const { error } = await admin
        .from("project_tasks")
        .update(payload)
        .eq("id", input.id)
        .eq("project_id", input.projectId);
      if (error) return { success: false, message: error.message };
    } else {
      const { error } = await admin
        .from("project_tasks")
        .insert({
          ...payload,
          project_id: input.projectId,
          created_by: myStaffId,
          source_group_task_id: input.sourceGroupTaskId || null,
        });
      if (error) return { success: false, message: error.message };
    }

    // 担当者が新たに設定・変更されたらLINE通知（task_assigned・設定でON時のみ）
    const nextAssignee = input.assigneeStaffId || null;
    if (nextAssignee && nextAssignee !== prevAssignee) {
      await notifyTaskAssigned(input.projectId, nextAssignee, title, input.dueDate ?? null);
    }

    revalidatePath("/tasks");
    return { success: true };
  } catch (e) {
    console.error("[tasks] saveProjectTaskAction failed:", e);
    return { success: false, message: "保存に失敗しました" };
  }
}

/** タスク削除（管理者のみ） */
export async function deleteProjectTaskAction(
  projectId: string,
  taskId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const myStaffId = await assertTaskAdmin(projectId);
    if (!myStaffId) return { success: false, message: "権限がありません" };
    const admin = createAdminClient();
    const { error } = await admin
      .from("project_tasks")
      .delete()
      .eq("id", taskId)
      .eq("project_id", projectId);
    if (error) return { success: false, message: error.message };
    revalidatePath("/tasks");
    return { success: true };
  } catch (e) {
    console.error("[tasks] deleteProjectTaskAction failed:", e);
    return { success: false, message: "削除に失敗しました" };
  }
}

/** LINE抽出タスク（group_tasks）をタスク管理へ取り込む（元は完了扱いに） */
export async function importGroupTaskAction(
  projectId: string,
  groupTaskId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const myStaffId = await assertTaskAdmin(projectId);
    if (!myStaffId) return { success: false, message: "権限がありません" };
    const admin = createAdminClient();

    const { data: gt } = await admin
      .from("group_tasks")
      .select("id, title, description, assignee_staff_id, due_date, status")
      .eq("id", groupTaskId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!gt) return { success: false, message: "対象が見つかりません" };

    const { error } = await admin.from("project_tasks").insert({
      project_id:           projectId,
      title:                (gt as { title: string }).title,
      description:          (gt as { description: string | null }).description,
      assignee_staff_id:    (gt as { assignee_staff_id: string | null }).assignee_staff_id,
      due_date:             (gt as { due_date: string | null }).due_date,
      status:               "todo",
      priority:             "normal",
      created_by:           myStaffId,
      source_group_task_id: groupTaskId,
    });
    if (error) return { success: false, message: error.message };

    // 取込み元は完了扱いにして受信箱から消す
    await admin.from("group_tasks").update({
      status: "done",
      completed_at: new Date().toISOString(),
      completed_by: myStaffId,
    }).eq("id", groupTaskId);

    revalidatePath("/tasks");
    return { success: true };
  } catch (e) {
    console.error("[tasks] importGroupTaskAction failed:", e);
    return { success: false, message: "取込みに失敗しました" };
  }
}

/** 作業メモを追加し、タスクのステータス・進捗を自動更新する
 *  メモあり=作業中／「完了にする」=完了（進捗100%）。進捗指定があれば反映 */
export async function addTaskNoteAction(input: {
  projectId: string;
  taskId: string;
  body: string;
  progress?: number | null;   // 0-100（未指定なら進捗は変えない）
  markDone?: boolean;
}): Promise<{ success: boolean; message?: string }> {
  try {
    const myStaffId = await assertTaskAdmin(input.projectId);
    if (!myStaffId) return { success: false, message: "権限がありません" };

    const body = (input.body ?? "").trim();
    if (!body) return { success: false, message: "メモを入力してください" };

    const admin = createAdminClient();
    const { data: task } = await admin
      .from("project_tasks")
      .select("id, progress, status")
      .eq("id", input.taskId)
      .eq("project_id", input.projectId)
      .maybeSingle();
    if (!task) return { success: false, message: "タスクが見つかりません" };

    const markDone = !!input.markDone;
    const progress = markDone
      ? 100
      : input.progress != null
        ? Math.max(0, Math.min(100, Math.round(input.progress)))
        : (task as { progress: number }).progress;

    const { error: noteError } = await admin.from("project_task_notes").insert({
      project_id:      input.projectId,
      task_id:         input.taskId,
      author_staff_id: myStaffId,
      body,
      progress:        input.progress != null || markDone ? progress : null,
      mark_done:       markDone,
    });
    if (noteError) return { success: false, message: noteError.message };

    // メモが付いたら作業中／完了メモで完了
    const { error: taskError } = await admin.from("project_tasks").update({
      status:       markDone ? "done" : "in_progress",
      progress,
      completed_at: markDone ? new Date().toISOString() : null,
      updated_at:   new Date().toISOString(),
    }).eq("id", input.taskId).eq("project_id", input.projectId);
    if (taskError) return { success: false, message: taskError.message };

    revalidatePath("/tasks");
    return { success: true };
  } catch (e) {
    console.error("[tasks] addTaskNoteAction failed:", e);
    return { success: false, message: "メモの保存に失敗しました" };
  }
}
