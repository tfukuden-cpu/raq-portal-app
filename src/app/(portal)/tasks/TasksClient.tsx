"use client";

/**
 * タスク管理（管理者専用）
 *  - リスト: 未着手/作業中/完了の3レーンかんばん（モバイルは縦積み）
 *  - タイムライン: 月単位のガントチャート（開始日〜期日のバー・進捗%塗り）
 *  - タスク押下=作業メモ履歴（メモでステータス・進捗を自動更新）
 */

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  saveProjectTaskAction,
  deleteProjectTaskAction,
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
  category: string | null;
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

type Tab = "list" | "timeline";

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
  high:   "bg-red-50 text-red-500 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900",
  normal: "bg-zinc-50 text-zinc-500 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
  low:    "bg-sky-50 text-sky-500 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-900",
};

function fmtMD(d: string): string {
  const [, m, day] = d.split("-");
  return `${parseInt(m)}/${parseInt(day)}`;
}

// カテゴリ名から決定的に色を割り当てる（同じ名前は常に同じ色）
const CATEGORY_PALETTE = [
  "bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-900",
  "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
  "bg-teal-50 text-teal-600 border-teal-200 dark:bg-teal-950/40 dark:text-teal-400 dark:border-teal-900",
  "bg-pink-50 text-pink-600 border-pink-200 dark:bg-pink-950/40 dark:text-pink-400 dark:border-pink-900",
  "bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-900",
  "bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-900",
  "bg-cyan-50 text-cyan-600 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-400 dark:border-cyan-900",
  "bg-lime-50 text-lime-600 border-lime-200 dark:bg-lime-950/40 dark:text-lime-500 dark:border-lime-900",
];
function categoryCls(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}
function CategoryChip({ name }: { name: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${categoryCls(name)}`}>
      🏷 {name}
    </span>
  );
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
const DAY_W = 30;

export default function TasksClient({
  projectId,
  projectName,
  today,
  tasks,
  staffOptions,
}: {
  projectId: string;
  projectName?: string;
  today: string; // JST YYYY-MM-DD（サーバー算出・hydration対策）
  tasks: ProjectTask[];
  staffOptions: StaffOption[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("list");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [editing, setEditing] = useState<ProjectTask | null | "new">(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openTasks = tasks.filter(t => t.status !== "done");
  const dueTodayCount = openTasks.filter(t => t.dueDate === today).length;
  const overdueCount = openTasks.filter(t => t.dueDate && t.dueDate < today).length;
  const detailTask = detailId ? (tasks.find(t => t.id === detailId) ?? null) : null;

  // 既存カテゴリ一覧（入力候補・絞り込みチップに使用）
  const categories = useMemo(
    () => [...new Set(tasks.map(t => t.category).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ja")),
    [tasks],
  );
  const visibleTasks = categoryFilter
    ? tasks.filter(t => t.category === categoryFilter)
    : tasks;

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

  return (
    <div className="space-y-5 py-6">
      {/* ヘッダー */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">タスク管理</h1>
          {projectName && <p className="text-sm font-semibold text-zinc-400 mt-0.5">{projectName}</p>}
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="shrink-0 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-sm font-bold shadow-sm shadow-blue-600/20 transition-all"
        >＋ 新規タスク</button>
      </div>

      {/* タブ（セグメント）＋ 統計 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-xl bg-zinc-200/70 dark:bg-zinc-800 p-1">
          {([["list", "ボード"], ["timeline", "タイムライン"]] as [Tab, string][]).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={[
                "px-4 py-1.5 rounded-lg text-[13px] font-bold transition-all",
                tab === key
                  ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
              ].join(" ")}
            >{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatPill dot="bg-zinc-400" label="未完了" value={openTasks.length} />
          <StatPill dot="bg-blue-500" label="本日期日" value={dueTodayCount} />
          <StatPill dot={overdueCount > 0 ? "bg-red-500" : "bg-zinc-300 dark:bg-zinc-600"} label="期限超過" value={overdueCount} alert={overdueCount > 0} />
        </div>
      </div>

      {/* カテゴリ絞り込み */}
      {categories.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button type="button" onClick={() => setCategoryFilter(null)}
            className={[
              "px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors",
              categoryFilter === null
                ? "bg-zinc-800 text-white border-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                : "bg-white text-zinc-500 border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800",
            ].join(" ")}
          >すべて</button>
          {categories.map(c => (
            <button key={c} type="button"
              onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
              className={[
                "px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all",
                categoryFilter === c ? `${categoryCls(c)} ring-2 ring-blue-400/60` : `${categoryCls(c)} opacity-70 hover:opacity-100`,
              ].join(" ")}
            >🏷 {c}</button>
          ))}
        </div>
      )}

      {errorMsg && (
        <p className="text-xs font-medium px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/20 text-red-500">✗ {errorMsg}</p>
      )}

      {/* ── ボード（PC=3レーン / モバイル=縦積み） ── */}
      {tab === "list" && (
        tasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 py-20 text-center">
            <p className="text-3xl mb-2">📋</p>
            <p className="text-sm font-semibold text-zinc-500">まだタスクがありません</p>
            <p className="text-xs text-zinc-400 mt-1">タスクを作成して、チームの作業を見える化しましょう</p>
            <button type="button" onClick={() => setEditing("new")}
              className="mt-4 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-colors">
              ＋ 最初のタスクを作成
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
            {(["todo", "in_progress", "done"] as ProjectTask["status"][]).map(st => {
              const group = visibleTasks.filter(t => t.status === st);
              const dot =
                st === "todo" ? "bg-zinc-400"
                : st === "in_progress" ? "bg-blue-500"
                : "bg-emerald-500";
              return (
                <KanbanColumn key={st} dot={dot} label={STATUS_LABEL[st]} count={group.length}
                  hint={st === "todo" ? "メモを記録すると作業中へ" : st === "in_progress" ? "完了メモで完了へ" : undefined}>
                  {group.map(t => (
                    <TaskCard key={t.id} task={t} today={today}
                      onClick={() => setDetailId(t.id)}
                      onEdit={() => setEditing(t)}
                      onDelete={() => handleDeleteTask(t)} />
                  ))}
                </KanbanColumn>
              );
            })}
          </div>
        )
      )}

      {/* ── タイムライン ── */}
      {tab === "timeline" && (
        <TimelineView tasks={visibleTasks} month={month} today={today}
          onMonthChange={setMonth}
          onTaskClick={t => setDetailId(t.id)} />
      )}

      {/* タスク詳細（作業メモ履歴） */}
      {detailTask && (
        <TaskDetailModal
          projectId={projectId}
          task={detailTask}
          onClose={() => setDetailId(null)}
          onEdit={() => setEditing(detailTask)}
          onDelete={() => handleDeleteTask(detailTask)}
          onChanged={() => router.refresh()}
        />
      )}

      {/* 作成・編集モーダル */}
      {editing !== null && (
        <TaskModal
          projectId={projectId}
          task={editing === "new" ? null : editing}
          staffOptions={staffOptions}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ── 統計ピル ────────────────────────────────────────────────
function StatPill({ dot, label, value, alert }: { dot: string; label: string; value: number; alert?: boolean }) {
  return (
    <span className={[
      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border",
      alert
        ? "bg-red-50 border-red-200 text-red-600 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400"
        : "bg-white border-zinc-200 text-zinc-500 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-400",
    ].join(" ")}>
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {label}
      <b className={`tabular-nums text-sm ${alert ? "" : "text-zinc-900 dark:text-zinc-100"}`}>{value}</b>
    </span>
  );
}

// ── かんばんレーン ──────────────────────────────────────────
function KanbanColumn({ dot, label, count, hint, children }: {
  dot: string;
  label: string;
  count: number;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-zinc-100 dark:bg-zinc-900/70 border border-zinc-200/60 dark:border-zinc-800 p-2.5 flex flex-col md:min-h-[55vh]">
      <h2 className="flex items-center gap-2 px-1.5 pt-0.5 pb-2.5">
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
        <span className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200">{label}</span>
        <span className="min-w-5 h-5 px-1.5 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[11px] font-bold text-zinc-500 tabular-nums inline-flex items-center justify-center">{count}</span>
      </h2>
      <div className="space-y-2 flex-1">
        {children}
        {count === 0 && (
          <div className="h-full min-h-24 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 flex items-center justify-center">
            <p className="text-[11px] text-zinc-400 px-3 text-center">{hint ?? "タスクなし"}</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ── タスクカード ────────────────────────────────────────────
function TaskCard({ task, today, onClick, onEdit, onDelete, showStatus }: {
  task: ProjectTask;
  today: string;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  showStatus?: boolean;
}) {
  const overdue = task.status !== "done" && !!task.dueDate && task.dueDate < today;
  const progress = task.status === "done" ? 100 : task.progress;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === "Enter") onClick(); }}
      className="group rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-pointer p-3"
    >
      {/* タイトル + アクション */}
      <div className="flex items-start gap-1.5">
        <p className={`text-[13px] font-bold leading-snug flex-1 min-w-0 break-words ${task.status === "done" ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-100"}`}>
          {task.title}
        </p>
        {(onEdit || onDelete) && (
          <span className="flex gap-0.5 shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            {onEdit && (
              <button type="button" title="編集（担当・期間）"
                onClick={e => { e.stopPropagation(); onEdit(); }}
                className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors text-xs"
              >✎</button>
            )}
            {onDelete && (
              <button type="button" title="削除"
                onClick={e => { e.stopPropagation(); onDelete(); }}
                className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors text-xs"
              >🗑</button>
            )}
          </span>
        )}
      </div>

      {/* チップ列 */}
      <div className="flex items-center gap-1 flex-wrap mt-1.5">
        {showStatus && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_CHIP[task.status]}`}>{STATUS_LABEL[task.status]}</span>
        )}
        {task.category && <CategoryChip name={task.category} />}
        <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${PRIORITY_CLS[task.priority]}`}>
          {PRIORITY_LABEL[task.priority]}
        </span>
        {task.dueDate ? (
          <span className={[
            "px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums border",
            overdue
              ? "bg-red-50 text-red-500 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900"
              : task.dueDate === today && task.status !== "done"
              ? "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900"
              : "bg-zinc-50 text-zinc-500 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-700",
          ].join(" ")}>
            {overdue ? "⚠ " : "📅 "}{task.dueDate === today ? "今日" : fmtMD(task.dueDate)}まで
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-zinc-400 border border-dashed border-zinc-300 dark:border-zinc-700">期日なし</span>
        )}
        {task.notes.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold text-zinc-400 bg-zinc-50 border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 tabular-nums">💬 {task.notes.length}</span>
        )}
      </div>

      {/* 担当者 + 進捗 */}
      <div className="flex items-center gap-2 mt-2.5">
        <span className="shrink-0 flex items-center gap-1 max-w-[45%]">
          <span className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-[9px] font-bold flex items-center justify-center shrink-0">
            {task.assigneeName ? task.assigneeName.slice(0, 1) : "？"}
          </span>
          <span className="text-[11px] font-semibold text-zinc-500 truncate">{task.assigneeName ?? "担当未定"}</span>
        </span>
        <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden min-w-8">
          <div
            className={`h-full rounded-full transition-all ${task.status === "done" ? "bg-emerald-500" : overdue ? "bg-red-400" : "bg-blue-500"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[11px] font-bold tabular-nums text-zinc-500 shrink-0">{progress}%</span>
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
  const LABEL_W = 168;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {/* 月ナビ */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
          <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">
            {month.replace("-", "年")}月
          </p>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => onMonthChange(addMonth(month, -1))}
              className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">◀</button>
            <button type="button" onClick={() => onMonthChange(today.slice(0, 7))}
              className="h-8 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">今月</button>
            <button type="button" onClick={() => onMonthChange(addMonth(month, 1))}
              className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">▶</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div style={{ minWidth: LABEL_W + days * DAY_W }}>
            {/* ヘッダー行 */}
            <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
              <div className="sticky left-0 z-20 bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-500 shrink-0" style={{ width: LABEL_W }}>
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
                task.status === "done" ? "bg-emerald-500/85"
                : overdue ? "bg-red-500/85"
                : task.status === "in_progress" ? "bg-blue-500/85"
                : "bg-zinc-400/85 dark:bg-zinc-500/85";
              return (
                <div key={task.id} className="flex border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30">
                  <button type="button" onClick={() => onTaskClick(task)}
                    className="sticky left-0 z-10 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 px-2.5 py-2 text-left shrink-0"
                    style={{ width: LABEL_W }}
                  >
                    <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 truncate">{task.title}</p>
                    <p className="text-[10px] text-zinc-400 truncate">{task.assigneeName ?? "担当未定"}</p>
                  </button>
                  <div className="relative shrink-0" style={{ width: days * DAY_W, height: 46 }}>
                    {/* 週末の背景 */}
                    {dates.map((d, i) => {
                      const dow = dowOf(d);
                      if (dow !== 0 && dow !== 6) return null;
                      return <div key={d} className="absolute top-0 bottom-0 bg-zinc-50/80 dark:bg-zinc-800/30 pointer-events-none" style={{ left: i * DAY_W, width: DAY_W }} />;
                    })}
                    {/* 今日の縦帯 */}
                    {today.slice(0, 7) === month && (
                      <div className="absolute top-0 bottom-0 bg-blue-300/40 dark:bg-blue-500/20 pointer-events-none"
                        style={{ left: (parseInt(today.slice(8), 10) - 1) * DAY_W, width: DAY_W }} />
                    )}
                    {/* バー */}
                    <button type="button" onClick={() => onTaskClick(task)}
                      className={`absolute top-[11px] h-6 ${barCls} ${clipL ? "rounded-l-none" : "rounded-l-lg"} ${clipR ? "rounded-r-none" : "rounded-r-lg"} overflow-hidden shadow-sm`}
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
              <p className="text-sm text-zinc-400 text-center py-12">この月に日付が設定されたタスクはありません</p>
            )}
          </div>
        </div>
      </div>

      {noDateTasks.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-zinc-400 mb-1.5">日付未設定（タイムライン非表示）</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {noDateTasks.map(t => (
              <TaskCard key={t.id} task={t} today={today} showStatus onClick={() => onTaskClick(t)} />
            ))}
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
                {task.category && <CategoryChip name={task.category} />}
                <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${PRIORITY_CLS[task.priority]}`}>優先度{PRIORITY_LABEL[task.priority]}</span>
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

