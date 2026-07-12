"use client";

/**
 * タスク管理（管理者専用）
 *  - リスト: ステータス別のタスク一覧
 *  - タイムライン: 月単位のガントチャート（開始日〜期日のバー・進捗%塗り）
 *  - LINE取込み: LINEグループから自動抽出されたタスク候補を取込み/却下
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveProjectTaskAction,
  deleteProjectTaskAction,
  importGroupTaskAction,
  updateTaskStatusAction,
  addTaskNoteAction,
} from "./actions";

// ── 旧型（dashboard/MyTasksWidget が import しているため維持） ──────────────
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
  source_messages: { sent_at: string; user_id: string; sender?: string | null; text: string }[] | null;
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

export type NameMapping = {
  id: string;
  rawName: string;
  staffId: string;
  staffName: string;
};

// ── 新タスク型 ──────────────────────────────────────────────
export type TaskNote = {
  id: string;
  body: string;
  progress: number | null;
  markDone: boolean;
  authorName: string;
  createdAt: string;
};

export type ProjectTask = {
  id: string;
  title: string;
  description: string | null;
  assigneeStaffId: string | null;
  assigneeName: string | null;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  status: "todo" | "in_progress" | "done";
  priority: "high" | "normal" | "low";
  createdAt: string;
  completedAt: string | null;
  notes: TaskNote[];
};

type Tab = "list" | "timeline" | "inbox";

const STATUS_LABEL: Record<ProjectTask["status"], string> = {
  todo: "未着手", in_progress: "作業中", done: "完了",
};
const STATUS_CHIP: Record<ProjectTask["status"], string> = {
  todo:        "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  in_progress: "bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
  done:        "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
};
const PRIORITY_LABEL: Record<ProjectTask["priority"], string> = {
  high: "高", normal: "中", low: "低",
};
const PRIORITY_CLS: Record<ProjectTask["priority"], string> = {
  high:   "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400",
  normal: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  low:    "bg-sky-50 text-sky-500 dark:bg-sky-950/40 dark:text-sky-400",
};

function fmtMD(d: string): string {
  const [, m, day] = d.split("-");
  return `${parseInt(m)}/${parseInt(day)}`;
}

/** "YYYY-MM" の日数（TZ非依存） */
function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "YYYY-MM" ± n ヶ月 */
function addMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 曜日（TZ非依存・hydration地雷対策で getUTCDay） */
function dowOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_W = 28;

