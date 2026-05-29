"use client";

import { useState, useTransition, useMemo } from "react";
import { sendShiftNotifyAction } from "./actions";

type Shift = {
  staff_id: string;
  shift_date: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
};
type Member = { id: string; name: string };

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

const DEFAULT_TEMPLATE = `{名前}さん、{対象月}のシフトが確定しました。

{シフト一覧}
ポータルのシフトページからご確認ください。`;

function buildShiftLines(shifts: Shift[]): string {
  return [...shifts]
    .sort((a, b) => a.shift_date.localeCompare(b.shift_date))
    .map(s => {
      const dt  = new Date(s.shift_date + "T12:00:00+09:00");
      const wd  = WEEKDAY_JP[dt.getDay()];
      const [, mm, dd] = s.shift_date.split("-");
      const timeStr = s.shift_start && s.shift_end
        ? ` ${s.shift_start.slice(0, 5)}〜${s.shift_end.slice(0, 5)}`
        : "";
      return `${parseInt(mm)}/${parseInt(dd)}（${wd}）${s.shift_name ?? ""}${timeStr}`;
    })
    .join("\n");
}

function resolvePreview(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (msg, [k, v]) => msg.split(`{${k}}`).join(v),
    template,
  );
}

type Props = {
  projectId: string;
  year: number;
  month: number;
  members: Member[];
  shifts: Shift[];
  defaultTemplate?: string;
};

export default function ShiftLineNotifyButton({
  projectId, year, month, members, shifts, defaultTemplate,
}: Props) {
  const [open, setOpen]           = useState(false);
  const [message, setMessage]     = useState("");
  const [previewId, setPreviewId] = useState<string>("");
  const [isPending, start]        = useTransition();
  const [result, setResult]       = useState<{ sent: number; noLine: string[] } | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const targetMonth = `${year}/${String(month).padStart(2, "0")}`;

  function openModal() {
    setMessage(defaultTemplate?.trim() || DEFAULT_TEMPLATE);
    setPreviewId(members[0]?.id ?? "");
    setResult(null);
    setError(null);
    setOpen(true);
  }

  // プレビュー：選択スタッフのシフト一覧を生成してメッセージに埋め込む
  const previewText = useMemo(() => {
    if (!previewId || !message) return "";
    const member = members.find(m => m.id === previewId);
    if (!member) return "";
    const myShifts = shifts.filter(s => s.staff_id === previewId);
    const shiftLines = buildShiftLines(myShifts);
    return resolvePreview(message, {
      "名前":      member.name,
      "対象月":    targetMonth,
      "シフト一覧": shiftLines || "（シフトなし）",
    });
  }, [previewId, message, members, shifts, targetMonth]);

  function handleSend() {
    start(async () => {
      const res = await sendShiftNotifyAction(projectId, year, month, message);
      if (res.success) {
        setResult({ sent: res.sent ?? 0, noLine: res.noLine ?? [] });
        setOpen(false);
      } else {
        setError(res.message ?? "送信に失敗しました");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-700 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        シフト通知（LINE）
      </button>

      {/* 結果バナー */}
      {result && (
        <div className="fixed bottom-6 right-4 z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-xl p-4 w-64 text-sm space-y-1">
          <p className="font-semibold text-emerald-600">✓ 送信完了 {result.sent}名</p>
          {result.noLine.length > 0 && (
            <p className="text-xs text-zinc-500">LINE未連携：{result.noLine.join("・")}</p>
          )}
          <button onClick={() => setResult(null)} className="text-[11px] text-zinc-400 hover:text-zinc-600 mt-1">閉じる</button>
        </div>
      )}

      {/* モーダル */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/50">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col">

            {/* ヘッダー */}
            <div className="px-5 pt-5 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">シフト通知（LINE）</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {targetMonth} — LINE連携済みスタッフへ個別送信
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600 p-1 -mt-0.5">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* コンテンツ（スクロール可） */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {/* メッセージテンプレート編集 */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  メッセージテンプレート
                </label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={8}
                  className="w-full text-xs font-mono rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-800 dark:text-zinc-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[10px] text-zinc-400 leading-relaxed">
                  <span className="font-semibold text-zinc-500">{"{名前}"}</span> 各スタッフ名 ／{" "}
                  <span className="font-semibold text-zinc-500">{"{対象月}"}</span> {targetMonth} ／{" "}
                  <span className="font-semibold text-zinc-500">{"{シフト一覧}"}</span> 全日程（公休含む）
                </p>
              </div>

              {/* プレビュー */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">プレビュー</label>
                  <select
                    value={previewId}
                    onChange={e => setPreviewId(e.target.value)}
                    className="text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">スタッフを選択</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                {previewId && (
                  <pre className="text-xs whitespace-pre-wrap break-words rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-3 text-zinc-700 dark:text-zinc-300 leading-relaxed max-h-64 overflow-y-auto font-sans">
                    {previewText}
                  </pre>
                )}
                {previewId && (
                  <p className="text-[10px] text-zinc-400">
                    ※ 実際のLINEメッセージには下部に「シフトを確認する」ボタンが追加されます
                  </p>
                )}
              </div>

              {error && (
                <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            {/* フッター */}
            <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex gap-3">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                キャンセル
              </button>
              <button
                onClick={handleSend}
                disabled={isPending || !message.trim()}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 text-sm font-semibold text-white transition-colors"
              >
                {isPending ? "送信中..." : "全員に送信"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
