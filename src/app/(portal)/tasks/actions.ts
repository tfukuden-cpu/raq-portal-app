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