export default function TasksClient({
  projectId,
  projectName,
  today,
  tasks,
  candidates,
  staffOptions,
}: {
  projectId: string;
  projectName?: string;
  today: string; // JST YYYY-MM-DD（サーバー算出・hydration対策）
  tasks: ProjectTask[];
  candidates: GroupTask[];
  staffOptions: StaffOption[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("list");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [editing, setEditing] = useState<ProjectTask | null | "new">(null);
  const [prefill, setPrefill] = useState<(Partial<ProjectTask> & { sourceGroupTaskId?: string }) | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openTasks = tasks.filter(t => t.status !== "done");
  const overdueCount = openTasks.filter(t => t.dueDate && t.dueDate < today).length;
  const detailTask = detailId ? (tasks.find(t => t.id === detailId) ?? null) : null;

  function handleDeleteTask(t: ProjectTask) {
    if (isPending) return;
    if (!window.confirm(`タスク「${t.title}」を削除しますか？\n作業メモも一緒に消えます。`)) return;
    setErrorMsg(null);
    startTransition(async () => {
      const res = await deleteProjectTaskAction(projectId, t.id);
      if (!res.success) setErrorMsg(res.message ?? "削除できませんでした");
      setDetailId(null);
      router.refresh();
    });
  }

  function handleImport(c: GroupTask) {
    // 取込み前に内容を編集できるようモーダルを開く
    setPrefill({
      title: c.title,
      description: c.description,
      assigneeStaffId: c.assignee_staff_id,
      dueDate: c.due_date,
      sourceGroupTaskId: c.id,
    });
    setEditing("new");
  }

  function handleQuickImport(c: GroupTask) {
    setBusyId(c.id);
    setErrorMsg(null);
    startTransition(async () => {
      const res = await importGroupTaskAction(projectId, c.id);
      if (!res.success) setErrorMsg(res.message ?? "取込みに失敗しました");
      setBusyId(null);
      router.refresh();
    });
  }

  function handleDismiss(c: GroupTask) {
    setBusyId(c.id);
    setErrorMsg(null);
    startTransition(async () => {
      await updateTaskStatusAction(c.id, "dismissed");
      setBusyId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 py-5">
      {/* ヘッダー */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">タスク管理</h1>
          {projectName && <p className="text-sm font-semibold text-zinc-400 mt-0.5">{projectName}</p>}
        </div>
        <button
          type="button"
          onClick={() => { setPrefill(null); setEditing("new"); }}
          className="shrink-0 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-colors"
        >＋ 新規タスク</button>
      </div>

      {/* サマリー */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard label="未完了" value={openTasks.length} accent="text-zinc-900 dark:text-zinc-100" />
        <SummaryCard label="本日期日" value={openTasks.filter(t => t.dueDate === today).length} accent="text-blue-600 dark:text-blue-400" />
        <SummaryCard label="期限超過" value={overdueCount} accent={overdueCount > 0 ? "text-red-500" : "text-zinc-900 dark:text-zinc-100"} />
      </div>

      {/* タブ */}
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {([
          ["list", "リスト"],
          ["timeline", "タイムライン"],
          ["inbox", `LINE取込み${candidates.length > 0 ? ` (${candidates.length})` : ""}`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={[
              "px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
            ].join(" ")}
          >{label}</button>
        ))}
      </div>

      {errorMsg && (
        <p className="text-xs font-medium px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/20 text-red-500">✗ {errorMsg}</p>
      )}

      {/* ── リスト ── */}
      {tab === "list" && (
        <div className="space-y-4">
          {(["in_progress", "todo", "done"] as ProjectTask["status"][]).map(st => {
            const group = tasks.filter(t => t.status === st);
            if (group.length === 0) return null;
            return (
              <section key={st}>
                <h2 className="text-xs font-bold text-zinc-400 mb-1.5">{STATUS_LABEL[st]}（{group.length}）</h2>
                <div className="space-y-1.5">
                  {group.map(t => (
                    <TaskRow key={t.id} task={t} today={today}
                      onClick={() => setDetailId(t.id)}
                      onEdit={() => { setPrefill(null); setEditing(t); }}
                      onDelete={() => handleDeleteTask(t)} />
                  ))}
                </div>
              </section>
            );
          })}
          {tasks.length === 0 && (
            <p className="text-sm text-zinc-400 text-center py-12">タスクがありません。「＋ 新規タスク」から追加してください。</p>
          )}
        </div>
      )}

      {/* ── タイムライン ── */}
      {tab === "timeline" && (
        <TimelineView tasks={tasks} month={month} today={today}
          onMonthChange={setMonth}
          onTaskClick={t => setDetailId(t.id)} />
      )}

      {/* ── LINE取込み ── */}
      {tab === "inbox" && (
        <div className="space-y-1.5">
          <p className="text-xs text-zinc-400">
            LINEグループの会話から自動抽出されたタスク候補です。「取込む」で内容を確認してタスク管理に追加できます。
          </p>
          {candidates.map(c => (
            <div key={c.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{c.title}</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {c.group_label ?? "グループ"}
                    {c.assignee_name ? ` ／ 担当候補: ${c.assignee_name}` : c.assignee_raw ? ` ／ 担当候補: ${c.assignee_raw}` : ""}
                    {c.due_date ? ` ／ 期日候補: ${fmtMD(c.due_date)}` : ""}
                  </p>
                  {c.description && <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{c.description}</p>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button type="button" disabled={busyId === c.id || isPending}
                    onClick={() => handleImport(c)}
                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                  >取込む</button>
                  <button type="button" disabled={busyId === c.id || isPending}
                    onClick={() => handleQuickImport(c)}
                    className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                    title="編集せずそのまま取込む"
                  >即取込</button>
                  <button type="button" disabled={busyId === c.id || isPending}
                    onClick={() => handleDismiss(c)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 hover:text-red-500 disabled:opacity-50 transition-colors"
                  >却下</button>
                </div>
              </div>
            </div>
          ))}
          {candidates.length === 0 && (
            <p className="text-sm text-zinc-400 text-center py-12">取込み待ちの候補はありません</p>
          )}
        </div>
      )}

      {/* タスク詳細（作業メモ履歴） */}
      {detailTask && (
        <TaskDetailModal
          projectId={projectId}
          task={detailTask}
          onClose={() => setDetailId(null)}
          onEdit={() => { setPrefill(null); setEditing(detailTask); }}
          onDelete={() => handleDeleteTask(detailTask)}
          onChanged={() => router.refresh()}
        />
      )}

      {/* 作成・編集モーダル */}
      {editing !== null && (
        <TaskModal
          projectId={projectId}
          task={editing === "new" ? null : editing}
          prefill={editing === "new" ? prefill : null}
          staffOptions={staffOptions}
          onClose={() => { setEditing(null); setPrefill(null); }}
          onSaved={() => { setEditing(null); setPrefill(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ── サマリーカード ──────────────────────────────────────────
function SummaryCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2.5">
      <p className="text-[11px] font-semibold text-zinc-400">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${accent}`}>{value}<span className="text-xs font-semibold ml-0.5">件</span></p>
    </div>
  );
}

// ── リスト行 ────────────────────────────────────────────────
function TaskRow({ task, today, onClick, onEdit, onDelete }: {
  task: ProjectTask;
  today: string;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const overdue = task.status !== "done" && !!task.dueDate && task.dueDate < today;
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
      <button type="button" onClick={onClick} className="w-full text-left px-3.5 sm:px-4 pt-3 pb-1.5">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${PRIORITY_CLS[task.priority]}`}>
            {PRIORITY_LABEL[task.priority]}
          </span>
          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_CHIP[task.status]}`}>
            {STATUS_LABEL[task.status]}
          </span>
          <p className={`text-sm font-semibold truncate flex-1 min-w-0 ${task.status === "done" ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-100"}`}>
            {task.title}
          </p>
          <span className={`shrink-0 text-[11px] font-semibold tabular-nums hidden sm:inline ${overdue ? "text-red-500" : "text-zinc-400"}`}>
            {task.dueDate ? `${overdue ? "⚠ " : ""}〜${fmtMD(task.dueDate)}` : "期日なし"}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[11px] text-zinc-400 shrink-0 max-w-[6rem] truncate">
            {task.assigneeName ?? "担当未定"}
          </span>
          <span className={`shrink-0 text-[11px] font-semibold tabular-nums sm:hidden ${overdue ? "text-red-500" : "text-zinc-400"}`}>
            {task.dueDate ? `${overdue ? "⚠" : ""}〜${fmtMD(task.dueDate)}` : "期日なし"}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden min-w-[3rem]">
            <div
              className={`h-full rounded-full ${task.status === "done" ? "bg-emerald-500" : overdue ? "bg-red-400" : "bg-blue-500"}`}
              style={{ width: `${task.status === "done" ? 100 : task.progress}%` }}
            />
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-zinc-500 shrink-0 w-9 text-right">
            {task.status === "done" ? 100 : task.progress}%
          </span>
        </div>
      </button>
      {(onEdit || onDelete) && (
        <div className="flex items-center justify-between px-3.5 sm:px-4 pb-2">
          <button type="button" onClick={onClick}
            className="text-[11px] font-semibold text-zinc-400 hover:text-blue-500 transition-colors">
            💬 メモ {task.notes.length}件
          </button>
          <div className="flex gap-1">
            {onEdit && (
              <button type="button" onClick={e => { e.stopPropagation(); onEdit(); }}
                className="px-2 py-1 rounded-lg text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >✎ 編集</button>
            )}
            {onDelete && (
              <button type="button" onClick={e => { e.stopPropagation(); onDelete(); }}
                className="px-2 py-1 rounded-lg text-[11px] font-semibold text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >削除</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── タスク詳細（作業メモ履歴） ──────────────────────────────
function fmtNoteAt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function TaskDetailModal({
  projectId, task, onClose, onEdit, onDelete, onChanged,
}: {
  projectId: string;
  task: ProjectTask;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [body, setBody] = useState("");
  const [progress, setProgress] = useState(task.progress);
  const [markDone, setMarkDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const notesDesc = [...task.notes].reverse();

  function handleAddNote() {
    if (isPending || !body.trim()) return;
    setMsg(null);
    startTransition(async () => {
      const res = await addTaskNoteAction({
        projectId,
        taskId: task.id,
        body,
        progress: markDone ? 100 : (progress !== task.progress ? progress : null),
        markDone,
      });
      if (res.success) {
        setBody("");
        setMarkDone(false);
        onChanged();
      } else {
        setMsg(res.message ?? "メモを保存できませんでした");
      }
    });
  }

  const period = [task.startDate ? fmtMD(task.startDate) : null, task.dueDate ? fmtMD(task.dueDate) : null];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92dvh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* ヘッダー */}
        <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_CHIP[task.status]}`}>{STATUS_LABEL[task.status]}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${PRIORITY_CLS[task.priority]}`}>優先度{PRIORITY_LABEL[task.priority]}</span>
              </div>
              <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100 mt-1 break-words">{task.title}</h2>
            </div>
            <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-lg leading-none shrink-0">✕</button>
          </div>
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2 text-[11px] text-zinc-500">
            <span>担当: <b className="text-zinc-700 dark:text-zinc-200">{task.assigneeName ?? "未定"}</b></span>
            <span>期間: <b className="text-zinc-700 dark:text-zinc-200 tabular-nums">{period[0] ?? "—"} 〜 {period[1] ?? "—"}</b></span>
            <span className="flex items-center gap-1.5 flex-1 min-w-[7rem]">
              <span className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <span className={`block h-full rounded-full ${task.status === "done" ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${task.progress}%` }} />
              </span>
              <b className="tabular-nums text-zinc-700 dark:text-zinc-200">{task.progress}%</b>
            </span>
          </div>
          {task.description && (
            <p className="text-xs text-zinc-500 mt-2 whitespace-pre-wrap break-words">{task.description}</p>
          )}
          <div className="flex gap-1.5 mt-2.5">
            <button type="button" onClick={onEdit}
              className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >✎ 編集（担当・期間）</button>
            <button type="button" onClick={onDelete} disabled={isPending}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 transition-colors"
            >削除</button>
          </div>
        </div>

        {/* メモ履歴 */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3 space-y-2 min-h-[8rem]">
          <p className="text-[11px] font-bold text-zinc-400">作業メモ（{task.notes.length}件）</p>
          {notesDesc.map(n => (
            <div key={n.id} className="rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">{n.authorName}</span>
                <span className="text-[10px] text-zinc-400 tabular-nums">{fmtNoteAt(n.createdAt)}</span>
                {n.progress != null && !n.markDone && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 tabular-nums">進捗 {n.progress}%</span>
                )}
                {n.markDone && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">✓ 完了</span>
                )}
              </div>
              <p className="text-xs text-zinc-700 dark:text-zinc-200 mt-1 whitespace-pre-wrap break-words">{n.body}</p>
            </div>
          ))}
          {task.notes.length === 0 && (
            <p className="text-xs text-zinc-400 text-center py-6">まだメモがありません（メモを残すと「作業中」になります）</p>
          )}
        </div>

        {/* メモ入力 */}
        <div className="px-4 sm:px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 shrink-0 space-y-2">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={2}
            placeholder="何をしたかをメモ（例: 〇〇へ連絡済み・資料半分作成）"
            className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <label className={`flex items-center gap-1.5 flex-1 min-w-[9rem] ${markDone ? "opacity-40" : ""}`}>
              <span className="text-[11px] font-bold text-zinc-400 shrink-0 tabular-nums w-14">進捗 {markDone ? 100 : progress}%</span>
              <input type="range" min={0} max={100} step={5}
                value={markDone ? 100 : progress}
                disabled={markDone}
                onChange={e => setProgress(Number(e.target.value))}
                className="flex-1 accent-blue-600" />
            </label>
            <label className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0 cursor-pointer">
              <input type="checkbox" checked={markDone} onChange={e => setMarkDone(e.target.checked)} className="accent-emerald-600" />
              完了にする
            </label>
            <button type="button" onClick={handleAddNote} disabled={isPending || !body.trim()}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold transition-colors shrink-0"
            >{isPending ? "保存中…" : "メモを記録"}</button>
          </div>
          {msg && <p className="text-xs font-medium px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/20 text-red-500">✗ {msg}</p>}
        </div>
      </div>
    </div>
  );
}

// ── タイムライン（ガント） ──────────────────────────────────
function TimelineView({
  tasks, month, today, onMonthChange, onTaskClick,
}: {
  tasks: ProjectTask[];
  month: string;
  today: string;
  onMonthChange: (m: string) => void;
  onTaskClick: (t: ProjectTask) => void;
}) {
  const days = daysInMonth(month);
  const dates = useMemo(
    () => Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
    [month, days],
  );

  // この月に表示するタスク: 開始日〜期日が月と重なるもの（片方のみの場合は1日バー）
  const rows = tasks
    .map(t => {
      const s = t.startDate ?? t.dueDate;
      const e = t.dueDate ?? t.startDate;
      if (!s || !e) return null;
      const monthStart = dates[0];
      const monthEnd = dates[days - 1];
      if (e < monthStart || s > monthEnd) return null;
      const startIdx = s < monthStart ? 0 : parseInt(s.slice(8), 10) - 1;
      const endIdx = e > monthEnd ? days - 1 : parseInt(e.slice(8), 10) - 1;
      return { task: t, startIdx, endIdx, clipL: s < monthStart, clipR: e > monthEnd };
    })
    .filter(Boolean) as { task: ProjectTask; startIdx: number; endIdx: number; clipL: boolean; clipR: boolean }[];

  const noDateTasks = tasks.filter(t => !t.startDate && !t.dueDate && t.status !== "done");
  const LABEL_W = 148;

  return (
    <div className="space-y-3">
      {/* 月ナビ */}
      <div className="flex items-center justify-center gap-3">
        <button type="button" onClick={() => onMonthChange(addMonth(month, -1))}
          className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">◀</button>
        <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">
          {month.replace("-", "年")}月
        </p>
        <button type="button" onClick={() => onMonthChange(addMonth(month, 1))}
          className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">▶</button>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <div style={{ minWidth: LABEL_W + days * DAY_W }}>
            {/* ヘッダー行 */}
            <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
              <div className="sticky left-0 z-20 bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-[11px] font-semibold text-zinc-500 shrink-0" style={{ width: LABEL_W }}>
                タスク
              </div>
              {dates.map((d, i) => {
                const dow = dowOf(d);
                return (
                  <div key={d}
                    className={[
                      "shrink-0 text-center py-1.5 border-r border-zinc-100 dark:border-zinc-800",
                      d === today ? "bg-blue-100 dark:bg-blue-900/40" : dow === 0 ? "bg-red-50/60 dark:bg-red-950/20" : dow === 6 ? "bg-sky-50/60 dark:bg-sky-950/20" : "",
                    ].join(" ")}
                    style={{ width: DAY_W }}
                  >
                    <p className={`text-[10px] font-bold tabular-nums leading-none ${d === today ? "text-blue-600 dark:text-blue-300" : dow === 0 ? "text-red-400" : dow === 6 ? "text-sky-500" : "text-zinc-500"}`}>{i + 1}</p>
                    <p className={`text-[8px] leading-none mt-0.5 ${dow === 0 ? "text-red-300" : dow === 6 ? "text-sky-300" : "text-zinc-300 dark:text-zinc-600"}`}>{WD[dow]}</p>
                  </div>
                );
              })}
            </div>

            {/* タスク行 */}
            {rows.map(({ task, startIdx, endIdx, clipL, clipR }) => {
              const overdue = task.status !== "done" && !!task.dueDate && task.dueDate < today;
              const barCls =
                task.status === "done" ? "bg-emerald-500/80"
                : overdue ? "bg-red-500/80"
                : task.status === "in_progress" ? "bg-blue-500/80"
                : "bg-zinc-400/80 dark:bg-zinc-500/80";
              return (
                <div key={task.id} className="flex border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30">
                  <button type="button" onClick={() => onTaskClick(task)}
                    className="sticky left-0 z-10 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 px-2 py-2 text-left shrink-0"
                    style={{ width: LABEL_W }}
                  >
                    <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 truncate">{task.title}</p>
                    <p className="text-[10px] text-zinc-400 truncate">{task.assigneeName ?? "担当未定"}</p>
                  </button>
                  <div className="relative shrink-0" style={{ width: days * DAY_W, height: 44 }}>
                    {/* 今日の縦帯 */}
                    {today.slice(0, 7) === month && (
                      <div className="absolute top-0 bottom-0 bg-blue-300/40 dark:bg-blue-500/20 pointer-events-none"
                        style={{ left: (parseInt(today.slice(8), 10) - 1) * DAY_W, width: DAY_W }} />
                    )}
                    {/* バー */}
                    <button type="button" onClick={() => onTaskClick(task)}
                      className={`absolute top-2.5 h-6 ${barCls} ${clipL ? "rounded-l-none" : "rounded-l-lg"} ${clipR ? "rounded-r-none" : "rounded-r-lg"} overflow-hidden`}
                      style={{ left: startIdx * DAY_W + 1, width: (endIdx - startIdx + 1) * DAY_W - 2 }}
                      title={`${task.title}（${task.progress}%）`}
                    >
                      <span className="absolute inset-y-0 left-0 bg-black/25"
                        style={{ width: `${task.status === "done" ? 100 : task.progress}%` }} />
                      <span className="relative z-10 px-1.5 text-[10px] font-bold text-white whitespace-nowrap">
                        {task.status === "done" ? "✓" : `${task.progress}%`}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && (
              <p className="text-sm text-zinc-400 text-center py-10">この月に日付が設定されたタスクはありません</p>
            )}
          </div>
        </div>
      </div>

      {noDateTasks.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-zinc-400 mb-1.5">日付未設定（タイムライン非表示）</h3>
          <div className="space-y-1.5">
            {noDateTasks.map(t => (
              <TaskRow key={t.id} task={t} today={today} onClick={() => onTaskClick(t)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 作成・編集モーダル ──────────────────────────────────────
function TaskModal({
  projectId, task, prefill, staffOptions, onClose, onSaved,
}: {
  projectId: string;
  task: ProjectTask | null;
  prefill: (Partial<ProjectTask> & { sourceGroupTaskId?: string }) | null;
  staffOptions: StaffOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? prefill?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? prefill?.description ?? "");
  const [assignee, setAssignee] = useState(task?.assigneeStaffId ?? prefill?.assigneeStaffId ?? "");
  const [startDate, setStartDate] = useState(task?.startDate ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? prefill?.dueDate ?? "");
  const [priority, setPriority] = useState<ProjectTask["priority"]>(task?.priority ?? "normal");
  const [msg, setMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    if (isPending) return;
    setMsg(null);
    startTransition(async () => {
      // ステータス・進捗は作業メモから自動更新されるためここでは送らない
      const res = await saveProjectTaskAction({
        projectId,
        id: task?.id ?? null,
        title, description,
        assigneeStaffId: assignee || null,
        startDate: startDate || null,
        dueDate: dueDate || null,
        priority,
        sourceGroupTaskId: prefill?.sourceGroupTaskId ?? null,
      });
      if (res.success) {
        // LINE抽出からの取込みの場合は元候補を完了扱いにして受信箱から消す
        if (prefill?.sourceGroupTaskId) {
          await updateTaskStatusAction(prefill.sourceGroupTaskId, "done");
        }
        onSaved();
      } else {
        setMsg(res.message ?? "保存できませんでした");
      }
    });
  }

  function handleDelete() {
    if (!task || isPending) return;
    if (!window.confirm(`タスク「${task.title}」を削除しますか？`)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await deleteProjectTaskAction(projectId, task.id);
      if (res.success) onSaved();
      else setMsg(res.message ?? "削除できませんでした");
    });
  }

  const inputCls = "w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition";
  const labelCls = "text-[11px] font-bold text-zinc-400 block mb-1";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90dvh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0 flex items-center justify-between">
          <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">
            {task ? "タスクを編集" : "新規タスク"}
          </h2>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-lg leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-3.5 overflow-y-auto">
          <div>
            <label className={labelCls}>タイトル *</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="例: 7月シフトの確定" />
          </div>
          <div>
            <label className={labelCls}>詳細</label>
            <textarea value={description ?? ""} onChange={e => setDescription(e.target.value)} rows={3} className={inputCls} placeholder="補足・手順など（任意）" />
          </div>
          <div>
            <label className={labelCls}>担当者</label>
            <select value={assignee} onChange={e => setAssignee(e.target.value)} className={inputCls}>
              <option value="">担当未定</option>
              {staffOptions.map(s => <option key={s.staffId} value={s.staffId}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>開始日</label>
              <input type="date" value={startDate ?? ""} onChange={e => setStartDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>期日</label>
              <input type="date" value={dueDate ?? ""} onChange={e => setDueDate(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>優先度</label>
            <select value={priority} onChange={e => setPriority(e.target.value as ProjectTask["priority"])} className={inputCls}>
              <option value="high">高</option>
              <option value="normal">中</option>
              <option value="low">低</option>
            </select>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            ステータスと進捗はタスクを開いて「作業メモ」を記録すると自動で更新されます（メモなし=未着手／メモあり=作業中／完了メモ=完了）。
          </p>
          {msg && <p className="text-xs font-medium px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/20 text-red-500">✗ {msg}</p>}
        </div>

        <div className="px-5 py-3.5 border-t border-zinc-100 dark:border-zinc-800 shrink-0 flex items-center gap-2">
          {task && (
            <button type="button" onClick={handleDelete} disabled={isPending}
              className="px-3 py-2 rounded-xl text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 transition-colors"
            >削除</button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >キャンセル</button>
          <button type="button" onClick={handleSave} disabled={isPending || !title.trim()}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold transition-colors"
          >{isPending ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </div>
  );
}
