"use client";

import { useState, useTransition } from "react";
import {
  updateTaskStatusAction,
  updateTaskAction,
  addTaskGroupAction,
  toggleTaskGroupAction,
  deleteTaskGroupAction,
  triggerExtractTasksAction,
  addTaskManualAction,
} from "./actions";

export type GroupTask = {
  id: string;
  title: string;
  description: string | null;
  assignee_staff_id: string | null;
  assignee_raw: string | null;
  due_text: string | null;
  due_date: string | null;
  status: string;
  group_id: string;
  group_label: string | null;
  created_at: string;
  completed_at: string | null;
  assignee_name: string | null;
  source_messages: { sent_at: string; user_id: string; text: string }[] | null;
};

export type TaskGroup = {
  id: string;
  group_id: string;
  group_label: string | null;
  enabled: boolean;
};

export type StaffOption = {
  staffId: string;
  name: string;
};

type Tab = "my" | "pending" | "done" | "settings";

/** due_date (YYYY-MM-DD) を "M月D日" 形式に */
function formatDueDate(dateStr: string): string {
  const m = dateStr.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  return `${parseInt(m[1])}月${parseInt(m[2])}日`;
}

export default function TasksClient({
  tasks,
  taskGroups,
  staffOptions,
  projectId,
  discoveredGroups,
  isAdmin,
  myStaffId,
}: {
  tasks: GroupTask[];
  taskGroups: TaskGroup[];
  staffOptions: StaffOption[];
  projectId: string;
  discoveredGroups: { group_id: string }[];
  isAdmin: boolean;
  myStaffId: string;
}) {
  const [tab, setTab]                   = useState<Tab>("my");
  const [isPending, startTransition]    = useTransition();
  const [flash, setFlash]               = useState<{ ok: boolean; msg: string } | null>(null);
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [editId, setEditId]             = useState<string | null>(null);
  const [showAddTask, setShowAddTask]   = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);

  // フォーム state
  const [newGroupId, setNewGroupId]     = useState("");
  const [newGroupLabel, setNewGroupLabel] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc]   = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");
  const [newTaskDue, setNewTaskDue]     = useState("");

  function showFlash(ok: boolean, msg: string) {
    setFlash({ ok, msg });
    setTimeout(() => setFlash(null), 4000);
  }

  const pendingTasks  = tasks.filter(t => t.status === "pending");
  const doneTasks     = tasks.filter(t => t.status === "done");
  const myTasks       = pendingTasks.filter(t => t.assignee_staff_id === myStaffId);
  const otherTasks    = pendingTasks.filter(t => t.assignee_staff_id !== myStaffId);

  function handleStatusChange(taskId: string, status: "pending" | "done" | "dismissed") {
    startTransition(async () => {
      await updateTaskStatusAction(taskId, status);
    });
  }

  function handleTriggerExtract() {
    startTransition(async () => {
      const r = await triggerExtractTasksAction();
      if (r.success) {
        if (r.extracted > 0) {
          showFlash(true, `タスクを${r.extracted}件抽出しました`);
        } else if ((r.savedMessages ?? 0) === 0) {
          showFlash(false, "未処理メッセージがありません。グループが正しく設定されているか確認してください");
        } else {
          showFlash(true, `メッセージ${r.savedMessages}件を確認しましたが、タスクは検出されませんでした`);
        }
      } else {
        showFlash(false, r.message ?? "抽出に失敗しました");
      }
    });
  }

  function handleAddGroup() {
    if (!newGroupId.trim()) return;
    const fd = new FormData();
    fd.set("groupId", newGroupId.trim());
    fd.set("groupLabel", newGroupLabel.trim());
    startTransition(async () => {
      const r = await addTaskGroupAction(fd);
      if (r.success) {
        setNewGroupId("");
        setNewGroupLabel("");
        setShowAddGroup(false);
        showFlash(true, "グループを追加しました");
      } else {
        showFlash(false, r.message ?? "追加に失敗しました");
      }
    });
  }

  function handleAddTask() {
    if (!newTaskTitle.trim()) return;
    const fd = new FormData();
    fd.set("title", newTaskTitle.trim());
    fd.set("description", newTaskDesc.trim());
    fd.set("assigneeStaffId", newTaskAssignee);
    fd.set("dueDate", newTaskDue);
    startTransition(async () => {
      const r = await addTaskManualAction(fd);
      if (r.success) {
        setNewTaskTitle(""); setNewTaskDesc("");
        setNewTaskAssignee(""); setNewTaskDue("");
        setShowAddTask(false);
        showFlash(true, "タスクを追加しました");
      } else {
        showFlash(false, "追加に失敗しました");
      }
    });
  }

  const inputCls = "w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition";

  function TaskCard({ task }: { task: GroupTask }) {
    const expanded  = expandedId === task.id;
    const isEditing = editId === task.id;
    const [editAssignee, setEditAssignee] = useState(task.assignee_staff_id ?? "");
    const [editDue, setEditDue]           = useState(task.due_date ?? "");

    return (
      <div className={`rounded-xl border bg-white dark:bg-zinc-900 transition-all ${
        task.status === "done"
          ? "border-zinc-100 dark:border-zinc-800 opacity-60"
          : "border-zinc-200 dark:border-zinc-700"
      }`}>
        <div className="flex items-start gap-3 p-3">
          {/* 完了チェック */}
          <button
            type="button"
            onClick={() => handleStatusChange(task.id, task.status === "done" ? "pending" : "done")}
            className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
              task.status === "done"
                ? "bg-emerald-500 border-emerald-500 text-white"
                : "border-zinc-300 dark:border-zinc-600 hover:border-emerald-400"
            }`}
          >
            {task.status === "done" && (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold text-zinc-800 dark:text-zinc-100 leading-snug ${
              task.status === "done" ? "line-through text-zinc-400" : ""
            }`}>
              {task.title}
            </p>

            {/* メタ情報 */}
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {task.assignee_name && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-semibold">
                  {task.assignee_name}
                </span>
              )}
              {!task.assignee_name && task.assignee_raw && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-semibold">
                  {task.assignee_raw}
                </span>
              )}
              {(task.due_date || task.due_text) && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 font-semibold tabular-nums">
                  {task.due_date ? formatDueDate(task.due_date) : task.due_text}
                </span>
              )}
              {task.group_id !== "manual" && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
                  {task.group_label ?? "LINE"}
                </span>
              )}
            </div>
          </div>

          {/* 展開ボタン */}
          <button
            type="button"
            onClick={() => setExpandedId(expanded ? null : task.id)}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex-shrink-0 p-1"
          >
            <svg className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* 展開エリア */}
        {expanded && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 px-3 pb-3 pt-2 space-y-2">
            {/* 元のLINEメッセージ */}
            {task.source_messages && task.source_messages.length > 0 && (
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-2.5 py-2">
                {task.description && (
                  <p className="text-[10px] text-zinc-400 font-semibold mb-1">{task.description}</p>
                )}
                <p className="text-xs text-zinc-700 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap">
                  {task.source_messages[0].text}
                </p>
              </div>
            )}
            {/* source_messages がない（手動追加）場合は description を表示 */}
            {(!task.source_messages || task.source_messages.length === 0) && task.description && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{task.description}</p>
            )}

            {isEditing ? (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold">担当者</label>
                  <select value={editAssignee} onChange={e => setEditAssignee(e.target.value)}
                    className={`${inputCls} mt-0.5`}>
                    <option value="">未設定</option>
                    {staffOptions.map(s => (
                      <option key={s.staffId} value={s.staffId}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold">期限</label>
                  <input type="date" value={editDue} onChange={e => setEditDue(e.target.value)}
                    className={`${inputCls} mt-0.5`} />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditId(null)}
                    className="flex-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500">
                    キャンセル
                  </button>
                  <button type="button" onClick={() => {
                    const fd = new FormData();
                    fd.set("taskId", task.id);
                    fd.set("assigneeStaffId", editAssignee);
                    fd.set("dueDate", editDue);
                    startTransition(async () => {
                      await updateTaskAction(fd);
                      setEditId(null);
                    });
                  }} className="flex-1 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold">
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditId(task.id)}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                  編集
                </button>
                <button type="button"
                  onClick={() => handleStatusChange(task.id, "dismissed")}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 font-semibold transition-colors">
                  無視
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 -mx-4 px-4 bg-white dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800">
        <div className="pt-5 pb-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">タスク</h1>
          <p className="text-sm font-semibold text-zinc-400 mt-0.5">LINEグループから自動抽出</p>
        </div>

        {/* タブ */}
        <div className="flex mt-2">
          {([
            { id: "my"       as Tab, label: `自分 ${myTasks.length}` },
            { id: "pending"  as Tab, label: `全体 ${pendingTasks.length}` },
            { id: "done"     as Tab, label: `完了済 ${doneTasks.length}` },
            ...(isAdmin ? [{ id: "settings" as Tab, label: "設定" }] : []),
          ]).map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={[
                "flex-shrink-0 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors tabular-nums",
                tab === t.id
                  ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
              ].join(" ")}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* フラッシュ */}
      {flash && (
        <div className={`mt-3 text-xs px-3 py-2 rounded-xl ${
          flash.ok ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
                   : "bg-red-50 dark:bg-red-950/20 text-red-500"
        }`}>
          {flash.ok ? "✓ " : "✗ "}{flash.msg}
        </div>
      )}

      <div className="space-y-3 pt-4">

        {/* ── 手動追加フォーム（自分・全体タブ共通） ── */}
        {(tab === "my" || tab === "pending") && showAddTask && (
          <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-3 space-y-2">
            <p className="text-xs font-semibold text-zinc-500">タスクを手動追加</p>
            <div>
              <label className="text-[10px] text-zinc-500 font-semibold">タイトル *</label>
              <input type="text" value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)}
                placeholder="例：発注書を確認する"
                className={`${inputCls} mt-0.5`} />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 font-semibold">詳細（任意）</label>
              <input type="text" value={newTaskDesc} onChange={e => setNewTaskDesc(e.target.value)}
                placeholder="詳細や文脈"
                className={`${inputCls} mt-0.5`} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-zinc-500 font-semibold">担当者</label>
                <select value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)}
                  className={`${inputCls} mt-0.5`}>
                  <option value="">未設定</option>
                  {staffOptions.map(s => (
                    <option key={s.staffId} value={s.staffId}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 font-semibold">期限</label>
                <input type="date" value={newTaskDue} onChange={e => setNewTaskDue(e.target.value)}
                  className={`${inputCls} mt-0.5`} />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowAddTask(false)}
                className="flex-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500">
                キャンセル
              </button>
              <button type="button" onClick={handleAddTask} disabled={!newTaskTitle.trim() || isPending}
                className="flex-1 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-40">
                追加する
              </button>
            </div>
          </div>
        )}

        {/* ── 自分のタスクタブ ── */}
        {tab === "my" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">自分のタスク</p>
              <div className="flex gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleTriggerExtract}
                    disabled={isPending || taskGroups.filter(g => g.enabled).length === 0}
                    className="px-3 py-1.5 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-40 transition-colors"
                  >
                    {isPending ? "抽出中…" : "今すぐ抽出"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowAddTask(v => !v)}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
                >
                  ＋ 追加
                </button>
              </div>
            </div>

            {myTasks.length === 0 ? (
              <div className="text-center py-10 text-zinc-400">
                <p className="text-sm font-semibold">自分に割り当てられたタスクはありません</p>
                <p className="text-xs mt-1">LINEメッセージの @{myStaffId.toLowerCase()} 宛てが自動登録されます</p>
              </div>
            ) : (
              <div className="space-y-2">
                {myTasks.map(task => <TaskCard key={task.id} task={task} />)}
              </div>
            )}
          </>
        )}

        {/* ── 全体タブ ── */}
        {tab === "pending" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">未完了タスク一覧</p>
              <div className="flex gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleTriggerExtract}
                    disabled={isPending || taskGroups.filter(g => g.enabled).length === 0}
                    className="px-3 py-1.5 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-40 transition-colors"
                  >
                    {isPending ? "抽出中…" : "今すぐ抽出"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowAddTask(v => !v)}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
                >
                  ＋ 追加
                </button>
              </div>
            </div>

            {pendingTasks.length === 0 ? (
              <div className="text-center py-12 text-zinc-400">
                <p className="text-sm font-semibold">未完了タスクはありません</p>
                <p className="text-xs mt-1">LINEグループのやり取りから自動抽出されます</p>
              </div>
            ) : (
              <>
                {/* 自分のタスク */}
                {myTasks.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mt-1">自分のタスク</p>
                    <div className="space-y-2">
                      {myTasks.map(task => <TaskCard key={task.id} task={task} />)}
                    </div>
                  </>
                )}
                {/* その他のタスク */}
                {otherTasks.length > 0 && (
                  <>
                    {myTasks.length > 0 && (
                      <p className="text-xs font-semibold text-zinc-400 mt-3">その他のタスク</p>
                    )}
                    <div className="space-y-2">
                      {otherTasks.map(task => <TaskCard key={task.id} task={task} />)}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ── 完了済タブ ── */}
        {tab === "done" && (
          <>
            {doneTasks.length === 0 ? (
              <div className="text-center py-12 text-zinc-400">
                <p className="text-sm font-semibold">完了済みタスクはありません</p>
              </div>
            ) : (
              <div className="space-y-2">
                {doneTasks.map(task => <TaskCard key={task.id} task={task} />)}
              </div>
            )}
          </>
        )}

        {/* ── 設定タブ ── */}
        {tab === "settings" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">対象グループ</p>
                <p className="text-xs text-zinc-400 mt-0.5">タスク抽出するLINEグループを設定します</p>
              </div>
              <button type="button" onClick={() => setShowAddGroup(!showAddGroup)}
                className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors">
                ＋ 追加
              </button>
            </div>

            {showAddGroup && (
              <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-3 space-y-2">
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold">グループID *</label>
                  <input type="text" value={newGroupId} onChange={e => setNewGroupId(e.target.value)}
                    placeholder="C1234567890abcdef..."
                    className={`${inputCls} mt-0.5 font-mono text-xs`} />
                  <p className="text-[10px] text-zinc-400 mt-1">LINE Developerコンソール or Webhookログで確認できます</p>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold">グループ名（任意）</label>
                  <input type="text" value={newGroupLabel} onChange={e => setNewGroupLabel(e.target.value)}
                    placeholder="例：現場スタッフグループ"
                    className={`${inputCls} mt-0.5`} />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowAddGroup(false)}
                    className="flex-1 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500">
                    キャンセル
                  </button>
                  <button type="button" onClick={handleAddGroup} disabled={!newGroupId.trim() || isPending}
                    className="flex-1 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-40">
                    追加する
                  </button>
                </div>
              </div>
            )}

            {/* Botが参加中で未登録のグループを自動検出 */}
            {discoveredGroups.length > 0 && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-3 space-y-2">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  検出済みグループ（未登録）
                </p>
                <p className="text-[11px] text-amber-600 dark:text-amber-500">
                  Botが参加しているグループです。タスク抽出対象にするには「登録」してください。
                </p>
                {discoveredGroups.map(g => (
                  <div key={g.group_id} className="flex items-center gap-2">
                    <p className="text-[11px] font-mono text-zinc-500 flex-1 truncate">{g.group_id}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setNewGroupId(g.group_id);
                        setShowAddGroup(true);
                      }}
                      className="flex-shrink-0 text-[11px] px-2.5 py-1 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                    >
                      登録
                    </button>
                  </div>
                ))}
              </div>
            )}

            {taskGroups.length === 0 && discoveredGroups.length === 0 ? (
              <div className="text-center py-8 text-zinc-400">
                <p className="text-sm">対象グループが設定されていません</p>
                <p className="text-xs mt-1">Botをグループに追加すると自動検出されます</p>
              </div>
            ) : taskGroups.length === 0 ? null : (
              <div className="space-y-2">
                {taskGroups.map(g => (
                  <div key={g.id} className="flex items-center gap-3 px-3 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                    <button type="button"
                      onClick={() => startTransition(() => toggleTaskGroupAction(g.id, !g.enabled).then(() => {}))}
                      className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 relative ${
                        g.enabled ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-600"
                      }`}>
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        g.enabled ? "translate-x-4" : "translate-x-0.5"
                      }`} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                        {g.group_label ?? "名称未設定"}
                      </p>
                      <p className="text-[11px] text-zinc-400 font-mono truncate">{g.group_id}</p>
                    </div>
                    <button type="button"
                      onClick={() => startTransition(() => deleteTaskGroupAction(g.id).then(() => {}))}
                      className="text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 p-3 space-y-1">
              <p className="text-xs font-semibold text-zinc-500">自動抽出について</p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                対象グループに設定されたLINEグループの発言を5分おきに解析し、「お願い」「してください」などキーワードを含む発言をタスクとして自動登録します。<br />
                「今すぐ抽出」ボタンで手動実行も可能です。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