// ── 作成・編集モーダル ──────────────────────────────────────
function TaskModal({
  projectId, task, staffOptions, categories, onClose, onSaved,
}: {
  projectId: string;
  task: ProjectTask | null;
  staffOptions: StaffOption[];
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [category, setCategory] = useState(task?.category ?? "");
  const [assignee, setAssignee] = useState(task?.assigneeStaffId ?? "");
  const [startDate, setStartDate] = useState(task?.startDate ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
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
        category: category || null,
        assigneeStaffId: assignee || null,
        startDate: startDate || null,
        dueDate: dueDate || null,
        priority,
      });
      if (res.success) onSaved();
      else setMsg(res.message ?? "保存できませんでした");
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
            <label className={labelCls}>カテゴリ（フラグ）</label>
            <input type="text" value={category} onChange={e => setCategory(e.target.value)}
              list="task-category-options" maxLength={20}
              className={inputCls} placeholder="例: シフト / 勤怠 / 採用 / 現場対応（自由入力）" />
            <datalist id="task-category-options">
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
            {categories.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap mt-1.5">
                {categories.map(c => (
                  <button key={c} type="button" onClick={() => setCategory(c)}
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border transition-opacity ${categoryCls(c)} ${category === c ? "" : "opacity-60 hover:opacity-100"}`}
                  >🏷 {c}</button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className={labelCls}>担当者（SV）</label>
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

        <div className="px-5 py-3.5 border-t border-zinc-100 dark:border-zinc-800 shrink-0 flex items-center justify-end gap-2">
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
