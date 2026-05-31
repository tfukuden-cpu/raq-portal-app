"use client";

import { useState, useTransition } from "react";
import { fetchNotifyLogsAction, type NotifyLog } from "./notify-history-actions";

// 通知種別の日本語ラベル
const TYPE_LABELS: Record<string, string> = {
  absence:               "欠勤申請",
  tardiness:             "遅刻申請",
  announcement:          "お知らせ",
  inquiry:               "問い合わせ",
  inquiry_reply:         "問い合わせ返信",
  shift_changed:         "シフト変更",
  shift_published:       "シフト展開",
  shift_request:         "追加申請",
  shift_request_result:  "追加申請結果",
  absence_confirm:       "欠勤受付完了",
  correction_result:     "勤怠補正結果",
  clock:                 "打刻",
  rest_day_remind:       "翌日出勤リマインド",
  shift_start_remind:    "出勤前リマインド",
  shift_end_remind:      "退勤打刻リマインド",
  daily_summary:         "日次サマリー",
  holiday_open_notify:   "希望休申請開始",
  holiday_reminder:      "希望休締切リマインド",
  absence_followup_remind: "経過報告リマインド",
  absence_followup_notify: "経過報告受信",
  task_assigned:         "タスク割り当て",
  daily_task_remind:     "タスクリマインド",
};

const TYPE_COLORS: Record<string, string> = {
  absence:               "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  tardiness:             "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  announcement:          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  inquiry:               "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  inquiry_reply:         "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  rest_day_remind:       "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  holiday_open_notify:   "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  absence_followup_remind: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
};

const RECIPIENT_LABELS: Record<string, string> = {
  staff:     "個人",
  group:     "グループ",
  broadcast: "全体",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h  = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${mo}/${da} ${h}:${mi}`;
}

function LogCard({ log }: { log: NotifyLog }) {
  const [expanded, setExpanded] = useState(false);
  const typeLabel = TYPE_LABELS[log.notifyType] ?? log.notifyType;
  const typeColor = TYPE_COLORS[log.notifyType] ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  const lines = log.message.split("\n");
  const preview = lines[0].slice(0, 40) + (lines[0].length > 40 || lines.length > 1 ? "…" : "");

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeColor}`}>
            {typeLabel}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {RECIPIENT_LABELS[log.recipientType]}
          </span>
          {log.recipientName && (
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-medium">
              {log.recipientName}
            </span>
          )}
        </div>
        <span className="text-[10px] text-zinc-400 tabular-nums flex-shrink-0">{formatDateTime(log.sentAt)}</span>
      </div>

      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left"
      >
        {expanded ? (
          <pre className="text-[11px] text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed bg-zinc-50 dark:bg-zinc-800/60 rounded-xl px-3 py-2">
            {log.message}
          </pre>
        ) : (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{preview}</p>
        )}
      </button>
    </div>
  );
}

export default function NotifyHistory({
  initialLogs,
  initialCursor,
}: {
  initialLogs: NotifyLog[];
  initialCursor: string | null;
}) {
  const [logs, setLogs] = useState<NotifyLog[]>(initialLogs);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [isPending, startTransition] = useTransition();

  const loadMore = () => {
    if (!cursor) return;
    startTransition(async () => {
      const { logs: more, nextCursor } = await fetchNotifyLogsAction(cursor);
      setLogs(prev => [...prev, ...more]);
      setCursor(nextCursor);
    });
  };

  if (logs.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-zinc-400">
        通知履歴がありません
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {logs.map(log => (
        <LogCard key={log.id} log={log} />
      ))}

      {cursor && (
        <div className="pt-2 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={isPending}
            className="px-5 py-2 rounded-xl text-sm font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 disabled:opacity-40 transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-700"
          >
            {isPending ? "読み込み中…" : "さらに読み込む"}
          </button>
        </div>
      )}
    </div>
  );
}
